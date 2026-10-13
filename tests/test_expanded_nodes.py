"""Expanded graph workflows and browser/Python stateless execution parity."""

import json
import shutil
import subprocess

import pytest

from backend.catalog import NODE_TYPES
from backend.data_runtime import STATELESS_TYPES, evaluate_data
from backend.graph import apply_commands, validate_graph
from backend.integrations import ChatRequest, local_chat, validate_chat_commands
from backend.models import Project
from backend.runtime import evaluate
from backend.storage import ROOT


def node(identifier, kind, **params):
    return {"id": identifier, "type": kind, "data": {"params": params}}


def graph(nodes, connections=()):
    return Project(id="expanded", name="Expanded workflow", nodes=nodes, edges=[
        {"id": f"edge_{i}", "source": source, "target": target, "targetHandle": port}
        for i, (source, target, port) in enumerate(connections)
    ])


def test_csv_json_signal_pipeline_and_python_plugin():
    project = graph([
        node("source", "table_dat", csv='name,value\n"alpha, beta",42', mode="json"),
        node("cell", "json_select", path="1.1"),
        node("number", "dat_to_chop"),
        node("normalized", "range", in_max=100, out_max=1),
        node("plugin", "python_scale", factor=10),
    ], [("source", "cell", "in"), ("cell", "number", "in"),
        ("number", "normalized", "in"), ("normalized", "plugin", "in")])
    result = evaluate(project)
    assert result["errors"] == {}
    assert result["skipped"] == []
    assert result["values"]["plugin"] == pytest.approx(4.2)


def test_invalid_data_stops_only_dependent_branch():
    project = graph([node("bad", "text_dat", text="{broken}"), node("pick", "json_select"),
                     node("dependent", "dat_to_chop"), node("clock", "time", speed=2, offset=3)],
                    [("bad", "pick", "in"), ("pick", "dependent", "in")])
    result = evaluate(project, time=4)
    assert result["values"]["clock"] == 11
    assert "JSON" in result["errors"]["pick"]
    assert "上游" in result["errors"]["dependent"]
    assert "dependent" not in result["values"]


@pytest.mark.parametrize("kind", ["lag", "speed", "counter", "trigger", "derivative", "hold"])
def test_stateful_nodes_are_explicitly_skipped_by_stateless_http_runtime(kind):
    project = graph([node("clock", "time"), node("state", kind), node("after", "abs"),
                     node("independent", "constant", value=7)],
                    [("clock", "state", "in"), ("state", "after", "in")])
    result = evaluate(project, time=2)
    assert result["values"] == {"clock": 2, "independent": 7}
    assert set(result["skipped"]) == {"state", "after"}
    assert "连续帧" in result["skip_reasons"]["state"]
    assert "上游" in result["skip_reasons"]["after"]


@pytest.mark.parametrize("message,kind", [
    ("添加随机信号", "noise_chop"), ("add Noise CHOP", "noise_chop"),
    ("create noise_chop", "noise_chop"), ("添加 JSON 取值", "json_select"),
    ("add JSON Select", "json_select"), ("添加几何变换", "transform_sop"),
    ("create Transform SOP", "transform_sop"), ("添加立方体", "box"),
    ("add Constant TOP", "solid"), ("添加万花筒", "kaleidoscope"),
    ("添加反馈拖影", "feedback"), ("add Python 倍率", "python_scale"),
    ("添加噪声", "noise"), ("add particles", "particles"),
])
def test_local_dialogue_matches_most_specific_catalog_name(message, kind):
    project = graph([])
    result = local_chat(ChatRequest(message=message, project=project.model_dump()))
    commands = result["commands"]
    assert len(commands) == 1
    assert commands[0]["type"] == kind
    validate_chat_commands(commands, project.model_dump())
    updated = apply_commands(project, commands)
    assert validate_graph(updated) == []
    assert updated.nodes[0].data.params == NODE_TYPES[kind]["defaults"]


@pytest.mark.parametrize("message", ["add unknown_noise_kind", "create not_a_text_node", "add invisible_operator"])
def test_local_dialogue_does_not_guess_from_partial_identifiers(message):
    assert local_chat(ChatRequest(message=message))["commands"] == []


def test_every_registered_builtin_accepts_its_default_schema():
    manifest = json.loads((ROOT / "backend/operator_catalog.json").read_text())
    assert len(manifest) >= 90
    assert validate_graph(graph([node(f"n_{item['type']}", item["type"]) for item in manifest])) == []
    assert set(STATELESS_TYPES) <= set(NODE_TYPES)


