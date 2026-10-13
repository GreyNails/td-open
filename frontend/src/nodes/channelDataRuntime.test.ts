import { describe, expect, it } from "vitest";
import {
  asChannels,
  asTable,
  isChannelBuffer,
  isTableData,
  makeChannels,
  makeTable,
  scalarValue,
  tableCSV,
  textValue,
} from "../runtimeValues";
import type { GraphNode, Params, Project } from "../types";
import { channelDataCatalog } from "./channelDataCatalog";
import { cookChannelDataNode, spectrum } from "./channelDataRuntime";
import { compileExpression } from "./safeExpression";
const node = (type: string, params: Params = {}, id = type): GraphNode => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: {
    label: type,
    params: {
      ...Object.fromEntries(
        channelDataCatalog
          .find((spec) => spec.type === type)!
          .params.map((p) => [p.key, p.default]),
      ),
      ...params,
    },
  },
});
const run = (
  type: string,
  params: Params = {},
  a?: unknown,
  b?: unknown,
  state = new Map<string, unknown>(),
  time = 0,
  context = {},
) => {
  const result = cookChannelDataNode(
    node(type, params),
    time,
    (handle = "in") => (handle === "in2" ? b : handle === "in" ? a : undefined),
    state,
    context,
  );
  if (!result.handled) throw new Error("Unregistered runtime");
  return result.value;
};
const channels = (
  type: string,
  params: Params = {},
  a?: unknown,
  b?: unknown,
  state?: Map<string, unknown>,
  time?: number,
) => {
  const value = run(type, params, a, b, state, time);
  if (!isChannelBuffer(value)) throw new Error("Expected channels");
  return value;
};
const values = (value: ChannelReturn) => value.channels[0]?.samples ?? [];
type ChannelReturn = ReturnType<typeof channels>;
const data = makeChannels(
  { x: [0, 1, 2, 3], y: [10, 11, 12, 13], z: [20, 21, 22, 23] },
  4,
);

describe("portable channel and table values", () => {
  it("keeps named channels, sample rate and sample origin through JSON", () => {
    const original = makeChannels(
      { gain: [1, 2, 3], pan: [-1, 0, 1] },
      48000,
      96000,
      true,
    );
    expect(asChannels(JSON.stringify(original))).toEqual(original);
    expect(scalarValue(original)).toBe(3);
    expect(() => makeChannels({ a: [1], b: [1, 2] })).toThrow(/相等/);
    expect(() => makeChannels({ a: [Infinity] })).toThrow(/NaN/);
    expect(() =>
      makeChannels([
        { name: "a", samples: [1] },
        { name: "a", samples: [2] },
      ]),
    ).toThrow(/重复/);
    expect(
      makeChannels(
        Object.fromEntries(
          Array.from({ length: 512 }, (_, i) => [`dmx${i + 1}`, [i / 511]]),
        ),
      ).channels,
    ).toHaveLength(512);
  });
  it("round trips CSV quotes, newlines and empty cells", () => {
    const table = makeTable([
      ["name", "value"],
      ['comma,quote"', "line\nbreak"],
      ["", ""],
    ]);
    expect(asTable(tableCSV(table))).toEqual(table);
    expect(textValue(table)).toBe(tableCSV(table));
    expect(() => asTable('"unfinished')).toThrow(/引号/);
  });
});

