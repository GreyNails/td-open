import { describe, expect, it } from "vitest";
import { makeChannels } from "../runtimeValues";
import { encodeWAV, MediaRuntime } from "./mediaRuntime";

describe("PCM audio export", () => {
  it("writes standard stereo PCM16 WAV with correct byte order and clipping", () => {
    const bytes = encodeWAV(
      makeChannels(
        { left: [-2, -0.5, 0, 0.5, 2], right: [1, 0.5, 0, -0.5, -1] },
        48000,
      ),
    );
    const view = new DataView(bytes),
      text = (offset: number, length: number) =>
        new TextDecoder().decode(bytes.slice(offset, offset + length));
    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 4)).toBe("WAVE");
    expect(text(36, 4)).toBe("data");
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint32(40, true)).toBe(20);
    expect(
      Array.from({ length: 10 }, (_, i) => view.getInt16(44 + i * 2, true)),
    ).toEqual([
      -32768, 32767, -16384, 16384, 0, 0, 16384, -16384, 32767, -32768,
    ]);
  });
  it("requires an actual nonempty signal to export", () => {
    expect(() => encodeWAV(makeChannels({ empty: [] }))).toThrow(/非空/);
  });
  it("does not open devices or fetch on ordinary cook", () => {
    const runtime = new MediaRuntime();
    expect(() =>
      runtime.cook(
        {
          id: "file",
          type: "media_audio_file_in",
          position: { x: 0, y: 0 },
          data: {
            label: "audio",
            params: { url: "https://example.invalid/file.wav" },
          },
        },
        0,
        () => undefined,
      ),
    ).toThrow(/启用媒体/);
    expect(runtime.status("file").active).toBe(false);
    runtime.dispose();
  });
});
