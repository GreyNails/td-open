// Rebuild public example documents from the same presets the UI uses.
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "../frontend/node_modules/typescript/lib/typescript.js";
const root = path.resolve(import.meta.dirname, "..");
const temporary = path.join(root, ".cache/example-builder");
const sourceRoot = path.join(root, "frontend/src");
await fs.mkdir(temporary, { recursive: true });
await fs.mkdir(path.join(root, "examples"), { recursive: true });
const compiled = new Set();
async function compileModule(filename) {
  filename = path.resolve(filename);
  if (!path.extname(filename)) filename += ".ts";
  if (!filename.startsWith(sourceRoot + path.sep))
    throw new Error("Example imports must stay in frontend/src");
  if (compiled.has(filename)) return;
  compiled.add(filename);
  const source = await fs.readFile(filename, "utf8");
  for (const { fileName } of ts.preProcessFile(source).importedFiles) {
    if (fileName.startsWith("."))
      await compileModule(path.resolve(path.dirname(filename), fileName));
  }
  const code = ts
    .transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    })
    .outputText.replace(
      /(from\s+["'])(\.[^"']+)(["'])/g,
      (_, start, name, end) => `${start}${name.replace(/\.ts$/, "")}.mjs${end}`,
    );
  const destination = path.join(
    temporary,
    path.relative(sourceRoot, filename).replace(/\.ts$/, ".mjs"),
  );
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, code);
}
await compileModule(path.join(sourceRoot, "catalog.ts"));
const { preset } = await import(
  pathToFileURL(path.join(temporary, "catalog.mjs"))
);
const documents = new Map();
for (const kind of [
  "flow",
  "particles",
  "3d",
  "ai",
  "empty",
  "kaleidoscope",
  "geometry-lab",
  "data-driven",
]) {
  documents.set(kind, preset(kind));
}
for (const [kind, project] of documents) {
  project.id = "example_" + kind;
  const names = new Map(
    project.nodes.map((node, index) => [node.id, `${node.type}_${index + 1}`]),
  );
  for (const node of project.nodes) node.id = names.get(node.id);
  for (const [index, edge] of project.edges.entries()) {
    edge.id = `edge_${index + 1}`;
    edge.source = names.get(edge.source);
    edge.target = names.get(edge.target);
  }
  await fs.writeFile(
    path.join(root, "examples", kind + ".tdopen.json"),
    JSON.stringify(project, null, 2) + "\n",
  );
}
console.log(`Wrote ${documents.size} versioned example projects to examples/`);
