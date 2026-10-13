"""Graph invariants and HTTP behavior that protect persisted creative projects."""

import json
import math
from pathlib import Path
import shutil
import subprocess

from fastapi.testclient import TestClient
import pytest

from backend.catalog import NODE_EVALUATORS, NODE_TYPES
from backend.graph import GraphError, apply_commands, normalize_project, topological_order, validate_graph
from backend.main import configured_data_dir, create_app
from backend.models import Project
from backend.runtime import evaluate
from backend.storage import ROOT, ProjectStore


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path, include_integrations=False)) as test_client:
        yield test_client


def node(id, type="constant", **params):
    return {"id": id, "type": type, "position": {"x": 10, "y": 20}, "data": {"label": id, "params": params}}


def edge(id, source, target, target_handle="in"):
    return {"id": id, "source": source, "target": target, "sourceHandle": "out", "targetHandle": target_handle}


def project(nodes=None, edges=None, id="test-project"):
    return Project(id=id, name="测试作品", nodes=nodes or [], edges=edges or [])


def test_project_roundtrip_and_delete(client):
    original = project([node("noise", "noise"), node("output", "output")], [edge("e", "noise", "output")]).model_dump()
    response = client.post("/api/projects", json=original)
    assert response.status_code == 200
    normalized = normalize_project(Project.model_validate(original)).model_dump()
    assert response.json() == normalized
    assert client.get("/api/projects/test-project").json() == normalized
    metadata = client.get("/api/projects").json()
    assert metadata[0]["node_count"] == 2
    assert metadata[0]["name"] == "测试作品"
    assert client.delete("/api/projects/test-project").status_code == 200
    assert client.get("/api/projects/test-project").status_code == 404


def test_cycle_is_rejected_without_overwriting_project(client):
    base = project([node("a", "color"), node("b", "blur")], [edge("ab", "a", "b")])
    assert client.post("/api/projects", json=base.model_dump()).status_code == 200
    cyclic = base.model_dump()
    cyclic["edges"].append(edge("ba", "b", "a"))
    assert client.post("/api/validate", json=cyclic).json()["valid"] is False
    assert client.post("/api/projects", json=cyclic).status_code == 422
    assert len(client.get("/api/projects/test-project").json()["edges"]) == 1


def test_ports_must_exist_and_match_types(client):
    p = project([node("c"), node("out", "output")], [edge("bad", "c", "out")])
    result = client.post("/api/validate", json=p.model_dump()).json()
    assert result["valid"] is False
    assert any("不匹配" in error for error in result["errors"])
    p.edges[0].targetHandle = "missing"
    assert any("端口" in error for error in validate_graph(p))


def test_audio_modulation_and_spectrum_are_compatible():
    p = project([node("audio", "audio"), node("particles", "particles"), node("spectrum", "spectrum"), node("output", "output")],
                [edge("a", "audio", "particles", "mod"), edge("b", "audio", "spectrum"), edge("c", "spectrum", "output")])
    assert validate_graph(p) == []


def test_duplicate_ids_missing_nodes_and_single_input_are_rejected():
    p = project([node("a"), node("b"), node("m", "math")], [edge("e", "a", "m"), edge("e2", "b", "m")])
    assert any("只能有一个" in message for message in validate_graph(p))
    p = project([node("a"), node("a")], [edge("e", "missing", "a")])
    errors = validate_graph(p)
    assert any("必须唯一" in message for message in errors)
    assert any("不存在" in message for message in errors)


def test_commands_are_atomic_and_do_not_mutate_input():
    p = project([node("a", value=2)])
    before = p.model_dump()
    with pytest.raises(GraphError):
        apply_commands(p, [{"op": "set_param", "id": "a", "key": "value", "value": 9},
                           {"op": "connect", "source": "a", "target": "missing"}])
    assert p.model_dump() == before