describe("named multichannel structural operations", () => {
  it("merges named channels without data loss, selects wildcards, deletes, renames", () => {
    const merged = channels(
      "channel_merge",
      {},
      data,
      makeChannels({ x: [9, 8] }),
    );
    expect(merged.channels.map((ch) => ch.name)).toEqual([
      "x",
      "y",
      "z",
      "x_2",
    ]);
    expect(merged.channels[3].samples).toEqual([9, 8, 8, 8]);
    expect(
      channels("channel_select", { channels: "x* z" }, merged).channels.map(
        (ch) => ch.name,
      ),
    ).toEqual(["x", "z", "x_2"]);
    expect(
      channels("channel_delete", { channels: "?" }, merged).channels.map(
        (ch) => ch.name,
      ),
    ).toEqual(["x_2"]);
    expect(
      channels(
        "channel_rename",
        { mapping: '{"x":"position"}', prefix: "geo_" },
        data,
      ).channels[0].name,
    ).toBe("geo_position");
  });
  it("reorders, transposes and splits without conflating channels and samples", () => {
    expect(
      channels("channel_reorder", { indices: "2,0" }, data).channels.map(
        (ch) => ch.name,
      ),
    ).toEqual(["z", "x"]);
    expect(
      channels("native_channel_shuffle", {}, data).channels[0].samples,
    ).toEqual([0, 10, 20]);
    expect(
      channels("native_channel_shuffle", { mode: "split", size: 5 }, data)
        .channels[2].samples,
    ).toEqual([22, 23, 0, 0, 0]);
    expect(() => channels("channel_reorder", { indices: "999" }, data)).toThrow(
      /范围/,
    );
  });
  it("joins and splices by sample axis, trims origin and handles boundaries", () => {
    const second = makeChannels({ x: [4, 5] }, 4);
    expect(values(channels("channel_join", {}, data, second))).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect(
      values(channels("channel_splice", { index: 2, remove: 1 }, data, second)),
    ).toEqual([0, 1, 4, 5, 3]);
    const trimmed = channels("channel_trim", { start: 1, length: 2 }, data);
    expect(trimmed.start).toBe(1);
    expect(values(trimmed)).toEqual([1, 2]);
    expect(
      values(channels("channel_shift", { shift: 1, mode: "zero" }, data)),
    ).toEqual([0, 0, 1, 2]);
    expect(
      values(
        channels(
          "channel_extend",
          { before: 2, after: 1, mode: "mirror" },
          data,
        ),
      ),
    ).toEqual([2, 1, 0, 1, 2, 3, 2]);
  });
  it("resamples with duration and channel names preserved", () => {
    const resampled = channels("channel_resample", { sample_rate: 8 }, data);
    expect(resampled.sampleRate).toBe(8);
    expect(values(resampled)).toHaveLength(8);
    expect(resampled.channels[1].name).toBe("y");
    const down = channels(
      "channel_resample",
      { sample_rate: 2, mode: "average" },
      data,
    );
    expect(values(down)).toEqual([0.5, 2.5]);
  });
  it("does sample-wise aligned math and vector operations", () => {
    expect(
      values(
        channels(
          "channel_math",
          { mode: "multiply" },
          data,
          makeChannels({ x: [2] }),
        ),
      ),
    ).toEqual([0, 2, 4, 6]);
    expect(() => channels("channel_math", { mode: "divide" }, data, 0)).toThrow(
      /除数/,
    );
    const x = makeChannels({ x: [1], y: [0], z: [0] }),
      y = makeChannels({ x: [0], y: [1], z: [0] });
    expect(
      channels("channel_cross", {}, x, y).channels.map((ch) => ch.samples[0]),
    ).toEqual([0, 0, 1]);
    expect(values(channels("channel_angle", {}, x, y))).toEqual([90]);
    const transformed = channels("channel_transform", { rz: 90, tx: 2 }, x);
    expect(transformed.channels[0].samples[0]).toBeCloseTo(2);
    expect(transformed.channels[1].samples[0]).toBeCloseTo(1);
  });
  it("looks up curves and rejects nonmonotonic inverse curves", () => {
    expect(
      values(
        channels(
          "channel_lookup",
          {},
          makeChannels({ x: [0, 0.25, 0.5, 1] }),
          makeChannels({ x: [0, 10, 20] }),
        ),
      ),
    ).toEqual([0, 5, 10, 20]);
    expect(
      values(
        channels(
          "channel_inverse_curve",
          { samples: 3 },
          makeChannels({ x: [0, 0.25, 1] }),
        ),
      )[1],
    ).toBeCloseTo(2 / 3);
    expect(() =>
      channels("channel_inverse_curve", {}, makeChannels({ x: [0, 1, 0] })),
    ).toThrow(/单调/);
  });
});

