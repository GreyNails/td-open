// Rebuild public example documents from the same presets the UI uses.
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "../frontend/node_modules/typescript/lib/typescript.js";
const root = path.resolve(import.meta.dirname, "..");
const temporary = path.join(root, ".cache/example-builder");
await fs.mkdir(temporary, { recursive: true });
await fs.mkdir(path.join(root, "examples"), { recursive: true });
for (const name of ["types", "catalog"]) {
  const source = await fs.readFile(
    path.join(root, "frontend/src", name + ".ts"),
    "utf8",
  );
  const code = ts
    .transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    })
    .outputText.replace(/(["'])\.\/types\1/g, '"./types.mjs"');
  await fs.writeFile(path.join(temporary, name + ".mjs"), code);
}
const { preset } = await import(
  pathToFileURL(path.join(temporary, "catalog.mjs"))
);
for (const kind of ["flow", "particles", "3d", "ai", "empty"]) {
  const project = preset(kind);
  project.id = "example_" + kind;
  await fs.writeFile(
    path.join(root, "examples", kind + ".tdopen.json"),
    JSON.stringify(project, null, 2) + "\n",
  );
}
console.log("Wrote five versioned example projects to examples/");
