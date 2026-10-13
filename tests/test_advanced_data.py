"""Representative workflows and cross-language semantics for v0.3 operators."""
import json
import shutil
import subprocess

import pytest

from backend.catalog import NODE_TYPES
from backend.data_runtime import ADVANCED_STATELESS_TYPES, evaluate_data
from backend.models import Project
from backend.runtime import evaluate
from backend.storage import ROOT


@pytest.mark.parametrize("kind", ["spring", "delay_chop", "moving_average", "peak_chop", "rms_chop", "adsr", "hysteresis", "random_hold", "timer_chop", "slew_chop"])
def test_temporal_operators_require_browser_history(kind):
    project = Project(id="advanced", name="history", nodes=[
        {"id": "n", "type": kind, "data": {"params": {}}},
        {"id": "after", "type": "abs", "data": {"params": {}}},
    ], edges=[{"id": "e", "source": "n", "target": "after", "targetHandle": "in"}])
    result = evaluate(project)
    assert result["errors"] == {}
    assert result["values"] == {}
    assert set(result["skipped"]) == {"n", "after"}
    assert "连续帧" in result["skip_reasons"]["n"]


def test_representative_csv_sort_to_json_workflow():
    project = Project(id="advanced_csv", name="csv", nodes=[
        {"id": "csv", "type": "text_dat", "data": {"params": {"text": "name,value\na,10\nb,2"}}},
        {"id": "sort", "type": "table_sort", "data": {"params": {}}},
        {"id": "json", "type": "table_to_json", "data": {"params": {}}},
        {"id": "select", "type": "json_select", "data": {"params": {"path": "0.value"}}},
        {"id": "number", "type": "dat_to_chop", "data": {"params": {}}},
    ], edges=[{"id": str(index), "source": source, "target": target, "targetHandle": "in"}
              for index, (source, target) in enumerate(zip(["csv", "sort", "json", "select"], ["sort", "json", "select", "number"]))])
    result = evaluate(project)
    assert not result["errors"]
    assert not result["skipped"]
    assert result["values"]["number"] == 2
    assert result["values"]["json"] == '[{"name":"b","value":2},{"name":"a","value":10}]'


