"""Real headless-browser capture and private-API isolation."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os
import threading

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from backend.web_runtime import create_web_router

CHROMIUM = os.environ.get('TD_CHROMIUM', '/tmp/paperflow-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell')


def test_web_actions_and_url_validation(tmp_path):
    app = FastAPI(); app.include_router(create_web_router(tmp_path))
    with TestClient(app) as client:
        assert client.post('/api/web-render/capture', json={'url':'file:///etc/passwd'}).status_code == 422
        assert client.post('/api/web-render/capture', json={'html':'hello','actions':[{'type':'evaluate','code':'alert(1)'}]}).status_code == 422
        assert client.post('/api/web-render/capture', json={'html':'hello','actions':[{'type':'click'}]}).status_code == 422
        assert client.post('/api/web-render/capture', json={'html':'hello','width':999999}).status_code == 422


@pytest.mark.skipif(not Path(CHROMIUM).exists(), reason='Chromium optional capture dependency is not installed')
def test_actual_browser_capture_blocks_private_api_but_renders_local_pages(tmp_path, monkeypatch):
    monkeypatch.setenv('TD_CHROMIUM', CHROMIUM)
    visits = []
    html = b'''<!doctype html><html><head><title>waiting</title></head>
      <body style="background:#16394a;color:white;font:24px sans-serif"><h1>Actual browser render</h1><input id="entry" value="before">
      <script>Promise.all([fetch('/safe-data').then(r=>r.text()),...['/api/projects','/%61pi/scripts/intent','/api%2fscripts/run','/x/%2e%2e/api/providers','/%2561pi/scripts/run'].map(path=>fetch(path).then(()=> 'unsafe').catch(()=> 'blocked'))]).then(values=>document.title=values.join(' / '))</script></body></html>'''
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            visits.append(self.path)
            body = b'rendered' if self.path == '/safe-data' else b'private project data' if self.path.startswith('/api/') else html
            self.send_response(200); self.send_header('Content-Type', 'text/html' if body == html else 'text/plain'); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
        def log_message(self, *_args): pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    app = FastAPI(); app.include_router(create_web_router(tmp_path))
    try:
        with TestClient(app) as client:
            result = client.post('/api/web-render/capture', json={'url':f'http://127.0.0.1:{server.server_port}/page','width':420,'height':180,'delay':300,'actions':[{'type':'fill','selector':'#entry','value':'changed in real Chromium'}]})
            assert result.status_code == 200, result.text
            metadata = result.json(); assert metadata['title'] == 'rendered / blocked / blocked / blocked / blocked / blocked'
            image = tmp_path / 'exports' / metadata['image_url'].rsplit('/', 1)[1]
            assert image.read_bytes().startswith(b'\x89PNG\r\n\x1a\n') and image.stat().st_size > 1000
            assert '/safe-data' in visits
            assert set(visits).issubset({'/page','/safe-data','/favicon.ico'}), visits
    finally:
        server.shutdown(); server.server_close(); thread.join(timeout=2)
