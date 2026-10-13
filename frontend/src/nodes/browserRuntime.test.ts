import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserInputs } from "./browserRuntime";
import { isChannelBuffer, isTableData } from "../runtimeValues";
import type { GraphNode, Params, Project } from "../types";
const project: Project = {
  id: "test",
  name: "test",
  version: 1,
  nodes: [],
  edges: [],
};
const node = (type: string, params: Params = {}, id = type): GraphNode => ({
  id,
  type: `browser_${type}`,
  position: { x: 0, y: 0 },
  data: { label: type, params },
});
const cook = (
  runtime: BrowserInputs,
  type: string,
  params: Params = {},
  input?: unknown,
  id = type,
) => {
  const result = runtime.cook(node(type, params, id), () => input, project);
  if (!result.handled) throw new Error("Unhandled");
  return result.value;
};
const channel = (value: unknown, name: string) => {
  if (!isChannelBuffer(value)) throw new Error("Expected channels");
  return value.channels.find((ch) => ch.name === name)?.samples[0];
};
const rows = (value: unknown) => {
  if (!isTableData(value)) throw new Error("Expected table");
  return value.rows;
};
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const inputPort = (id: string) => ({
  id,
  state: "connected",
  onmidimessage: null as ((event: MIDIMessageEvent) => void) | null,
  close: vi.fn(async () => undefined),
});
const outputPort = (id: string) => ({
  id,
  state: "connected",
  send: vi.fn(),
  close: vi.fn(async () => undefined),
});
const mediaDevice = (deviceId: string, kind = "videoinput") =>
  ({
    deviceId,
    kind,
    label: deviceId + " label",
    groupId: "group",
  }) as MediaDeviceInfo;
const stream = () => {
  const track = Object.assign(new EventTarget(), {
    readyState: "live",
    stop: vi.fn(() => {
      track.readyState = "ended";
    }),
  });
  return { track, getTracks: () => [track], getVideoTracks: () => [track] };
};
let windowTarget: EventTarget & { innerWidth: number; innerHeight: number },
  media: EventTarget & {
    enumerateDevices: ReturnType<typeof vi.fn>;
    getUserMedia: ReturnType<typeof vi.fn>;
    getDisplayMedia: ReturnType<typeof vi.fn>;
  },
  runtimes: BrowserInputs[],
  videos: (EventTarget & {
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    srcObject: unknown;
    videoWidth: number;
    videoHeight: number;
    readyState: number;
  })[];
let navigatorStub: {
  mediaDevices: typeof media;
  requestMIDIAccess: ReturnType<typeof vi.fn>;
  getGamepads: ReturnType<typeof vi.fn>;
};
const event = (type: string, properties: Record<string, unknown> = {}) =>
  Object.assign(new Event(type), properties);
const create = () => {
  const runtime = new BrowserInputs();
  runtimes.push(runtime);
  return runtime;
};
beforeEach(() => {
  runtimes = [];
  videos = [];
  windowTarget = Object.assign(new EventTarget(), {
    innerWidth: 1000,
    innerHeight: 500,
  });
  media = Object.assign(new EventTarget(), {
    enumerateDevices: vi.fn(async () => [
      mediaDevice("front"),
      mediaDevice("back"),
      mediaDevice("mic", "audioinput"),
    ]),
    getUserMedia: vi.fn(async () => stream()),
    getDisplayMedia: vi.fn(async () => stream()),
  });
  navigatorStub = {
    mediaDevices: media,
    requestMIDIAccess: vi.fn(),
    getGamepads: vi.fn(() => []),
  };
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("navigator", navigatorStub);
  vi.stubGlobal("document", {
    createElement: vi.fn((tag: string) => {
      if (tag === "video") {
        const video = Object.assign(new EventTarget(), {
          play: vi.fn(async () => undefined),
          pause: vi.fn(),
          srcObject: undefined as unknown,
          videoWidth: 800,
          videoHeight: 600,
          readyState: 4,
        });
        videos.push(video);
        return video;
      }
      return {
        width: 640,
        height: 360,
        getContext: () => ({ drawImage: vi.fn() }),
      };
    }),
  });
});
afterEach(() => {
  runtimes.forEach((runtime) => runtime.dispose());
  vi.unstubAllGlobals();
});

