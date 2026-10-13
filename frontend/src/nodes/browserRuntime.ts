import type { GraphNode, Project } from "../types";
import { makeChannels, makeTable, scalarValue } from "../runtimeValues";
import { operatorPath } from "../networks";

type Capture = {
  video: HTMLVideoElement;
  stream: MediaStream;
  canvas: HTMLCanvasElement;
  ended: () => void;
};
type MidiEvent = { time: number; bytes: number[]; deviceId: string };
type InputBinding = {
  port: MIDIInput;
  handler: (event: MIDIMessageEvent) => void;
};
type OutputNote = {
  note: number;
  channel: number;
  velocity: number;
  output: MIDIOutput;
};
const integer = (
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) => {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.floor(parsed)))
    : fallback;
};
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : 0));
const closePort = (port: MIDIInput | MIDIOutput) => {
  try {
    void Promise.resolve(port.close()).catch(() => undefined);
  } catch {
    /* A disconnected port may already be closed. */
  }
};

/** Browser event/device ownership is explicit. Construction never requests permission. */
export class BrowserInputs {
  private keys = new Map<string, string>();
  private keyEvents: (string | number)[][] = [];
  private pointers = new Map<
    number,
    { x: number; y: number; pressure: number }
  >();
  private mouse = { x: 0, y: 0, buttons: 0, wheel: 0 };
  private pen = {
    pressure: 0,
    tiltx: 0,
    tilty: 0,
    twist: 0,
    x: 0,
    y: 0,
    active: 0,
  };
  private midi?: MIDIAccess;
  private midiPromise?: Promise<void>;
  private midiBindings = new Map<string, InputBinding>();
  private midiMessages: MidiEvent[] = [];
  /** Per device, then MIDI channel + note. Channels sharing a note never overwrite each other. */
  private notes = new Map<string, Map<number, number>>();
  private midiValues = new Map<
    string,
    Map<string, { value: number; sequence: number }>
  >();
  private midiSequence = 0;
  private outputNotes = new Map<string, OutputNote>();
  private usedOutputs = new Set<MIDIOutput>();
  private devices: MediaDeviceInfo[] = [];
  private deviceGeneration = 0;
  private captures = new Map<string, Capture>();
  private pending = new Map<string, symbol>();
  private disposed = false;

  private logKey(
    code: string,
    key: string,
    state: number,
    repeat = false,
  ): void {
    this.keyEvents.push([Date.now(), code, key, state, +repeat]);
    if (this.keyEvents.length > 128)
      this.keyEvents.splice(0, this.keyEvents.length - 128);
  }
  private keydown = (event: KeyboardEvent): void => {
    const code = event.code || event.key || "Unidentified";
    this.keys.set(code, event.key || code);
    this.logKey(code, event.key || code, 1, event.repeat);
  };
  private keyup = (event: KeyboardEvent): void => {
    const code = event.code || event.key || "Unidentified";
    this.keys.delete(code);
    this.logKey(code, event.key || code, 0);
  };
  private pointer = (event: PointerEvent): void => {
    const x = clamp(event.clientX / Math.max(1, window.innerWidth), 0, 1),
      y = clamp(1 - event.clientY / Math.max(1, window.innerHeight), 0, 1),
      ended = event.type === "pointerup" || event.type === "pointercancel";
    if (event.pointerType === "pen") {
      this.pen = {
        pressure: ended ? 0 : clamp(event.pressure, 0, 1),
        tiltx: clamp(event.tiltX, -90, 90),
        tilty: clamp(event.tiltY, -90, 90),
        twist: (((event.twist || 0) % 360) + 360) % 360,
        x,
        y,
        active: +!ended,
      };
    } else if (event.pointerType === "mouse" || !event.pointerType) {
      this.pen.active = 0;
      this.pen.pressure = 0;
    }
    if (event.isPrimary || event.pointerType === "mouse" || !event.pointerType)
      this.mouse = { ...this.mouse, x, y, buttons: ended ? 0 : event.buttons };
    if (ended) this.pointers.delete(event.pointerId);
    else if (
      event.pointerType === "touch" &&
      (event.type === "pointerdown" ||
        this.pointers.has(event.pointerId) ||
        event.buttons)
    )
      this.pointers.set(event.pointerId, {
        x,
        y,
        pressure: clamp(event.pressure, 0, 1),
      });
  };
  private wheel = (event: WheelEvent): void => {
    const unit =
      event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? Math.max(1, window.innerHeight)
          : 1;
    this.mouse.wheel += event.deltaY * unit;
  };
  private blur = (): void => {
    for (const [code, key] of this.keys) this.logKey(code, key, 0);
    this.keys.clear();
    this.pointers.clear();
    this.mouse.buttons = 0;
    this.pen.active = 0;
    this.pen.pressure = 0;
  };
  private devicechange = (): void => {
    if (!this.disposed) void this.refreshDevices().catch(() => undefined);
  };
  constructor() {
    if (typeof window === "undefined") return;
    window.addEventListener("keydown", this.keydown);
    window.addEventListener("keyup", this.keyup);
    window.addEventListener("blur", this.blur);
    window.addEventListener("wheel", this.wheel, { passive: true });
    for (const name of [
      "pointerdown",
      "pointermove",
      "pointerup",
      "pointercancel",
    ])
      window.addEventListener(name, this.pointer as EventListener);
    if (typeof navigator !== "undefined")
      navigator.mediaDevices?.addEventListener?.(
        "devicechange",
        this.devicechange,
      );
  }