def test_command_batch_connects_new_nodes_and_removes_related_edges(client):
    p = project([node("c", value=3)])
    batch = [{"op": "add_node", "id": "m", "type": "math", "params": {"value": 4}},
             {"op": "connect", "id": "cm", "source": "c", "target": "m"},
             {"op": "rename_project", "name": "Renamed"}]
    response = client.post("/api/commands", json={"project": p.model_dump(), "commands": batch})
    assert response.status_code == 200
    assert response.json()["applied"] == 3
    changed = Project.model_validate(response.json()["project"])
    assert changed.name == "Renamed"
    assert changed.edges[0].targetHandle == "in"
    assert evaluate(changed)["values"]["m"] == 12
    cleaned = apply_commands(changed, [{"op": "remove_node", "id": "c"}])
    assert len(cleaned.nodes) == 1
    assert cleaned.edges == []


def test_topological_evaluation_is_independent_of_saved_node_order():
    p = project([node("scaled", "python_scale", factor=3), node("multiply", "math", value=4), node("source", value=2)],
                [edge("second", "multiply", "scaled"), edge("first", "source", "multiply")])
    assert topological_order(p) == ["source", "multiply", "scaled"]
    result = evaluate(p)
    assert result["values"] == {"source": 2, "multiply": 8, "scaled": 24}
    assert result["errors"] == {}


def test_lfo_math_clamp_and_provider_not_invoked(client):
    p = project([node("lfo", "lfo", frequency=1, amplitude=2), node("math", "math", operation="clamp", value=1), node("image", "ai_image")],
                [edge("e", "lfo", "math")])
    result = client.post("/api/evaluate", json={"project": p.model_dump(), "time": 0.25}).json()
    assert math.isclose(result["values"]["lfo"], 2)
    assert result["values"]["math"] == 1
    assert "image" in result["skipped"]


@pytest.mark.parametrize("unsafe_id", ["../outside", "a/b", "..", "/tmp/leak", "a\\b"])
def test_project_paths_are_validated(client, tmp_path, unsafe_id):
    original = project().model_dump()
    original["id"] = unsafe_id
    assert client.post("/api/projects", json=original).status_code == 422
    with pytest.raises(ValueError):
        ProjectStore(tmp_path).path(unsafe_id)


def test_upload_is_named_safely_and_active_content_rejected(client):
    uploaded = client.post("/api/upload", files={"file": ("../../payload.png", b"image-bytes", "image/png")})
    assert uploaded.status_code == 200
    data = uploaded.json()
    assert data["name"] == "payload.png"
    assert ".." not in data["url"]
    asset = client.get(data["url"])
    assert asset.content == b"image-bytes"
    assert asset.headers["x-content-type-options"] == "nosniff"
    assert client.post("/api/upload", files={"file": ("script.html", b"<script>1</script>", "text/html")}).status_code == 415
    assert client.post("/api/upload", files={"file": ("empty.png", b"", "image/png")}).status_code == 400


def test_browser_cross_origin_mutations_are_rejected(client):
    response = client.post("/api/projects", json=project().model_dump(), headers={"Origin": "https://untrusted.example"})
    assert response.status_code == 403
    assert client.post("/api/projects", json=project().model_dump(), headers={"Origin": "http://testserver"}).status_code == 200


def test_request_errors_do_not_echo_input(client):
    response = client.post("/api/projects", json={"api_key": "do-not-echo-secret"})
    assert response.status_code == 422
    assert "do-not-echo-secret" not in response.text


def test_unknown_api_never_serves_frontend(client):
    assert client.get("/api/missing").status_code == 404


@pytest.mark.parametrize("filename,mime,payload", [("../../作品.png", "image/png", b"png-bytes"), ("movie.webm", "video/webm", b"webm-bytes"), ("project.json", "application/json", b'{"version":1}')])
def test_artifacts_are_saved_locally_and_downloadable(client, filename, mime, payload):
    response = client.post("/api/artifacts", files={"file": (filename, payload, mime)})
    assert response.status_code == 200
    result = response.json()
    assert result["name"] == Path(filename).name
    assert result["size"] == len(payload)
    stored = client.app.state.store.exports_dir / Path(result["url"]).name
    assert stored.read_bytes() == payload
    download = client.get(result["url"])
    assert download.content == payload
    assert download.headers["content-type"] == mime
    assert download.headers["content-disposition"].startswith("attachment;")