describe("browser keyboard and pointer event ownership", () => {
  it("tracks simultaneous keys, repeats and synthetic releases on blur", () => {
    const runtime = create();
    windowTarget.dispatchEvent(
      event("keydown", { code: "KeyA", key: "a", repeat: false }),
    );
    windowTarget.dispatchEvent(
      event("keydown", { code: "Space", key: " ", repeat: false }),
    );
    windowTarget.dispatchEvent(
      event("keydown", { code: "KeyA", key: "a", repeat: true }),
    );
    expect(
      channel(cook(runtime, "keyboard_in", { keys: "KeyA Space" }), "KeyA"),
    ).toBe(1);
    expect(rows(cook(runtime, "keyboard_dat"))[3].slice(1)).toEqual([
      "KeyA",
      "a",
      "1",
      "1",
    ]);
    windowTarget.dispatchEvent(new Event("blur"));
    expect(
      channel(cook(runtime, "keyboard_in", { keys: "KeyA Space" }), "Space"),
    ).toBe(0);
    expect(
      rows(cook(runtime, "keyboard_dat"))
        .slice(-2)
        .map((row) => row.slice(1, 4)),
    ).toEqual([
      ["KeyA", "a", "0"],
      ["Space", " ", "0"],
    ]);
    runtime.dispose();
    windowTarget.dispatchEvent(event("keydown", { code: "KeyA", key: "a" }));
    expect(
      channel(cook(runtime, "keyboard_in", { keys: "KeyA" }), "KeyA"),
    ).toBe(0);
  });
  it("preserves pen-only pressure/tilt, releases cancellation and distinguishes touch contacts", () => {
    const runtime = create();
    windowTarget.dispatchEvent(
      event("pointerdown", {
        pointerType: "pen",
        pointerId: 1,
        isPrimary: true,
        clientX: 250,
        clientY: 100,
        pressure: 0.8,
        tiltX: -25,
        tiltY: 30,
        twist: 90,
        buttons: 1,
      }),
    );
    expect(channel(cook(runtime, "tablet"), "pressure")).toBe(0.8);
    expect(channel(cook(runtime, "tablet"), "tiltx")).toBe(-25);
    expect(rows(cook(runtime, "multi_touch_in"))).toHaveLength(1);
    windowTarget.dispatchEvent(
      event("pointercancel", {
        pointerType: "pen",
        pointerId: 1,
        isPrimary: true,
        clientX: 250,
        clientY: 100,
        pressure: 0.8,
        tiltX: -25,
        tiltY: 30,
        twist: 90,
        buttons: 1,
      }),
    );
    expect(channel(cook(runtime, "tablet"), "active")).toBe(0);
    expect(channel(cook(runtime, "tablet"), "pressure")).toBe(0);
    for (const id of [2, 3])
      windowTarget.dispatchEvent(
        event("pointerdown", {
          pointerType: "touch",
          pointerId: id,
          isPrimary: id === 2,
          clientX: id * 100,
          clientY: 100,
          pressure: 0.5,
          buttons: 1,
        }),
      );
    expect(rows(cook(runtime, "multi_touch_in"))).toHaveLength(3);
    windowTarget.dispatchEvent(
      event("pointerup", {
        pointerType: "touch",
        pointerId: 3,
        isPrimary: false,
        clientX: 300,
        clientY: 100,
        pressure: 0,
        buttons: 0,
      }),
    );
    expect(rows(cook(runtime, "multi_touch_in"))).toHaveLength(2);
    expect(channel(cook(runtime, "mouse_in"), "lselect")).toBe(1);
    windowTarget.dispatchEvent(new Event("blur"));
    expect(rows(cook(runtime, "multi_touch_in"))).toHaveLength(1);
    expect(channel(cook(runtime, "mouse_in"), "lselect")).toBe(0);
  });
  it("normalizes wheel units and reports actual microphone sample coordinates", () => {
    const runtime = create();
    windowTarget.dispatchEvent(event("wheel", { deltaY: 2, deltaMode: 1 }));
    expect(channel(cook(runtime, "mouse_in"), "wheel")).toBe(32);
    const output = runtime.cook(
      node("audio_device_in"),
      () => undefined,
      project,
      new Float32Array([0.2, -0.2]),
      44100,
      2,
    );
    expect(
      output.handled &&
        isChannelBuffer(output.value) &&
        output.value.sampleRate,
    ).toBe(44100);
    expect(
      output.handled && isChannelBuffer(output.value) && output.value.start,
    ).toBe(88198);
    expect(() => cook(runtime, "audio_device_in")).toThrow(/启用麦克风/);
  });
});