def test_advanced_scalar_text_parity_with_browser():
    node = ROOT / ".tools/node-v22.21.1-linux-x64/bin/node"
    executable = str(node) if node.is_file() else shutil.which("node")
    if not executable or not (ROOT / "frontend/node_modules/typescript").is_dir():
        pytest.skip("Install frontend dependencies for cross-runtime verification")
    rows = [
        ("weighted_sum", {}, {"in": 3, "in2": 2, "in3": 4}),
        ("function_chop", {"function": "sqrt"}, {"in": -1}),
        ("function_chop", {"function": "log"}, {"in": 0}),
        ("function_chop", {"function": "power", "exponent": .5}, {"in": 4}),
        ("function_chop", {"function": "tanh"}, {"in": 2}),
        ("atan2", {}, {"in": 1, "in2": -1}),
        ("mix_chop", {}, {"in": 2, "in2": 10, "mod": .25}),
        ("mix_chop", {"clamp": False}, {"in": 2, "in2": 10, "mod": 2}),
        ("ease_chop", {"curve": "bounce", "direction": "in_out"}, {"in": .72}),
        ("ease_chop", {"curve": "cubic", "direction": "out"}, {"in": .25}),
        ("smoothstep", {"smoother": True}, {"in": .3}),
        ("smoothstep", {"edge0": 1, "edge1": 1}, {"in": .3}),
        ("angle_wrap", {}, {"in": 540}),
        ("angle_distance", {}, {"in": 350, "in2": 10}),
        ("sequence_chop", {"values": "1,4,2", "mode": "linear"}, {}),
        ("sequence_chop", {"values": "1,no,3"}, {}),
        ("gaussian_chop", {"center": 2, "sigma": 3, "amplitude": 4}, {"in": 4}),
        ("exponential_chop", {}, {"in": 1.25}),
        ("damped_wave", {"frequency": 2, "repeat": 1}, {}),
        ("text_length", {}, {"in": "光🌈影"}),
        ("text_length", {"mode": "words"}, {"in": "a  b\n c"}),
        ("substring_dat", {"start": -2, "length": 1}, {"in": "光🌈影"}),
        ("pad_dat", {"length": 5, "fill": "🌈a"}, {"in": "光"}),
        ("format_dat", {"template": "{in}/{in2}/{in}"}, {"in": "$&", "in2": "光"}),
        ("encode_dat", {"mode": "base64_encode"}, {"in": "光🌈影"}),
        ("encode_dat", {"mode": "base64_decode"}, {"in": "5YWJ8J+MiOW9sQ=="}),
        ("encode_dat", {"mode": "url_encode"}, {"in": "光 /&+?!'()"}),
        ("encode_dat", {"mode": "url_decode"}, {"in": "%E5%85%89%20%2F"}),
        ("encode_dat", {"mode": "url_decode"}, {"in": "%AA"}),
        ("sort_dat", {"numeric": True}, {"in": "10\n2\n1"}),
        ("sort_dat", {"format": "json"}, {"in": '["光",3,{"a":1},true]'}),
        ("unique_dat", {"format": "json"}, {"in": '[1,2,1,"1",{"a":1},{"a":1}]'}),
        ("filter_dat", {"query": "a.", "mode": "starts", "invert": True}, {"in": "a.x\na*x\nb"}),
        ("join_dat", {"separator": " / "}, {"in": '[1,{"a":2},"光"]'}),
        ("json_merge", {}, {"in": '{"a":1,"b":2}', "in2": '{"b":3}'}),
        ("json_set", {"path": "items.0.name", "value": '"光"'}, {"in": '{}'}),
        ("json_set", {"path": "0", "value": '1'}, {"in": '[]'}),
        ("json_set", {"path": "items.01", "value": '1'}, {"in": '{"items":[]}'}),
        ("json_set", {"path": "__proto__.polluted", "value": 'true'}, {"in": '{}'}),
        ("json_set", {"path": "items.10001", "value": '1'}, {"in": '{"items":[]}'}),
        ("json_keys", {"mode": "entries"}, {"in": '{"a":1,"b":2}'}),
        ("table_transpose", {}, {"in": 'name,value\n"a,b",2\nc'}),
        ("table_select", {"start": 1, "count": 1, "columns": "2,0"}, {"in": 'a,b,c\nd,e,f'}),
        ("table_select", {"columns": "-1"}, {"in": 'a,b'}),
        ("table_sort", {}, {"in": 'name,value\na,10\nb,2'}),
        ("table_sort", {"header": False, "numeric": False, "descending": True, "column": 0}, {"in": 'a,2\nz,1\nb,3'}),
        ("table_merge", {}, {"in": 'a,b\n1,2', "in2": 'a,b\n3,4'}),
        ("table_merge", {"axis": "columns"}, {"in": 'a,b\n1,2', "in2": 'c\n3\n4'}),
        ("table_to_json", {}, {"in": 'name,value\n光,2\n影,3.5'}),
        ("table_to_json", {}, {"in": 'a,a\n1,2'}),
        ("chop_to_dat", {"digits": 1, "prefix": "=", "suffix": "m"}, {"in": 1.25}),
        ("chop_to_dat", {"digits": 1}, {"in": -1.25}),
        ("chop_to_dat", {"digits": 2}, {"in": 1.005}),
    ]
    assert {kind for kind, _, _ in rows} == ADVANCED_STATELESS_TYPES
    cases = [{"kind": kind, "params": {**NODE_TYPES[kind]["defaults"], **params}, "inputs": inputs, "time": -0.35} for kind, params, inputs in rows]
    script = r'''
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from './frontend/node_modules/typescript/lib/typescript.js';
const requirePackage=createRequire(path.resolve('frontend/package.json')),cache=new Map();
function load(file){file=path.resolve(file);if(!path.extname(file))file+='.ts';if(cache.has(file))return cache.get(file).exports;const module={exports:{}};cache.set(file,module);const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(code,{module,exports:module.exports,TextEncoder,TextDecoder,btoa,atob,require:name=>name.startsWith('.')?load(path.resolve(path.dirname(file),name)):requirePackage(name)},{filename:file});return module.exports}
const {cookAdvancedDataNode}=load('frontend/src/nodes/advancedDataRuntime.ts');
const results=JSON.parse(fs.readFileSync(0,'utf8')).map(({kind,params,inputs,time})=>{try{return {value:cookAdvancedDataNode({id:'case',type:kind,data:{params}},time,(handle='in')=>inputs[handle],new Map()).value}}catch(error){return {error:String(error)}}});
process.stdout.write(JSON.stringify(results));
'''
    completed = subprocess.run([executable, "--input-type=module", "-e", script], input=json.dumps(cases), capture_output=True, text=True, check=True, cwd=ROOT, timeout=30)
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
            assert value == browser["value"], (case, value, browser)