def test_artifact_invalid_paths_types_and_partial_files_are_rejected(client, monkeypatch):
    assert client.post("/api/artifacts", files={"file": ("evil.html", b"<script>1</script>", "text/html")}).status_code == 415
    assert client.post("/api/artifacts", files={"file": ("empty.png", b"", "image/png")}).status_code == 400
    monkeypatch.setattr("backend.main.MAX_UPLOAD_BYTES", 4)
    assert client.post("/api/artifacts", files={"file": ("large.png", b"12345", "image/png")}).status_code == 413
    assert list(client.app.state.store.exports_dir.iterdir()) == []
    assert client.get("/api/exports/..%5Cprivate.json").status_code == 404
    target = client.app.state.store.data_dir / "private.json"
    target.write_text("private")
    symlink = client.app.state.store.exports_dir / ("a" * 32 + ".json")
    symlink.symlink_to(target)
    assert client.get(f"/api/exports/{symlink.name}").status_code == 404


def test_plugin_failure_is_isolated_and_blocks_dependent_nodes(monkeypatch):
    def broken(params, inputs, time):
        raise RuntimeError("plugin failed")
    monkeypatch.setitem(NODE_EVALUATORS, "python_scale", broken)
    p = project([node("broken", "python_scale"), node("dependent", "math"), node("independent", value=7)],
                [edge("e", "broken", "dependent")])
    result = evaluate(p)
    assert result["values"] == {"independent": 7}
    assert result["errors"]["broken"] == "plugin failed"
    assert "上游" in result["errors"]["dependent"]


def test_plugin_non_json_result_is_a_node_error(monkeypatch):
    monkeypatch.setitem(NODE_EVALUATORS, "python_scale", lambda *_: {"invalid": math.nan})
    result = evaluate(project([node("plugin", "python_scale")]))
    assert "plugin" in result["errors"]
    assert result["values"] == {}