describe("safe expression language and real audio DSP", () => {
  it("supports arithmetic functions while rejecting JS globals and property access", () => {
    expect(compileExpression("clamp(sin(pi/2)+x*2,0,4)")({ x: 3 })).toBe(4);
    expect(compileExpression("2^3^2")({})).toBe(512);
    expect(compileExpression("x>0 && x<2")({ x: 1 })).toBe(1);
    for (const expression of [
      "window.fetch('x')",
      "constructor(1)",
      "toString(1)",
      "globalThis",
      "x.constructor",
      "(()=>1)()",
      "Math.sin(1)",
    ])
      expect(() => compileExpression(expression)).toThrow();
    expect(() => compileExpression("1/0")({})).toThrow(/除数/);
    expect(
      values(channels("channel_expression", { expression: "x+y+i" }, data, 1)),
    ).toEqual([1, 3, 5, 7]);
  });
  it("FFT finds exact amplitude and physical frequency bins", () => {
    const input = Array.from(
      { length: 1024 },
      (_, i) => Math.sin((2 * Math.PI * 64 * i) / 1024) * 0.7,
    );
    const result = spectrum(input, 1024, false);
    expect(result[64]).toBeCloseTo(0.7, 10);
    expect(result[20]).toBeLessThan(1e-10);
    const buffer = channels(
      "audio_spectrum_chop",
      { fft_size: 1024, window: false },
      makeChannels({ audio: input }, 48000),
    );
    expect(buffer.sampleRate).toBeCloseTo(1024 / 48000);
    expect(values(buffer)[64]).toBeCloseTo(0.7, 10);
    expect(() =>
      channels("audio_spectrum_chop", { fft_size: 1000 }, data),
    ).toThrow(/2 的幂/);
  });
  it("FIR and biquad carry independent history through streaming blocks", () => {
    const source = [1, 0, 0, 0, 0, 0, 0, 0];
    for (const [type, params] of [
      ["channel_filter", { kernel: "[0.25,0.5,0.25]" }],
      ["audio_filter_chop", { frequency: 1000 }],
    ] as [string, Params][]) {
      const batch = values(
        channels(type, params, makeChannels({ a: source }, 48000)),
      );
      const state = new Map<string, unknown>();
      const first = values(
        channels(
          type,
          params,
          makeChannels({ a: source.slice(0, 3) }, 48000, 0, true),
          undefined,
          state,
          0,
        ),
      );
      const second = values(
        channels(
          type,
          params,
          makeChannels({ a: source.slice(3) }, 48000, 3, true),
          undefined,
          state,
          1,
        ),
      );
      expect([...first, ...second]).toEqual(batch);
    }
    expect(
      values(
        channels(
          "channel_filter",
          { kernel: "[0.25,0.5,0.25]" },
          makeChannels({ a: source }, 48000),
        ),
      ),
    ).toEqual([0.25, 0.5, 0.25, 0, 0, 0, 0, 0]);
  });
  it("lowpass attenuates high frequencies, EQ increases its target and limiter reduces peaks", () => {
    const sine = (frequency: number) =>
      makeChannels(
        {
          audio: Array.from({ length: 8192 }, (_, i) =>
            Math.sin((2 * Math.PI * frequency * i) / 48000),
          ),
        },
        48000,
      );
    const rms = (x: number[]) =>
      Math.sqrt(
        x.slice(4096).reduce((sum, v) => sum + v * v, 0) / (x.length - 4096),
      );
    const low = rms(
      values(channels("audio_filter_chop", { frequency: 1000 }, sine(100))),
    );
    const high = rms(
      values(channels("audio_filter_chop", { frequency: 1000 }, sine(10000))),
    );
    expect(low).toBeGreaterThan(0.65);
    expect(high).toBeLessThan(0.02);
    const eq = rms(
      values(
        channels("audio_para_eq", { frequency: 1000, gain: 6 }, sine(1000)),
      ),
    );
    expect(eq).toBeGreaterThan(1.3);
    const limited = values(
      channels(
        "audio_dynamics",
        { mode: "limiter", threshold: -6, attack: 0, release: 0 },
        makeChannels({ x: [0, 0.2, 1, -1] }, 48000),
      ),
    );
    expect(limited[2]).toBeCloseTo(10 ** (-6 / 20));
    expect(limited[3]).toBeCloseTo(-(10 ** (-6 / 20)));
  });
  it("sample delay, slope, integral and trigger operate per sample", () => {
    expect(values(channels("channel_delay", { seconds: 0.5 }, data))).toEqual([
      0, 0, 0, 1,
    ]);
    expect(values(channels("channel_slope", {}, data))).toEqual([0, 4, 4, 4]);
    expect(
      values(
        channels("channel_speed", {}, makeChannels({ x: [1, 1, 1, 1] }, 4)),
      ),
    ).toEqual([0.25, 0.5, 0.75, 1]);
    expect(
      values(
        channels("channel_count", {}, makeChannels({ x: [0, 1, 0, 1, 1] })),
      ),
    ).toEqual([0, 1, 1, 2, 2]);
    const envelope = values(
      channels(
        "channel_trigger",
        { attack: 0.2, decay: 0, sustain: 0.5, release: 0.2 },
        makeChannels({ gate: [1, 1, 1, 0, 0] }, 10),
      ),
    );
    expect(envelope).toEqual([0.5, 1, 0.5, 0.25, 0]);
  });
  it("spring remains stable for all advertised damping regimes", () => {
    for (const damping of [0.01, 0.5, 1, 2, 3]) {
      const result = values(
        channels(
          "channel_spring",
          { frequency: 100, damping },
          makeChannels({ target: Array(256).fill(1) }, 60),
        ),
      );
      expect(result.every(Number.isFinite)).toBe(true);
      expect(result.at(-1)).toBeCloseTo(1, 4);
    }
  });
});

