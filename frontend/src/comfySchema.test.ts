import { describe, expect, it } from "vitest";
import { comfyDefaults } from "./comfySchema";
describe("Comfy object_info defaults", () => {
  it("keeps tensor inputs separate from primitive and combo widgets", () => {
    expect(
      comfyDefaults({
        model: ["MODEL"],
        seed: ["INT", { default: 42 }],
        sampler: [["euler", "heun"]],
        mode: ["COMBO", { options: ["simple", "normal"] }],
      }),
    ).toEqual({
      values: { seed: 42, sampler: "euler", mode: "simple" },
      names: ["model"],
    });
  });
  it("expands required V3 dynamic inputs to native dotted widget names", () => {
    const result = comfyDefaults({
      video: ["VIDEO"],
      format: [
        "COMFY_DYNAMICCOMBO_V3",
        {
          default: "mp4",
          options: [
            { key: "auto" },
            {
              key: "mp4",
              inputs: {
                required: {
                  codec: [
                    "COMFY_DYNAMICCOMBO_V3",
                    {
                      options: [
                        {
                          key: "h264",
                          inputs: {
                            required: { crf: ["FLOAT", { default: 18 }] },
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    });
    expect(result).toEqual({
      values: { format: "mp4", "format.codec": "h264", "format.codec.crf": 18 },
      names: ["video"],
    });
  });
});
