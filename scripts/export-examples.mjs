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
const { templates } = await import(
  pathToFileURL(path.join(temporary, "templates.mjs"))
);
for (const kind of [...templates.map((t) => t.id), "empty"]) {
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
const header = `# 案例索引\n\n62 个可编辑案例，加 1 份空白作品。点击编辑器的“示例作品”可以搜索、分类、筛选并打开；也可以下载下列 JSON 后导入。缩略图来自内置引擎的实际输出；AI / MCP 案例使用明确标注的连接说明卡片。\n\n![部分实际输出](images/example-showcase.png)\n\n`;
let guide = header;
for (const category of new Set(templates.map((t) => t.category))) {
  guide += `## ${category}\n\n| 案例 | 节点数 | 练习方向 | 运行条件 |\n| --- | ---: | --- | --- |\n`;
  for (const t of templates.filter((t) => t.category === category))
    guide += `| [${t.name}](../examples/${t.id}.tdopen.json) | ${documents.get(t.id).nodes.length} | ${t.learn.replaceAll("|", "／")} | ${t.requires === "ai" ? "配置 AI 服务，手动生成" : t.requires === "mcp" ? "连接 MCP，手动调用" : t.requires === "audio" ? "导入音频或授权麦克风" : "无需外部服务"} |\n`;
  guide += "\n";
}
guide +=
  "[创建空白作品](../examples/empty.tdopen.json)\n\n新增案例请编辑 `frontend/src/templates.ts`，然后运行 `node scripts/export-examples.mjs`。浏览器缩略图由 `TD_CHROMIUM=/path/to/chromium node frontend/render-examples.mjs` 生成，脚本同时检查全部案例的实际执行错误。\n";
await fs.writeFile(path.join(root, "docs/EXAMPLES.md"), guide);