describe("recording, keyframes and typed table workflows", () => {
  it("records multiple frames, rewinds state and emits previous-frame feedback", () => {
    const memory = new Map<string, unknown>();
    expect(
      values(channels("channel_record", {}, 1, undefined, memory, 0)),
    ).toEqual([1]);
    expect(
      values(channels("channel_record", {}, 2, undefined, memory, 1)),
    ).toEqual([1, 2]);
    expect(
      values(channels("channel_record", {}, 9, undefined, memory, 0)),
    ).toEqual([9]);
    const feedback = new Map<string, unknown>();
    expect(
      values(channels("channel_feedback", {}, 2, undefined, feedback, 0)),
    ).toEqual([0]);
    expect(
      values(channels("channel_feedback", {}, 3, undefined, feedback, 1)),
    ).toEqual([2]);
  });
  it("interpolates multiple named keyframe curves", () => {
    const result = channels("channel_keyframe", {
      keys: '{"x":[[0,0],[1,2]],"y":[[0,10],[1,0]]}',
      samples: 3,
      sample_rate: 2,
      loop: false,
    });
    expect(result.channels).toEqual([
      { name: "x", samples: [0, 1, 2] },
      { name: "y", samples: [10, 5, 0] },
    ]);
  });
  it("round trips table columns to sampled channels", () => {
    const table = makeTable([
      ["x", "y"],
      ["1", "10"],
      ["2", "20"],
    ]);
    const signal = channels("dat_to_channels", { sample_rate: 120 }, table);
    expect(signal.channels).toEqual([
      { name: "x", samples: [1, 2] },
      { name: "y", samples: [10, 20] },
    ]);
    expect(run("channels_to_dat", {}, signal)).toEqual(table);
  });
  it("performs real two-dimensional table edits and declarative transformations", () => {
    const table = makeTable([
      ["a", "1"],
      ["b", "2"],
    ]);
    expect(run("native_transpose", {}, table)).toEqual(
      makeTable([
        ["a", "b"],
        ["1", "2"],
      ]),
    );
    expect(
      run(
        "native_insert",
        { mode: "columns", index: 1 },
        table,
        makeTable([["x"], ["y"]]),
      ),
    ).toEqual(
      makeTable([
        ["a", "x", "1"],
        ["b", "y", "2"],
      ]),
    );
    expect(run("lookup_dat", { key: "b" }, table)).toEqual(makeTable([["2"]]));
    expect(
      run(
        "dat_script",
        {
          program:
            '[{"op":"filter","column":1,"expression":"x>1"},{"op":"select","columns":[1]}]',
        },
        table,
      ),
    ).toEqual(makeTable([["2"]]));
    expect(
      run(
        "dat_evaluate",
        { expression: "x+col", header: false },
        makeTable([
          [1, 2],
          [3, 4],
        ]),
      ),
    ).toEqual(
      makeTable([
        [1, 3],
        [3, 5],
      ]),
    );
  });
  it("emits precise cell and parameter change events without evaluating scripts", () => {
    const memory = new Map<string, unknown>();
    run("dat_dat_execute", {}, makeTable([["a", "1"]]), undefined, memory, 0);
    const event = run(
      "dat_dat_execute",
      {},
      makeTable([["a", "2"]]),
      undefined,
      memory,
      1,
    );
    expect(event).toEqual(
      makeTable([
        ["time", "event", "target", "before", "after"],
        [1, "cell_change", "0,1", "1", "2"],
      ]),
    );
    const target = node("channel_constant", { value: 1 }, "target");
    const project: Project = {
      id: "p",
      name: "test",
      version: 1,
      nodes: [target],
      edges: [],
    };
    const state = new Map<string, unknown>();
    run(
      "dat_parameter_execute",
      { node_id: "target", parameter: "value" },
      undefined,
      undefined,
      state,
      0,
      { project },
    );
    target.data.params.value = 2;
    const changes = run(
      "dat_parameter_execute",
      { node_id: "target", parameter: "value" },
      undefined,
      undefined,
      state,
      1,
      { project },
    );
    expect(isTableData(changes) && changes.rows[1]).toEqual([
      "1",
      "parameter_change",
      "target.value",
      "1",
      "2",
    ]);
  });
  it("rejects XML entities before browser parsing", () => {
    expect(() =>
      run("xml_dat", { xml: '<!DOCTYPE x SYSTEM "file:///etc/passwd"><x/>' }),
    ).toThrow(/DTD/);
  });
});

