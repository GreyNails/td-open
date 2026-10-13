import { afterEach, describe, expect, it, vi } from "vitest";
import type { GraphNode, Params } from "../types";
import { ioCatalog, ioReferenceKeys } from "./ioCatalog";
import { channelsFromIO, cookIONode, disposeIOState } from "./ioRuntime";
const node = (type: string, params: Params = {}): GraphNode => ({
  id: "io-test",
  type,
  position: { x: 0, y: 0 },
  data: {
    label: type,
    params: {
      ...Object.fromEntries(
        ioCatalog
          .find((n) => n.type === type)!
          .params.map((p) => [p.key, p.default]),
      ),
      ...params,
    },
  },
});
const response = (value: unknown, ok = true) =>
  Promise.resolve({ ok, json: async () => value });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
afterEach(() => vi.unstubAllGlobals());

describe("I/O value interoperability", () => {
  it("preserves named multi-channel samples and their time metadata", () => {
    const value = {
      kind: "channels",
      channels: [
        { name: "tx", samples: [1, 2, 3] },
        { name: "ty", samples: [4, 5, 6] },
      ],
      sampleRate: 120,
      start: 48,
      timeSlice: true,
    };
    expect(channelsFromIO(value)).toEqual(value);
    expect(
      channelsFromIO({ address: "/pose", args: [0.25, 0.75] }).channels,
    ).toEqual([
      { name: "chan1", samples: [0.25] },
      { name: "chan2", samples: [0.75] },
    ]);
    expect(
      channelsFromIO({
        topic: "sensor",
        payload: { temperature: 21, humidity: 42 },
      }).channels.map((c) => c.name),
    ).toEqual(["temperature", "humidity"]);
  });
  it("rejects corrupt values instead of fabricating zero readings", () => {
    expect(() =>
      channelsFromIO({
        kind: "channels",
        channels: [{ name: "x", samples: [] }],
      }),
    ).toThrow();
    expect(() => channelsFromIO("not a measurement")).toThrow();
    expect(() => channelsFromIO(null)).toThrow();
    expect(() =>
      channelsFromIO({
        kind: "channels",
        channels: [{ name: "x", samples: [1, "bad", 2] }],
      }),
    ).toThrow();
    expect(() =>
      channelsFromIO({
        kind: "channels",
        channels: [
          { name: "x", samples: [1] },
          { name: "x", samples: [2] },
        ],
      }),
    ).toThrow();
    expect(() =>
      channelsFromIO({
        kind: "channels",
        channels: [
          { name: "x", samples: [1] },
          { name: "y", samples: [2, 3] },
        ],
      }),
    ).toThrow();
  });
  it("supports an entire 512-slot DMX universe", () => {
    const value = channelsFromIO({
      universe: 3,
      channels: Array.from({ length: 512 }, (_, i) => i % 256),
    });
    expect(value.channels).toHaveLength(512);
    expect(value.channels[511].samples).toEqual([255]);
  });
  it("all entries are opt-in and external drivers disclose their limits", () => {
    expect(ioReferenceKeys.size).toBe(ioCatalog.length);
    for (const item of ioCatalog) {
      expect(item.params.find((p) => p.key === "enabled")!.default).toBe(false);
      if (item.label.includes("外部桥接"))
        expect(item.description).toContain("未内置原生驱动");
    }
  });
});
describe("asynchronous graph I/O lifecycle", () => {
  it("disabled nodes cause no network requests", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const result = cookIONode(
      node("ref_chop_osc_in"),
      0,
      () => undefined,
      new Map(),
    );
    expect(result.handled).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("opens once, polls actual server messages and exposes channel data", async () => {
    const fetch = vi.fn((url: string) =>
      response(
        url.endsWith("/sessions")
          ? { id: "real-session" }
          : {
              messages: [
                { seq: 5, value: { address: "/sensor", args: [11, 22] } },
              ],
              state: "ready",
              error: "",
            },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const state = new Map<string, unknown>(),
      n = node("ref_chop_osc_in", { enabled: true });
    cookIONode(n, 0, () => undefined, state);
    await flush();
    const result = cookIONode(n, 0.1, () => undefined, state);
    expect(result).toMatchObject({
      handled: true,
      value: { channels: [{ samples: [11] }, { samples: [22] }] },
    });
    expect(
      fetch.mock.calls.filter(([url]) => url.endsWith("/sessions")),
    ).toHaveLength(1);
    disposeIOState(state);
    await flush();
    expect(fetch).toHaveBeenCalledWith(
      "/api/io/sessions/real-session",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
  it("closes a session whose creation races with node deletion", async () => {
    let resolveCreate!: (value: unknown) => void;
    const fetch = vi.fn((url: string) =>
      url.endsWith("/sessions")
        ? new Promise((resolve) => {
            resolveCreate = resolve;
          })
        : response({ closed: true }),
    );
    vi.stubGlobal("fetch", fetch);
    const state = new Map<string, unknown>();
    cookIONode(
      node("ref_dat_udp_in", { enabled: true }),
      0,
      () => undefined,
      state,
    );
    disposeIOState(state);
    resolveCreate({ ok: true, json: async () => ({ id: "raced-session" }) });
    await flush();
    expect(fetch).toHaveBeenCalledWith(
      "/api/io/sessions/raced-session",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(fetch.mock.calls.some(([url]) => url.includes("/messages"))).toBe(
      false,
    );
  });
  it("reports missing native adapters without fake samples", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        response(
          url.endsWith("/sessions")
            ? { id: "bridge" }
            : { messages: [], state: "ready", error: "" },
        ),
      ),
    );
    const state = new Map<string, unknown>(),
      n = node("ref_chop_kinect", { enabled: true });
    cookIONode(n, 0, () => undefined, state);
    await flush();
    expect(() => cookIONode(n, 0.1, () => undefined, state)).toThrow(
      "未内置原生驱动",
    );
    disposeIOState(state);
    await flush();
  });
  it("does not repeat writes for identical upstream data", async () => {
    const fetch = vi.fn(() => response({ written: 5 }));
    vi.stubGlobal("fetch", fetch);
    const state = new Map<string, unknown>(),
      n = node("ref_dat_file_out", { enabled: true, interval: 30 });
    cookIONode(n, 0, () => "hello", state);
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 35));
    cookIONode(n, 1, () => "hello", state);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