def test_stateless_execution_matches_browser_for_negative_time_ranges_csv_and_unicode():
    bundled = ROOT / ".tools/node-v22.21.1-linux-x64/bin/node"
    executable = str(bundled) if bundled.is_file() else shutil.which("node")
    if not executable or not (ROOT / "frontend/node_modules/typescript").is_dir():
        pytest.skip("Install frontend dependencies for cross-runtime verification")
    cases = [{"kind": kind, "params": {}, "inputs": {}, "time": 0.25} for kind in sorted(STATELESS_TYPES)]
    variations = [
        ("quantize", {"step": 0.5}, {"in": -0.75}),
        ("quantize", {"step": 0}, {"in": 1}),
        ("quantize", {"step": -0.5, "mode": "ceil"}, {"in": -0.75}),
        ("range", {"in_min": 2, "in_max": 2}, {"in": 1}),
        ("range", {"in_min": 2, "in_max": -2, "out_max": 10}, {"in": 0.5}),
        ("limit", {"min": 2, "max": -2, "mode": "mirror"}, {"in": -4.2}),
        ("limit", {"mode": "wrap"}, {"in": -4.2}),
        ("limit", {"min": 3, "max": 3}, {"in": -4.2}),
        ("logic", {"operation": "and", "value": 0.5}, {"in": 0.4, "in2": 0.8}),
        ("logic", {"operation": "not", "value": -1}, {"in": 0}),
        ("logic", {"operation": "between", "value": 5, "high": 2}, {"in": 3}),
        ("logic", {"operation": "equal"}, {"in": 0.50000000001}),
        ("switch_chop", {"index": "0"}, {"in": 2, "in2": 8, "mod": 0.75}),
        ("sine", {"unit": "degrees", "amplitude": 3}, {"in": 90}),
        ("case_text", {"mode": "reverse"}, {"in": "A🎨中"}),
        ("replace_text", {"find": "", "replace": "x"}, {"in": "hello"}),
        ("split_text", {}, {"in": "a, b,,c"}),
        ("split_text", {"separator": ""}, {"in": "A🎨中"}),
        ("json_select", {"path": "items.0.name"}, {"in": '{"items":[{"name":"创作"}]}'}),
        ("json_select", {"path": "missing", "fallback": "none"}, {"in": '{}'}),
        ("json_select", {"path": "01", "fallback": "none"}, {"in": '[1,2]'}),
        ("json_select", {"path": "length"}, {"in": '[1,2]'}),
        ("json_select", {"path": "toString", "fallback": "safe"}, {"in": '{}'}),
        ("json_select", {}, {"in": '{bad}'}),
        ("table_dat", {"mode": "json"}, {"in": 'a,b\r\n"hello, world","say ""hi"""\n\n"two\nlines",42\n'}),
        ("table_dat", {"mode": "json"}, {"in": ''}),
        ("table_dat", {"mode": "cell", "row": 1, "column": 0}, {"in": 'a,b\n"hello\nworld",42'}),
        ("table_dat", {"mode": "json"}, {"in": '"unfinished'}),
        ("table_dat", {"mode": "json"}, {"in": '"closed"junk'}),
        ("dat_to_chop", {"fallback": 9}, {"in": ' 0x20 '}),
        ("dat_to_chop", {"fallback": 9}, {"in": '1_000'}),
        ("dat_to_chop", {"fallback": 9}, {"in": '1e400'}),
        ("dat_to_chop", {"fallback": 9}, {"in": ' '}),
    ]
    cases.extend({"kind": kind, "params": params, "inputs": inputs, "time": -0.35} for kind, params, inputs in variations)
    for case in cases:
        case["params"] = {**NODE_TYPES[case["kind"]]["defaults"], **case["params"]}
    script = r"""
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from './frontend/node_modules/typescript/lib/typescript.js';
const requirePackage = createRequire(path.resolve('frontend/package.json'));
const cache = new Map();
function load(file) {
  file = path.resolve(file); if (!path.extname(file)) file += '.ts';
  if (cache.has(file)) return cache.get(file).exports;
  const module = {exports: {}}; cache.set(file, module);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code, {module, exports: module.exports, TextEncoder, TextDecoder, btoa, atob, require: name => name.startsWith('.') ? load(path.resolve(path.dirname(file), name)) : requirePackage(name)}, {filename: file});
  return module.exports;
}
const {cookDataNode} = load('frontend/src/nodes/dataRuntime.ts');
const {cookAdvancedDataNode} = load('frontend/src/nodes/advancedDataRuntime.ts');
const results = JSON.parse(fs.readFileSync(0, 'utf8')).map(({kind, params, inputs, time}) => {
  try { const args = [{id:'test', type:kind, data:{params}}, time, (handle='in') => inputs[handle], new Map()]; const advanced = cookAdvancedDataNode(...args); return {value: (advanced.handled ? advanced : cookDataNode(...args)).value}; }
  catch (error) { return {error: String(error)}; }
});
process.stdout.write(JSON.stringify(results));
"""
    completed = subprocess.run([executable, "--input-type=module", "-e", script], input=json.dumps(cases),
                               capture_output=True, text=True, check=True, cwd=ROOT, timeout=30)
    for case, browser in zip(cases, json.loads(completed.stdout), strict=True):
        try:
            value = evaluate_data(case["kind"], case["params"], case["inputs"], case["time"])
        except ValueError:
            assert "error" in browser, case
            continue
        assert "value" in browser, (case, browser)
        if isinstance(value, (int, float)):
            assert value == pytest.approx(browser["value"], abs=1e-9), case
        else:
            assert value == browser["value"], case