describe("panel events and repeated cooks", () => {
  it("records panel changes once, resolves relative paths and filters press events", () => {
    const panel: GraphNode = {
        id: "panel",
        type: "slider_comp",
        position: { x: 0, y: 0 },
        data: { label: "control", params: { value: 0 } },
      },
      project: Project = {
        id: "p",
        name: "panel",
        version: 1,
        nodes: [panel],
        edges: [],
      },
      state = new Map<string, unknown>();
    const watcher = node(
      "dat_panel_execute",
      { path: "../panel", mode: "on" },
      "network/watch",
    );
    const execute = () =>
      cookChannelDataNode(watcher, 1, () => undefined, state, { project });
    execute();
    panel.data.params.value = 1;
    const changed = execute();
    const repeated = execute();
    expect(changed).toEqual(repeated);
    expect(
      changed.handled && isTableData(changed.value) && changed.value.rows,
    ).toEqual([
      ["time", "event", "target", "before", "after"],
      ["1", "on", "panel.value", "0", "1"],
      ["1", "on", "panel.select", "0", "1"],
    ]);
    panel.data.params.value = 0;
    expect(execute()).toEqual(changed);
  });
  it("keeps recording when toggled off and does not process a streaming block twice", () => {
    const state = new Map<string, unknown>();
    channels("channel_record", { recording: true }, 1, undefined, state, 0);
    expect(
      values(
        channels(
          "channel_record",
          { recording: false },
          2,
          undefined,
          state,
          1,
        ),
      ),
    ).toEqual([1]);
    const source = makeChannels({ audio: [1, 0, 0, 0] }, 48000, 0, true),
      history = new Map<string, unknown>();
    const first = channels(
        "audio_filter_chop",
        {},
        source,
        undefined,
        history,
        0,
      ),
      second = channels("audio_filter_chop", {}, source, undefined, history, 0);
    expect(second).toEqual(first);
    const feedback = new Map<string, unknown>();
    expect(channels("channel_feedback", {}, 2, undefined, feedback, 0)).toEqual(
      channels("channel_feedback", {}, 2, undefined, feedback, 0),
    );
  });
  it("uses conventional exponent precedence", () => {
    expect(compileExpression("-2^2")({})).toBe(-4);
    expect(compileExpression("2^-2")({})).toBe(0.25);
  });
});

describe("catalog execution coverage", () => {
  const project: Project = {
    id: "p",
    name: "coverage",
    version: 1,
    nodes: [node("channel_constant", { value: 1 }, "target")],
    edges: [],
  };
  for (const spec of channelDataCatalog.filter(
    (item) =>
      !["top_to_channels", "xml_dat", "channel_blob_track"].includes(item.type),
  )) {
    it(`${spec.family} ${spec.type} has a concrete finite execution path`, () => {
      let input: unknown =
        spec.family === "DAT"
          ? makeTable([
              ["name", "value"],
              ["alpha", "1"],
              ["beta", "2"],
            ])
          : data;
      let second: unknown = input;
      if (spec.inputs[0]?.kind === "SOP") input = { shape: "box", detail: 8 };
      if (spec.inputs[0]?.kind === "CHOP") input = data;
      if (spec.type === "dat_to_channels")
        input = makeTable([
          ["x", "y"],
          ["1", "2"],
          ["3", "4"],
        ]);
      const parameters: Params = [
        "channel_parameter",
        "dat_parameter",
        "dat_parameter_execute",
        "dat_pargroup_execute",
      ].includes(spec.type)
        ? { node_id: "target", parameters: "value" }
        : {};
      if (spec.family === "CHOP")
        second = makeChannels(
          { x: [1, 2, 3, 4], y: [1, 2, 3, 4], z: [1, 2, 3, 4] },
          4,
        );
      if (spec.type === "dat_panel_execute") parameters.path = "target";
      if (spec.type === "channel_import_select")
        input = '{"walk":{"tx":[0,1],"ty":[1,2]}}';
      if (spec.type === "native_json") input = '[{"a":1,"b":2},{"a":3,"b":4}]';
      if (spec.type === "channel_object")
        input = {
          kind: "scene",
          objects: [
            { geometry: { shape: "box", detail: 8 }, position: [1, 2, 3] },
          ],
          lights: [],
        };
      const output = run(spec.type, parameters, input, second, undefined, 1, {
        project,
      });
      if (isChannelBuffer(output)) {
        expect(
          output.channels.every((ch) => ch.samples.every(Number.isFinite)),
        ).toBe(true);
      } else
        expect(
          isTableData(output) ||
            typeof output === "string" ||
            typeof output === "number",
        ).toBe(true);
    });
  }
});
