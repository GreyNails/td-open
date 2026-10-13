#!/usr/bin/env node
/** Generate Python's built-in operator manifest from the editor's source schema. */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "../frontend/node_modules/typescript/lib/typescript.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "frontend", "src");
const cache = new Map();

// These are trusted repository sources. Resolve each local TypeScript import so
// adding a catalog module never requires updating a separate Python definition.
function loadModule(filename) {
  filename = path.resolve(filename);
  if (!filename.startsWith(sourceRoot + path.sep))
    throw new Error(`Catalog import must be inside frontend/src: ${filename}`);
  if (!path.extname(filename)) filename += ".ts";
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} };
  cache.set(filename, module);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
    reportDiagnostics: true,
  });
  const errors = compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error) || [];
  if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
    getCurrentDirectory: () => root,
    getCanonicalFileName: (name) => name,
    getNewLine: () => "\n",
  }));
  vm.runInNewContext(compiled.outputText, {
    module, exports: module.exports,
    require: (request) => {
      if (!request.startsWith(".")) throw new Error(`Catalog cannot import packages: ${request}`);
      return loadModule(path.resolve(path.dirname(filename), request));
    },
  }, { filename });
  return module.exports;
}

const catalog = loadModule(path.join(sourceRoot, "catalog.ts")).catalog;
if (!Array.isArray(catalog) || !catalog.length) throw new Error("Empty operator catalog");
const seen = new Set();
for (const spec of catalog) {
  if (!spec.type || seen.has(spec.type)) throw new Error(`Duplicate/empty node type: ${spec.type}`);
  seen.add(spec.type);
  for (const field of ["inputs", "outputs", "params"])
    if (!Array.isArray(spec[field])) throw new Error(`${spec.type}.${field} must be an array`);
}
const manifest = JSON.stringify(catalog, null, 2) + "\n";
const destination = path.join(root, "backend", "operator_catalog.json");
if (process.argv.includes("--stdout")) process.stdout.write(manifest);
else if (process.argv.includes("--check")) {
  if (!fs.existsSync(destination) || fs.readFileSync(destination, "utf8") !== manifest) {
    console.error("Operator manifest is stale. Run node scripts/sync-catalog.mjs");
    process.exitCode = 1;
  } else console.log(`Operator manifest is current (${catalog.length} nodes).`);
} else {
  fs.writeFileSync(destination, manifest);
  console.log(`Updated backend/operator_catalog.json (${catalog.length} nodes).`);
}