describe("MIDI device, channel and note lifecycle", () => {
  const setup = () => {
    const a = inputPort("input-a"),
      b = inputPort("input-b"),
      outputA = outputPort("output-a"),
      outputB = outputPort("output-b"),
      access = {
        inputs: new Map([
          [a.id, a],
          [b.id, b],
        ]),
        outputs: new Map([
          [outputA.id, outputA],
          [outputB.id, outputB],
        ]),
        onstatechange: null as (() => void) | null,
      };
    navigatorStub.requestMIDIAccess.mockResolvedValue(access);
    return { a, b, outputA, outputB, access };
  };
  const send = (port: ReturnType<typeof inputPort>, bytes: number[]) =>
    port.onmidimessage?.({ data: new Uint8Array(bytes) } as MIDIMessageEvent);
  it("separates identical notes on different inputs and channels, including zero-velocity note-off", async () => {
    const { a, b } = setup(),
      runtime = create();
    await runtime.enableMIDI();
    send(a, [0x90, 60, 127]);
    send(a, [0x91, 60, 64]);
    send(b, [0x90, 60, 32]);
    expect(
      channel(cook(runtime, "midi_in", { device: 0, channel: 0 }), "note60"),
    ).toBe(1);
    expect(
      channel(cook(runtime, "midi_in", { device: 0, channel: 1 }), "note60"),
    ).toBe(64 / 127);
    expect(
      channel(cook(runtime, "midi_in", { device: 1, channel: 0 }), "note60"),
    ).toBe(32 / 127);
    send(a, [0x90, 60, 0]);
    expect(
      channel(cook(runtime, "midi_in", { device: 0, channel: 0 }), "note60"),
    ).toBe(0);
    send(a, [0x81, 60, 80]);
    expect(
      channel(cook(runtime, "midi_in", { device: 0, channel: 1 }), "note60"),
    ).toBe(0);
    expect(rows(cook(runtime, "midi_dat")).at(-1)?.at(-1)).toBe("input-a");
  });
  it("retains controller mappings beyond the event log and releases note mappings on note-off", async () => {
    const { a } = setup(),
      runtime = create();
    await runtime.enableMIDI();
    send(a, [0xb0, 7, 100]);
    send(a, [0x90, 60, 127]);
    for (let i = 0; i < 150; i++) send(a, [0xb0, 8, i % 128]);
    const mapping = { mapping: '{"volume":[176,7],"note":[144,60]}' };
    expect(channel(cook(runtime, "midi_map", mapping), "volume")).toBe(
      100 / 127,
    );
    expect(channel(cook(runtime, "midi_map", mapping), "note")).toBe(1);
    send(a, [0x80, 60, 64]);
    expect(channel(cook(runtime, "midi_map", mapping), "note")).toBe(0);
    send(a, [0x90, 60, 127]);
    send(a, [0xb0, 123, 0]);
    expect(channel(cook(runtime, "midi_map", mapping), "note")).toBe(0);
    expect(() =>
      cook(runtime, "midi_map", { mapping: '{"bad":[999,0]}' }),
    ).toThrow(/MIDI 映射/);
  });
  it("sends balanced note-on/off when pitch, velocity, device or enabled state changes", async () => {
    const { outputA, outputB } = setup(),
      runtime = create();
    await runtime.enableMIDI();
    const render = (params: Params, note = 60) =>
      cook(
        runtime,
        "midi_out",
        { enabled: true, velocity: 100, device: 0, channel: 0, ...params },
        note,
        "out",
      );
    render({});
    render({});
    expect(outputA.send.mock.calls).toEqual([[[0x90, 60, 100]]]);
    render({ velocity: 64 });
    expect(outputA.send.mock.calls.slice(-2)).toEqual([
      [[0x80, 60, 0]],
      [[0x90, 60, 64]],
    ]);
    render({ device: 1 });
    expect(outputA.send.mock.calls.at(-1)).toEqual([[0x80, 60, 0]]);
    expect(outputB.send.mock.calls.at(-1)).toEqual([[0x90, 60, 100]]);
    render({ device: 1, velocity: 0 });
    expect(outputB.send.mock.calls.at(-1)).toEqual([[0x80, 60, 0]]);
    render({ device: 1, channel: 2 }, 72);
    runtime.retain(new Set());
    expect(outputB.send.mock.calls.at(-1)).toEqual([[0x82, 72, 0]]);
  });
  it("detaches disconnected inputs and releases output notes on device loss/disposal", async () => {
    const { a, outputA, access } = setup(),
      runtime = create();
    await runtime.enableMIDI();
    send(a, [0x90, 60, 127]);
    cook(runtime, "midi_out", { enabled: true }, 64, "out");
    a.state = "disconnected";
    outputA.state = "disconnected";
    access.onstatechange?.();
    expect(a.onmidimessage).toBeNull();
    expect(a.close).toHaveBeenCalled();
    expect(outputA.send.mock.calls.at(-1)).toEqual([[0x80, 64, 0]]);
    runtime.dispose();
    expect(access.onstatechange).toBeNull();
    expect(outputA.close).toHaveBeenCalled();
  });
  it("shares concurrent permission requests and ignores resolution after disposal", async () => {
    const { access, a } = setup(),
      pending = deferred<typeof access>();
    navigatorStub.requestMIDIAccess.mockReturnValue(pending.promise);
    const runtime = create(),
      first = runtime.enableMIDI(),
      second = runtime.enableMIDI();
    expect(navigatorStub.requestMIDIAccess).toHaveBeenCalledTimes(1);
    runtime.dispose();
    pending.resolve(access);
    await Promise.all([first, second]);
    expect(a.onmidimessage).toBeNull();
    expect(access.onstatechange).toBeNull();
  });
});

