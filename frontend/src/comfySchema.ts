export type ComfySchema = [string | unknown[], Record<string, unknown>?];
export function comfyDefaults(required: Record<string, ComfySchema>) {
  const values: Record<string, unknown> = {},
    names: string[] = [];
  const visit = (inputs: Record<string, ComfySchema>, prefix = "") => {
    for (const [key, schema] of Object.entries(inputs)) {
      const name = prefix + key,
        kind = schema[0],
        options = schema[1] || {};
      if (Array.isArray(kind)) values[name] = options.default ?? kind[0] ?? "";
      else if (["INT", "FLOAT", "STRING", "BOOLEAN"].includes(kind))
        values[name] =
          options.default ??
          (kind === "STRING" ? "" : kind === "BOOLEAN" ? false : 0);
      else if (kind === "COMBO") {
        const choices = options.options as unknown[] | undefined;
        values[name] = options.default ?? choices?.[0] ?? "";
      } else if (kind === "COMFY_DYNAMICCOMBO_V3") {
        const choices = options.options as
          | {
              key: string;
              inputs?: { required?: Record<string, ComfySchema> };
            }[]
          | undefined;
        const selected =
          choices?.find((choice) => choice.key === options.default) ||
          choices?.[0];
        if (selected) {
          values[name] = selected.key;
          visit(selected.inputs?.required || {}, name + ".");
        }
      } else names.push(name);
    }
  };
  visit(required);
  return { values, names };
}
