from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.script_runtime import create_script_router

def test_python_callback_roundtrip_and_errors(tmp_path):
    app=FastAPI();app.include_router(create_script_router(tmp_path))
    with TestClient(app) as client:
        r=client.post('/api/scripts/run',headers=script_headers(client),json={'code':'def cook(inputs,time):\n    print("ran")\n    return {"value":inputs["in"]*2,"time":time}', 'inputs':{'in':4},'time':1.5})
        assert r.status_code==200,r.text
        assert r.json()=={'value':{'value':8,'time':1.5},'log':'ran\n'}
        assert list((tmp_path/'scripts').glob('*.py'))
        r=client.post('/api/scripts/run',headers=script_headers(client),json={'code':'def cook(inputs,time):\n    return 1/0'})
        assert r.status_code==422
        assert 'ZeroDivisionError' in r.json()['detail']
        r=client.post('/api/scripts/run',headers=script_headers(client),json={'code':'def cook(inputs,time):\n    return float("nan")'})
        assert r.status_code==422


def script_headers(client):
    response = client.post('/api/scripts/intent')
    assert response.status_code == 200, response.text
    return {'X-TD-Script-Intent': response.json()['token']}


def test_script_intent_is_required_single_use_and_client_bound(tmp_path):
    app=FastAPI();app.include_router(create_script_router(tmp_path))
    body={'code':'def cook(inputs,time): return 7'}
    with TestClient(app, client=('127.0.0.1',1234)) as client:
        assert client.post('/api/scripts/run',json=body).status_code == 403
        headers=script_headers(client)
        assert client.post('/api/scripts/run',json=body,headers=headers).status_code == 200
        assert client.post('/api/scripts/run',json=body,headers=headers).status_code == 403
        headers=script_headers(client)
    with TestClient(app, client=('::1',1234)) as client:
        assert client.post('/api/scripts/run',json=body,headers=headers).status_code == 403
    with TestClient(app, client=('203.0.113.9',1234)) as client:
        assert client.post('/api/scripts/intent').status_code == 403


def test_script_intent_expires_without_persisting_token(tmp_path, monkeypatch):
    import time
    from types import SimpleNamespace
    from backend import script_runtime
    app=FastAPI();app.include_router(create_script_router(tmp_path))
    with TestClient(app) as client:
        headers=script_headers(client)
        monkeypatch.setattr(script_runtime,'time',SimpleNamespace(monotonic=lambda:time.monotonic()+31))
        assert client.post('/api/scripts/run',json={'code':'def cook(inputs,time): return 7'},headers=headers).status_code == 403
        assert not any(headers['X-TD-Script-Intent'] in f.read_text() for f in (tmp_path/'scripts').glob('*.py'))