describe("camera enumeration, selection and async ownership", () => {
  it("selects the requested camera ID and releases all tracks on removal", async () => {
    const runtime = create(),
      capture = stream();
    media.getUserMedia.mockResolvedValue(capture);
    await runtime.capture("camera", false, 1);
    expect(media.getUserMedia).toHaveBeenCalledWith({
      video: { deviceId: { exact: "back" } },
      audio: false,
    });
    const canvas = cook(
      runtime,
      "video_device_in",
      {},
      undefined,
      "camera",
    ) as HTMLCanvasElement;
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    runtime.retain(new Set());
    expect(capture.track.stop).toHaveBeenCalled();
    expect(videos[0].srcObject).toBeNull();
    expect(() =>
      cook(runtime, "video_device_in", {}, undefined, "camera"),
    ).toThrow(/启用采集/);
  });
  it("does not request a camera after cancellation during enumeration", async () => {
    const runtime = create(),
      pending = deferred<MediaDeviceInfo[]>();
    media.enumerateDevices.mockReturnValue(pending.promise);
    const activation = runtime.capture("camera");
    runtime.stop("camera");
    pending.resolve([mediaDevice("front")]);
    await activation;
    expect(media.getUserMedia).not.toHaveBeenCalled();
  });
  it("stops a stream returned after cancellation without touching a newer capture", async () => {
    const runtime = create(),
      old = stream(),
      recent = stream(),
      first = deferred<ReturnType<typeof stream>>();
    media.getUserMedia
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(recent);
    const activation = runtime.capture("camera");
    await Promise.resolve();
    await Promise.resolve();
    await runtime.capture("camera", false, 1);
    first.resolve(old);
    await activation;
    expect(old.track.stop).toHaveBeenCalled();
    expect(recent.track.stop).not.toHaveBeenCalled();
    expect(() =>
      cook(runtime, "video_device_in", {}, undefined, "camera"),
    ).not.toThrow();
  });
  it("cleans pending media if disposed before getUserMedia resolves", async () => {
    const runtime = create(),
      late = stream(),
      pending = deferred<ReturnType<typeof stream>>();
    media.getUserMedia.mockReturnValue(pending.promise);
    const activation = runtime.capture("camera");
    await Promise.resolve();
    await Promise.resolve();
    runtime.dispose();
    pending.resolve(late);
    await activation;
    expect(late.track.stop).toHaveBeenCalled();
  });
  it("rejects unavailable device indices and releases permission failures for a retry", async () => {
    const runtime = create();
    await expect(runtime.capture("camera", false, 99)).rejects.toThrow(/编号/);
    expect(media.getUserMedia).not.toHaveBeenCalled();
    media.getUserMedia.mockRejectedValueOnce(new Error("permission denied"));
    await expect(runtime.capture("camera")).rejects.toThrow(/permission/);
    await expect(runtime.capture("camera")).resolves.toBeUndefined();
  });
  it("refreshes actual devices and ignores an older asynchronous enumeration", async () => {
    const runtime = create(),
      first = deferred<MediaDeviceInfo[]>(),
      second = deferred<MediaDeviceInfo[]>();
    media.enumerateDevices
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const early = runtime.refreshDevices(),
      later = runtime.refreshDevices();
    second.resolve([mediaDevice("new")]);
    await later;
    first.resolve([mediaDevice("old")]);
    await early;
    expect(rows(cook(runtime, "video_devices"))[1][0]).toBe("new");
    media.enumerateDevices.mockResolvedValue([mediaDevice("hotplug")]);
    media.dispatchEvent(new Event("devicechange"));
    await Promise.resolve();
    await Promise.resolve();
    expect(rows(cook(runtime, "video_devices"))[1][0]).toBe("hotplug");
  });
  it("releases a capture when the browser ends screen sharing", async () => {
    const runtime = create(),
      capture = stream();
    media.getDisplayMedia.mockResolvedValue(capture);
    await runtime.capture("screen", true);
    capture.track.readyState = "ended";
    capture.track.dispatchEvent(new Event("ended"));
    expect(() => cook(runtime, "screen_grab", {}, undefined, "screen")).toThrow(
      /启用采集/,
    );
  });
});
