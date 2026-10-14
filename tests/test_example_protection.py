"""Immutable case originals and persistent independent user projects."""
import asyncio
import json
from pathlib import Path
from fastapi.testclient import TestClient
from backend.main import create_app
from backend.storage import ProjectStore,ROOT
from backend.models import Project

def test_two_editors_cannot_overwrite_an_original_even_through_direct_api(tmp_path):
    source=ROOT/'examples/flow.tdopen.json';before=source.read_bytes()
    with TestClient(create_app(tmp_path)) as client:
        original=client.get('/api/examples/example_flow').json()
        assert original['settings']['is_example'] is True
        edited=json.loads(json.dumps(original));edited['nodes'][0]['data']['params']['scale']=7
        a=client.post('/api/projects',json=edited).json();b=client.post('/api/projects',json=edited).json()
        assert a['id']!=b['id'] and a['id']!=original['id']
        assert 'is_example' not in a['settings']
        assert a['settings']['source_example_id']==original['id']
        assert client.get('/api/examples/example_flow').json()==original
        assert source.read_bytes()==before
        a['nodes'][0]['data']['params']['scale']=8
        saved=client.post('/api/projects',json=a).json();assert saved['id']==a['id']
        assert client.get('/api/projects/'+a['id']).json()['nodes'][0]['data']['params']['scale']==8
        assert client.get('/api/projects/'+b['id']).json()['nodes'][0]['data']['params']['scale']==7
        assert client.delete('/api/projects/example_flow').status_code==400

def test_saved_generated_example_overrides_preview_but_keeps_original_and_existing_edits(tmp_path):
    store=ProjectStore(tmp_path)
    original=Project.model_validate_json((ROOT/'examples/tidal-muse.tdopen.json').read_text())
    original.id='tidal_muse_ready';original.name='Generated example'
    path=store.examples_dir/'tidal_muse_ready.json';path.write_text(original.model_dump_json())
    before=path.read_bytes()
    assert store.get_example('example_tidal-muse').id==original.id
    modified=store.get(original.id);modified.name='My edit'
    saved=store.save(modified)
    assert saved.id!=original.id and path.read_bytes()==before
    assert store.get(original.id).name==original.name
    assert {row['id']:row['is_example'] for row in store.list()}=={original.id:True,saved.id:False}

def test_mcp_example_edit_returns_the_saved_copy_for_subsequent_commands(tmp_path, monkeypatch):
    from backend import mcp_server

    with TestClient(create_app(tmp_path)) as client:
        original = client.get('/api/examples/example_flow').json()

        async def request(method, path, payload=None):
            response = client.request(method, path, json=payload)
            response.raise_for_status()
            return response.json()

        monkeypatch.setattr(mcp_server, 'app_request', request)
        commands = [{'op': 'set_param', 'id': 'noise_1', 'key': 'scale', 'value': 7}]
        preview = asyncio.run(mcp_server.apply_graph_commands(original['id'], commands))
        assert preview['applied'] is False
        assert client.get('/api/projects').json() == []
        applied = asyncio.run(mcp_server.apply_graph_commands(original['id'], commands, apply=True))
        saved_id = applied['project']['id']
        assert saved_id != original['id']
        assert client.get('/api/projects/' + saved_id).json() == applied['project']
        continued = asyncio.run(mcp_server.apply_graph_commands(saved_id, [
            {'op': 'rename_project', 'name': 'My continued edit'},
        ], apply=True))
        assert continued['project']['id'] == saved_id
        assert len(client.get('/api/projects').json()) == 1
        assert client.get('/api/examples/example_flow').json() == original