  async refreshDevices(): Promise<void> {
    if (this.disposed) return;
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.enumerateDevices
    )
      throw new Error("设备枚举需要 HTTPS 或 localhost");
    const generation = ++this.deviceGeneration;
    const devices = await navigator.mediaDevices.enumerateDevices();
    if (!this.disposed && generation === this.deviceGeneration)
      this.devices = devices;
  }
  private releaseNote(id: string): void {
    const old = this.outputNotes.get(id);
    if (!old) return;
    try {
      old.output.send([0x80 + old.channel, old.note, 0]);
    } catch {
      /* The physical output may have disconnected. */
    }
    this.outputNotes.delete(id);
  }
  private midiMessage(deviceId: string, event: MIDIMessageEvent): void {
    if (this.disposed || !event.data?.length) return;
    const bytes = Array.from(event.data),
      [status, note, velocity = 0] = bytes;
    this.midiMessages.push({ time: Date.now(), bytes, deviceId });
    if (this.midiMessages.length > 128)
      this.midiMessages.splice(0, this.midiMessages.length - 128);
    const notes = this.notes.get(deviceId) ?? new Map<number, number>(),
      values =
        this.midiValues.get(deviceId) ??
        new Map<string, { value: number; sequence: number }>();
    this.notes.set(deviceId, notes);
    this.midiValues.set(deviceId, values);
    if (note !== undefined)
      values.set(`${status}:${note}`, {
        value: velocity,
        sequence: ++this.midiSequence,
      });
    const kind = status & 0xf0,
      channel = status & 0x0f;
    if ((kind === 0x90 || kind === 0x80) && note !== undefined) {
      const effective = kind === 0x80 ? 0 : velocity;
      notes.set(channel * 128 + note, effective);
      // Note-off must also release a mapping listening to the corresponding Note On.
      values.set(`${0x90 + channel}:${note}`, {
        value: effective,
        sequence: ++this.midiSequence,
      });
    }
    if ((kind === 0xb0 && [120, 123].includes(note)) || status === 0xff) {
      for (const key of notes.keys())
        if (status === 0xff || Math.floor(key / 128) === channel) {
          notes.set(key, 0);
          values.set(`${0x90 + Math.floor(key / 128)}:${key % 128}`, {
            value: 0,
            sequence: ++this.midiSequence,
          });
        }
    }
  }
  private attachMIDI = (): void => {
    if (!this.midi || this.disposed) return;
    const connected = new Map(
      Array.from(this.midi.inputs.values())
        .filter((port) => port.state !== "disconnected")
        .map((port) => [port.id, port]),
    );
    for (const [id, binding] of this.midiBindings)
      if (connected.get(id) !== binding.port) {
        if (binding.port.onmidimessage === binding.handler)
          binding.port.onmidimessage = null;
        closePort(binding.port);
        this.midiBindings.delete(id);
        this.notes.delete(id);
        this.midiValues.delete(id);
      }
    for (const [id, port] of connected)
      if (!this.midiBindings.has(id)) {
        const handler = (event: MIDIMessageEvent) =>
          this.midiMessage(id, event);
        port.onmidimessage = handler;
        this.midiBindings.set(id, { port, handler });
      }
    for (const [id, note] of this.outputNotes)
      if (
        note.output.state === "disconnected" ||
        !Array.from(this.midi.outputs.values()).includes(note.output)
      )
        this.releaseNote(id);
  };
  async enableMIDI(): Promise<void> {
    if (this.disposed) throw new Error("浏览器输入已释放");
    if (this.midi) {
      this.attachMIDI();
      return;
    }
    if (this.midiPromise) return this.midiPromise;
    if (typeof navigator === "undefined" || !navigator.requestMIDIAccess)
      throw new Error("此浏览器不支持 Web MIDI");
    const pending = (async () => {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      if (this.disposed) return;
      this.midi = access;
      this.attachMIDI();
      access.onstatechange = this.attachMIDI;
    })();
    this.midiPromise = pending;
    try {
      await pending;
    } finally {
      if (this.midiPromise === pending) this.midiPromise = undefined;
    }
  }

  private releaseCapture(capture: Capture): void {
    for (const track of capture.stream.getTracks()) {
      track.removeEventListener("ended", capture.ended);
      track.stop();
    }
    capture.video.pause();
    capture.video.srcObject = null;
  }
  async capture(id: string, screen = false, deviceIndex = 0): Promise<void> {
    if (this.disposed) throw new Error("浏览器输入已释放");
    if (typeof navigator === "undefined" || !navigator.mediaDevices)
      throw new Error("媒体采集需要 HTTPS 或 localhost");
    if (!Number.isInteger(deviceIndex) || deviceIndex < 0)
      throw new Error("摄像头编号必须为非负整数");
    const media = navigator.mediaDevices;
    if (screen ? !media.getDisplayMedia : !media.getUserMedia)
      throw new Error(
        screen ? "浏览器不支持屏幕共享" : "浏览器不支持摄像头采集",
      );
    this.stop(id);
    const token = Symbol(id);
    this.pending.set(id, token);
    const current = () => !this.disposed && this.pending.get(id) === token;
    let stream: MediaStream | undefined;
    try {
      let constraints: MediaStreamConstraints = { video: true, audio: false };
      if (!screen && media.enumerateDevices) {
        const devices = await media.enumerateDevices();
        if (!current()) return;
        this.devices = devices;
        const cameras = devices.filter(
            (device) => device.kind === "videoinput",
          ),
          selected = cameras[deviceIndex];
        if (!selected && deviceIndex > 0)
          throw new Error(
            `未找到编号 ${deviceIndex} 的摄像头；请先授权默认摄像头并刷新设备列表`,
          );
        if (selected?.deviceId)
          constraints = {
            video: { deviceId: { exact: selected.deviceId } },
            audio: false,
          };
        else if (deviceIndex > 0)
          throw new Error(
            "浏览器尚未公开该摄像头 ID，请先授权默认摄像头并刷新设备列表",
          );
      } else if (!screen && deviceIndex > 0)
        throw new Error("浏览器不支持枚举摄像头，请使用设备编号 0");
      if (!current()) return;
      stream = screen
        ? await media.getDisplayMedia({ video: true, audio: false })
        : await media.getUserMedia(constraints);
      if (!current()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const capture: Capture = {
        video,
        stream,
        canvas,
        ended: () => {
          if (
            this.captures.get(id) === capture &&
            stream!
              .getVideoTracks()
              .every((track) => track.readyState === "ended")
          )
            this.stop(id);
        },
      };
      this.captures.set(id, capture);
      for (const track of stream.getTracks())
        track.addEventListener("ended", capture.ended);
      await video.play();
      if (!current() || this.captures.get(id) !== capture) {
        this.releaseCapture(capture);
        return;
      }
      this.pending.delete(id);
      // Media permission can reveal previously hidden device labels and IDs.
      void this.refreshDevices().catch(() => undefined);
    } catch (error) {
      const stillCurrent = current();
      if (stillCurrent) {
        this.pending.delete(id);
        const capture = this.captures.get(id);
        if (capture && capture.stream === stream) {
          this.releaseCapture(capture);
          this.captures.delete(id);
        } else stream?.getTracks().forEach((track) => track.stop());
      } else stream?.getTracks().forEach((track) => track.stop());
      if (stillCurrent) throw error;
    }
  }
  stop(id: string): void {
    this.pending.delete(id);
    this.releaseNote(id);
    const capture = this.captures.get(id);
    if (capture) {
      this.captures.delete(id);
      this.releaseCapture(capture);
    }
  }
  retain(ids: Set<string>): void {
    for (const id of this.outputNotes.keys())
      if (!ids.has(id)) this.releaseNote(id);
    for (const id of new Set([...this.captures.keys(), ...this.pending.keys()]))
      if (!ids.has(id)) this.stop(id);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.deviceGeneration++;
    for (const id of [...this.outputNotes.keys()]) this.releaseNote(id);
    for (const id of new Set([...this.captures.keys(), ...this.pending.keys()]))
      this.stop(id);
    for (const { port, handler } of this.midiBindings.values()) {
      if (port.onmidimessage === handler) port.onmidimessage = null;
      closePort(port);
    }
    this.midiBindings.clear();
    for (const output of this.usedOutputs) closePort(output);
    this.usedOutputs.clear();
    if (this.midi) this.midi.onstatechange = null;
    this.midi = undefined;
    this.notes.clear();
    this.midiValues.clear();
    this.blur();
    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", this.keydown);
      window.removeEventListener("keyup", this.keyup);
      window.removeEventListener("blur", this.blur);
      window.removeEventListener("wheel", this.wheel);
      for (const name of [
        "pointerdown",
        "pointermove",
        "pointerup",
        "pointercancel",
      ])
        window.removeEventListener(name, this.pointer as EventListener);
    }
    if (typeof navigator !== "undefined")
      navigator.mediaDevices?.removeEventListener?.(
        "devicechange",
        this.devicechange,
      );
  }

  cook(
    node: GraphNode,
    input: (handle?: string) => unknown,
    project: Project,
    audio?: Float32Array,
    audioRate = 48000,
    audioTime = 0,
  ): { handled: false } | { handled: true; value: unknown } {
    if (!node.type.startsWith("browser_")) return { handled: false };
    const type = node.type.slice(8),
      params = node.data.params;
    let value: unknown;
    if (type === "keyboard_in")
      value = makeChannels(
        Object.fromEntries(
          String(params.keys || "Space")
            .split(/\s+/)
            .filter(Boolean)
            .map((key) => [key, [+this.keys.has(key)]]),
        ),
      );
    else if (type === "tablet")
      value = makeChannels(
        Object.fromEntries(
          Object.entries(this.pen).map(([key, value]) => [key, [value]]),
        ),
      );
    else if (type === "keyboard_dat")
      value = makeTable([
        ["time_ms", "code", "key", "state", "repeat"],
        ...this.keyEvents,
      ]);
    else if (type === "audio_devices" || type === "video_devices")
      value = makeTable([
        ["device_id", "kind", "label", "group_id"],
        ...this.devices
          .filter((device) =>
            type === "audio_devices"
              ? device.kind.startsWith("audio")
              : device.kind === "videoinput",
          )
          .map((device) => [
            device.deviceId,
            device.kind,
            device.label,
            device.groupId,
          ]),
      ]);
    else if (type === "monitors")
      value = makeTable([
        [
          "index",
          "width",
          "height",
          "available_width",
          "available_height",
          "color_depth",
          "pixel_ratio",
        ],
        [
          0,
          window.screen.width,
          window.screen.height,
          window.screen.availWidth,
          window.screen.availHeight,
          window.screen.colorDepth,
          window.devicePixelRatio,
        ],
      ]);
    else if (type === "midi_map") {
      let mapping: unknown;
      try {
        mapping = JSON.parse(String(params.mapping || "{}"));
      } catch {
        throw new Error("MIDI 映射不是有效 JSON");
      }
      if (!mapping || typeof mapping !== "object" || Array.isArray(mapping))
        throw new Error("MIDI 映射需要名称到 [状态字节, 数据字节] 的对象");
      value = makeChannels(
        Object.fromEntries(
          Object.entries(mapping).map(([name, match]) => {
            if (
              !Array.isArray(match) ||
              match.length !== 2 ||
              !match.every(Number.isInteger) ||
              match[0] < 0 ||
              match[0] > 255 ||
              match[1] < 0 ||
              match[1] > 127
            )
              throw new Error(
                "MIDI 映射必须为 [0–255 状态字节, 0–127 数据字节]",
              );
            const latest = [...this.midiValues.values()]
              .map((values) => values.get(`${match[0]}:${match[1]}`))
              .filter(
                (entry): entry is { value: number; sequence: number } =>
                  !!entry,
              )
              .sort((a, b) => b.sequence - a.sequence)[0];
            return [name, [(latest?.value ?? 0) / 127]];
          }),
        ),
      );
    } else if (type === "mouse_in")
      value = makeChannels({
        tx: [this.mouse.x],
        ty: [this.mouse.y],
        lselect: [this.mouse.buttons & 1 ? 1 : 0],
        rselect: [this.mouse.buttons & 2 ? 1 : 0],
        wheel: [this.mouse.wheel],
      });
    else if (type === "multi_touch_in")
      value = makeTable([
        ["id", "x", "y", "pressure"],
        ...Array.from(this.pointers, ([id, point]) => [
          id,
          point.x,
          point.y,
          point.pressure,
        ]),
      ]);
    else if (type === "joystick") {
      const pad = navigator.getGamepads?.()[integer(params.device, 0, 0, 32)];
      value = makeChannels(
        pad?.connected
          ? Object.fromEntries([
              ...pad.axes.map((value, i) => [
                "axis" + i,
                [clamp(value, -1, 1)],
              ]),
              ...pad.buttons.map((button, i) => [
                "button" + i,
                [clamp(button.value, 0, 1)],
              ]),
            ])
          : {},
      );
    } else if (type === "midi_in") {
      const device = Array.from(this.midi?.inputs.values() ?? []).filter(
          (port) => port.state !== "disconnected",
        )[integer(params.device, 0, 0, 32)],
        channel = integer(params.channel, 0, 0, 15),
        notes = device ? this.notes.get(device.id) : undefined;
      value = makeChannels(
        Object.fromEntries(
          [...(notes ?? [])]
            .filter(([key]) => Math.floor(key / 128) === channel)
            .map(([key, velocity]) => ["note" + (key % 128), [velocity / 127]]),
        ),
      );
    } else if (type === "midi_event" || type === "midi_dat")
      value = makeTable([
        ["time_ms", "status", "data1", "data2", "device_id"],
        ...this.midiMessages.map((event) => [
          event.time,
          event.bytes[0] ?? "",
          event.bytes[1] ?? "",
          event.bytes[2] ?? "",
          event.deviceId,
        ]),
      ]);
    else if (type === "midi_out") {
      value = input() ?? 0;
      const velocity = integer(params.velocity, 100, 0, 127);
      if (params.enabled && velocity > 0 && !this.disposed) {
        const output = Array.from(this.midi?.outputs.values() ?? []).filter(
          (port) => port.state !== "disconnected",
        )[integer(params.device, 0, 0, 32)];
        if (!output) {
          this.releaseNote(node.id);
          throw new Error("请先启用 MIDI 并连接所选输出设备");
        }
        const note = Math.max(0, Math.min(127, Math.round(scalarValue(value)))),
          channel = integer(params.channel, 0, 0, 15),
          old = this.outputNotes.get(node.id);
        if (
          old?.note !== note ||
          old.channel !== channel ||
          old.output !== output ||
          old.velocity !== velocity
        ) {
          this.releaseNote(node.id);
          output.send([0x90 + channel, note, velocity]);
          this.usedOutputs.add(output);
          this.outputNotes.set(node.id, { note, channel, velocity, output });
        }
      } else this.releaseNote(node.id);
    } else if (type === "panel") {
      const scope = node.id.includes("/")
          ? node.id.slice(0, node.id.lastIndexOf("/") + 1)
          : "",
        target = project.nodes.find(
          (item) => item.id === operatorPath(scope, String(params.path || "")),
        );
      if (!target) throw new Error("Panel 指向的组件不存在");
      value = makeChannels({
        value: [scalarValue(target.data.params.value)],
        select: [+!!scalarValue(target.data.params.value)],
      });
    } else if (type === "audio_device_in") {
      if (!audio) throw new Error("请先在参数面板启用麦克风采样");
      value = makeChannels(
        { audio: Array.from(audio) },
        audioRate,
        Math.floor(audioTime * audioRate) - audio.length,
        true,
      );
    } else if (type === "video_device_in" || type === "screen_grab") {
      const capture = this.captures.get(node.id);
      if (!capture) throw new Error("请在参数面板点击启用采集");
      if (capture.video.readyState >= 2) {
        const width = capture.video.videoWidth || 640,
          height = capture.video.videoHeight || 360,
          scale = Math.min(1, 1280 / width, 720 / height),
          targetWidth = Math.max(1, Math.round(width * scale)),
          targetHeight = Math.max(1, Math.round(height * scale));
        if (
          capture.canvas.width !== targetWidth ||
          capture.canvas.height !== targetHeight
        ) {
          capture.canvas.width = targetWidth;
          capture.canvas.height = targetHeight;
        }
        capture.canvas
          .getContext("2d")!
          .drawImage(capture.video, 0, 0, targetWidth, targetHeight);
      }
      value = capture.canvas;
    } else return { handled: false };
    return { handled: true, value };
  }
}