def test_factory_keeps_integration_config_in_selected_data_directory(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        response = client.post("/api/providers", json={"id": "isolated", "name": "Isolated provider", "base_url": "http://localhost:1234/v1"})
        assert response.status_code == 200
        assert client.app.state.integration_store.directory == tmp_path / "config"
        assert (tmp_path / "config" / "providers.json").is_file()


def test_configured_data_directory_stays_inside_repository(monkeypatch):
    monkeypatch.setenv("TD_DATA_DIR", ".cache/browser-data")
    assert configured_data_dir() == ROOT / ".cache" / "browser-data"
    monkeypatch.setenv("TD_DATA_DIR", str(ROOT.parent / "outside"))
    with pytest.raises(ValueError, match="TD_DATA_DIR"):
        configured_data_dir()


def test_frontend_and_backend_operator_contracts_match():
    from backend.catalog import NODE_TYPES
    bundled_node = ROOT / ".tools" / "node-v22.21.1-linux-x64" / "bin" / "node"
    node_command = str(bundled_node) if bundled_node.is_file() else shutil.which("node")
    if not node_command or not (ROOT / "frontend/node_modules/typescript/lib/typescript.js").is_file():
        pytest.skip("Install frontend dependencies to verify the shared operator contract")
    script = """
import fs from 'node:fs';
import vm from 'node:vm';
import ts from './frontend/node_modules/typescript/lib/typescript.js';
const compiled = ts.transpileModule(fs.readFileSync('frontend/src/catalog.ts', 'utf8'),
  {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText;
const sandbox = {exports: {}, require: () => ({uid: () => ''})};
vm.runInNewContext(compiled, sandbox);
console.log(JSON.stringify(sandbox.exports.catalog));
"""
    output = subprocess.run([node_command, "--input-type=module", "-e", script], cwd=ROOT,
                            capture_output=True, text=True, check=True, timeout=10)
    frontend = json.loads(output.stdout)
    parameter_fields = ("key", "type", "default", "min", "max", "step", "options")
    for spec in frontend:
        backend = NODE_TYPES[spec["type"]]
        assert spec["family"] == backend["family"], spec["type"]
        for direction in ("inputs", "outputs"):
            assert [(p["id"], p["kind"]) for p in spec[direction]] == [(p["id"], p["kind"]) for p in backend[direction]], (spec["type"], direction)
        expected = {p["key"]: {key: p.get(key) for key in parameter_fields} for p in spec["params"]}
        actual = {p["key"]: {key: p.get(key) for key in parameter_fields} for p in backend["params"]}
        assert actual == expected, spec["type"]


def test_validation_returns_complete_normalized_project_for_import(client):
    response = client.post("/api/validate", json={"id": "minimal", "name": "Minimal", "nodes": [{"id": "n", "type": "noise"}]})
    assert response.status_code == 200
    result = response.json()
    assert result["valid"] is True
    assert result["project"]["nodes"][0]["data"]["params"] == NODE_TYPES["noise"]["defaults"]
    assert result["project"]["nodes"][0]["position"] == {"x": 0, "y": 0}
    assert result["project"]["edges"] == []


@pytest.mark.parametrize("kind,params", [("noise", {"scale": {"bad": 1}}), ("constant", {"value": True}), ("render", {"wireframe": "false"}), ("geometry", {"shape": "not-a-geometry"}), ("media", {"url": []})])
def test_declared_parameter_types_are_validated_before_save(client, kind, params):
    original = project([node("node", kind)]).model_dump()
    saved = client.post("/api/projects", json=original)
    assert saved.status_code == 200
    malformed = project([node("node", kind, **params)]).model_dump()
    assert client.post("/api/validate", json=malformed).json()["valid"] is False
    assert client.post("/api/projects", json=malformed).status_code == 422
    assert client.get("/api/projects/test-project").json() == saved.json()


@pytest.mark.parametrize("commands", [[{"op": "add_node", "type": []}], [{"op": "add_node", "id": [], "type": "noise"}, {"op": "connect", "source": "x", "target": "y"}], [{"op": "connect", "source": [], "target": "node"}]])
def test_malformed_command_identifiers_return_validation_error(client, commands):
    response = client.post("/api/commands", json={"project": project([node("node")]).model_dump(), "commands": commands})
    assert response.status_code == 422


def test_vite_proxy_preserved_host_matches_browser_origin(client):
    response = client.post("/api/validate", json=project().model_dump(), headers={"Host": "localhost:5178", "Origin": "http://localhost:5178"})
    assert response.status_code == 200
    assert client.post("/api/validate", json=project().model_dump(), headers={"Host": "localhost:5178", "Origin": "http://elsewhere.example"}).status_code == 403


def test_implicit_ports_and_defaults_are_canonical_and_input_is_immutable(client):
    p = project([node("signal", value=2), node("noise", "noise")], [{"id": "link", "source": "signal", "target": "noise", "sourceHandle": None, "targetHandle": None}])
    before = p.model_dump()
    normalized = normalize_project(p)
    assert p.model_dump() == before
    assert normalized.edges[0].sourceHandle == "out"
    assert normalized.edges[0].targetHandle == "mod"
    assert normalized.nodes[1].data.params == NODE_TYPES["noise"]["defaults"]
    validated = client.post("/api/validate", json=before).json()
    assert validated["valid"] is True
    assert validated["project"] == normalized.model_dump()
    saved = client.post("/api/projects", json=before)
    assert saved.status_code == 200
    assert saved.json() == normalized.model_dump()
    assert client.get("/api/projects/test-project").json() == normalized.model_dump()
    changed = client.post("/api/commands", json={"project": before, "commands": [{"op": "rename_project", "name": "Canonical"}]}).json()["project"]
    assert changed["edges"][0]["targetHandle"] == "mod"
    assert changed["nodes"][1]["data"]["params"] == NODE_TYPES["noise"]["defaults"]
    # Older on-disk graphs remain readable and are normalized without rewriting.
    stored = client.app.state.store.path(p.id)
    stored.write_text(json.dumps(before))
    assert client.get("/api/projects/test-project").json() == normalized.model_dump()
    assert json.loads(stored.read_text()) == before
