"""Real loopback tests: operating-system sockets, mmap and a pseudo terminal."""
import asyncio
import base64
import json
import os
from pathlib import Path
import struct
import time

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from backend.io_runtime import (IOManager, SessionConfig, create_io_router, decode_artnet,
                               decode_osc, encode_artnet, encode_osc, mqtt_packet, mqtt_read, mqtt_string)


async def received(session, minimum=1):
    deadline = time.monotonic() + 3
    while session.seq < minimum:
        if time.monotonic() > deadline: raise AssertionError(f"Message timeout: {session.snapshot()}")
        await asyncio.sleep(0.01)
    return session.messages[-1]["value"]


@pytest.mark.parametrize("protocol,value", [("udp", {"scene": "hello", "value": 7}), ("osc", {"address": "/gesture", "args": [3, 0.25, "你好", True, False, None]}), ("artnet", {"universe": 23, "channels": [0, 64, 255, 32]})])
def test_udp_osc_artnet_actual_socket(tmp_path, protocol, value):
    async def run():
        manager = IOManager(tmp_path)
        try:
            receiver = await manager.open(SessionConfig(protocol=protocol, port=0))
            sender = await manager.open(SessionConfig(protocol=protocol, mode="connect", port=receiver.address[1]))
            await manager.send(sender.id, value)
            result = await received(receiver)
            if protocol == "artnet":
                assert result["universe"] == value["universe"]
                assert result["channels"] == value["channels"]
            else: assert result == value
            assert len(manager.sessions) == 2
            await manager.close(sender.id)
            assert sender.state == "closed"
        finally: await manager.close_all()
        assert not manager.sessions
    asyncio.run(run())


@pytest.mark.parametrize("framing", ["newline", "length", "raw"])
def test_tcp_bidirectional_streams(tmp_path, framing):
    async def run():
        manager = IOManager(tmp_path)
        try:
            listener = await manager.open(SessionConfig(protocol="tcp", framing=framing))
            client = await manager.open(SessionConfig(protocol="tcp", mode="connect", port=listener.address[1], framing=framing))
            await manager.send(client.id, {"from": "client", "samples": [1, 2, 3]})
            assert (await received(listener))["samples"] == [1, 2, 3]
            await manager.send(listener.id, "reply from server")
            assert await received(client) == "reply from server"
        finally: await manager.close_all()
    asyncio.run(run())


def test_websocket_rfc6455_loopback(tmp_path):
    async def run():
        manager = IOManager(tmp_path)
        try:
            listener = await manager.open(SessionConfig(protocol="websocket"))
            client = await manager.open(SessionConfig(protocol="websocket", mode="connect", url=f"ws://127.0.0.1:{listener.address[1]}"))
            await manager.send(client.id, {"frame": 9, "channels": [0.2, 0.7]})
            assert (await received(listener))["frame"] == 9
            await manager.send(listener.id, {"echo": True})
            assert await received(client) == {"echo": True}
            await manager.send(client.id, {"base64":"/wAB", "encoding":"base64"})
            assert await received(listener, 2) == {"base64":"/wAB", "encoding":"base64"}
        finally: await manager.close_all()
    asyncio.run(run())


def test_shared_memory_cross_session_and_native_layout(tmp_path):
    async def run():
        manager = IOManager(tmp_path)
        try:
            a = await manager.open(SessionConfig(protocol="sharedmem", channel="test"))
            b = await manager.open(SessionConfig(protocol="sharedmem", channel="test"))
            value = {"kind": "channels", "channels": [{"name": "x", "samples": [1, 2]}]}
            await manager.send(a.id, value)
            assert await received(b) == value
            raw = (tmp_path / "io" / "sharedmem" / "test.bin").read_bytes()
            generation, size = struct.unpack_from("<QQ", raw, 0)
            assert generation == 2 and json.loads(raw[16:16 + size]) == value
            await manager.send(b.id, 19)
            assert await received(a, minimum=2) == 19
        finally: await manager.close_all()
    asyncio.run(run())


@pytest.mark.skipif(os.name != "posix", reason="POSIX pseudo terminal test")
def test_serial_actual_pseudo_terminal(tmp_path):
    import pty
    async def run():
        master, slave = pty.openpty(); manager = IOManager(tmp_path)
        try:
            session = await manager.open(SessionConfig(protocol="serial", device=os.ttyname(slave)))
            os.write(master, b'{"value": 42}')
            assert await received(session) == {"value": 42}
            await manager.send(session.id, "serial reply")
            os.set_blocking(master, False)
            deadline = time.monotonic() + 3
            while True:
                try:
                    assert os.read(master, 4096) == b"serial reply"; break
                except BlockingIOError:
                    assert time.monotonic() < deadline; await asyncio.sleep(0.01)
        finally:
            await manager.close_all(); os.close(master); os.close(slave)
    asyncio.run(run())


def test_mqtt_connect_subscribe_publish_actual_tcp_broker(tmp_path):
    async def run():
        broker_messages = []; broker_tasks = set()
        async def broker(reader, writer):
            task = asyncio.current_task(); broker_tasks.add(task)
            try:
                header, body = await mqtt_read(reader)
                assert header == 0x10 and body[:6] == b"\0\4MQTT"
                writer.write(b"\x20\x02\0\0"); await writer.drain()
                header, body = await mqtt_read(reader)
                assert header == 0x82 and b"test/#" in body
                writer.write(b"\x90\x03" + body[:2] + b"\0"); await writer.drain()
                header, body = await mqtt_read(reader)
                assert header == 0x30
                length = struct.unpack_from(">H", body)[0]
                broker_messages.append((body[2:2 + length].decode(), json.loads(body[2 + length:])))
                writer.write(mqtt_packet(0x30, mqtt_string("test/echo") + body[2 + length:])); await writer.drain()
                await reader.read()
            finally:
                writer.close(); await writer.wait_closed(); broker_tasks.discard(task)
        server = await asyncio.start_server(broker, "127.0.0.1", 0)
        manager = IOManager(tmp_path)
        try:
            client = await manager.open(SessionConfig(protocol="mqtt", host="127.0.0.1", port=server.sockets[0].getsockname()[1], topic="test/#"))
            await manager.send(client.id, {"temperature": 21.3}, {"topic": "test/sensor"})
            value = await received(client)
            assert value["topic"] == "test/echo" and value["payload"] == {"temperature": 21.3}
            assert broker_messages == [("test/sensor", {"temperature": 21.3})]
            with pytest.raises(ValueError, match="wildcard"):
                await manager.send(client.id, 1)
        finally:
            await manager.close_all(); server.close(); await server.wait_closed()
            if broker_tasks: await asyncio.gather(*broker_tasks)
    asyncio.run(run())


def test_osc_bundle_and_blob_validation():
    packet = encode_osc("/blob", [b"\0\1\2"])
    bundle = b"#bundle\0" + struct.pack(">Q", 1) + struct.pack(">I", len(packet)) + packet
    assert decode_osc(bundle) == {"bundle": [{"address": "/blob", "args": [{"base64": "AAEC"}]}], "timetag": "1"}
    with pytest.raises(ValueError): encode_osc("bad", [])
    with pytest.raises(ValueError): decode_artnet(b"bad")
    with pytest.raises(ValueError): encode_artnet([], 0)


def test_api_file_sandbox_and_external_adapter_status(tmp_path):
    app = FastAPI(); router = create_io_router(tmp_path); app.include_router(router)
    with TestClient(app) as client:
        assert client.post("/api/io/files/write", json={"path": "graphs/a.json", "value": {"message": "你好"}}).status_code == 200
        assert client.post("/api/io/files/read", json={"path": "graphs/a.json"}).json()["value"] == {"message": "你好"}
        assert client.post("/api/io/files/list", json={"path": "graphs"}).json()["files"][0]["name"] == "a.json"
        for path in ["../../outside.txt", "/etc/passwd"]:
            assert client.post("/api/io/files/read", json={"path": path}).status_code == 400
            assert client.post("/api/io/files/write", json={"path": path, "value": "no"}).status_code == 400
        (tmp_path / "io" / "outside-link").symlink_to(tmp_path)
        assert client.post("/api/io/files/write", json={"path": "outside-link/escape.txt", "value": "no"}).status_code == 400
        session = client.post("/api/io/sessions", json={"protocol": "bridge", "channel": "kinect", "adapter": "kinect"}).json()
        assert session["native_driver"] is False
        caps = client.get("/api/io/capabilities").json()
        assert next(d for d in caps["adapters"] if d["id"] == "kinect")["connected"] is False
        assert client.post("/api/io/bridge/kinect", json={"value": {"joint": [1, 2, 3]}}).json()["delivered"] == 1
        payload = client.get(f"/api/io/sessions/{session['id']}/messages").json()
        assert payload["messages"][0]["value"] == {"joint": [1, 2, 3]}
        caps = client.get("/api/io/capabilities").json()
        assert next(d for d in caps["adapters"] if d["id"] == "kinect")["connected"] is True
        assert client.delete(f"/api/io/sessions/{session['id']}").status_code == 200
        assert client.get(f"/api/io/sessions/{session['id']}/messages").status_code == 404
        client.post("/api/io/web/test", json={"value": "a real endpoint"})
        assert client.get("/api/io/web/test").json()["value"] == "a real endpoint"


def test_http_client_actual_loopback_and_size_limit(tmp_path):
    async def run():
        async def http(reader, writer):
            await reader.readuntil(b"\r\n\r\n")
            data = b'{"ready":true}'
            writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: " + str(len(data)).encode() + b"\r\n\r\n" + data)
            await writer.drain(); writer.close(); await writer.wait_closed()
        server = await asyncio.start_server(http, "127.0.0.1", 0)
        app = FastAPI(); router = create_io_router(tmp_path); app.include_router(router)
        import httpx
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                result = await client.post("/api/io/http", json={"url": f"http://127.0.0.1:{server.sockets[0].getsockname()[1]}"})
                assert result.status_code == 200 and result.json()["value"] == {"ready": True}
                assert (await client.post("/api/io/http", json={"url": "file:///etc/passwd"})).status_code == 400
        finally:
            server.close(); await server.wait_closed(); await router.td_io_manager.close_all()
    asyncio.run(run())


def test_api_websocket_bridge_origin_and_data(tmp_path):
    app = FastAPI(); router = create_io_router(tmp_path); app.include_router(router)
    with TestClient(app) as client:
        with client.websocket_connect("/api/io/bridge/demo/ws") as socket:
            socket.send_json({"sensor": 9})
            assert socket.receive_json()["value"] == {"sensor": 9}
        with pytest.raises(Exception):
            with client.websocket_connect("/api/io/bridge/demo/ws", headers={"origin": "https://untrusted.example"}): pass
        assert client.get("/api/io/sessions").json() == []


@pytest.mark.parametrize('path',['/api/scripts/intent','/%61pi/scripts/run','/%2561pi/scripts/run','/x/%2e%2e/api/providers','//api/projects','/api%2fscripts/run','/api/chat','/api/mcp/call'])
def test_http_proxy_blocks_privileged_app_urls_before_connect(tmp_path,path):
    app=FastAPI();app.include_router(create_io_router(tmp_path))
    with TestClient(app) as client:
        response=client.post('/api/io/http',json={'url':'http://127.0.0.1:1'+path,'method':'POST','value':{'code':'def cook(inputs,time): return 7'}})
        assert response.status_code == 400
        assert 'privileged' in response.json()['detail']


def test_tcp_ws_and_datagram_cannot_tunnel_to_application_or_frontend(tmp_path):
    async def run():
        hits=[]
        async def server_callback(reader,writer):
            hits.append(True);writer.close();await writer.wait_closed()
        server=await asyncio.start_server(server_callback,'127.0.0.1',0)
        port=server.sockets[0].getsockname()[1]
        app=FastAPI();router=create_io_router(tmp_path);app.include_router(router)
        import httpx
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url=f'http://127.0.0.1:{port}') as client:
                for protocol in ['tcp','websocket','mqtt','udp','osc','artnet']:
                    result=await client.post('/api/io/sessions',json={'protocol':protocol,'mode':'connect','host':'127.0.0.1','port':port,'url':f'ws://127.0.0.1:{port}/api/io/bridge/demo/ws'})
                    assert result.status_code == 400,result.text
                    assert 'application/frontend' in result.json()['detail']
                result=await client.post('/api/io/sessions',json={'protocol':'tcp','mode':'connect','host':'127.0.0.1','port':5173},headers={'Origin':'http://127.0.0.1:5173'})
                assert result.status_code == 400
                # Listening UDP sockets can also send: the send override must be checked.
                result=await client.post('/api/io/sessions',json={'protocol':'udp','port':0})
                sid=result.json()['id']
                result=await client.post(f'/api/io/sessions/{sid}/send',json={'value':'POST /api/scripts/intent HTTP/1.1','options':{'port':port}})
                assert result.status_code == 400
                assert not hits
        finally:
            await router.td_io_manager.close_all();server.close();await server.wait_closed()
    asyncio.run(run())


def test_http_proxy_does_not_follow_redirect_to_sensitive_api(tmp_path):
    async def run():
        paths=[]
        async def http(reader,writer):
            raw=await reader.readuntil(b'\r\n\r\n');paths.append(raw.split(b' ')[1])
            writer.write(b'HTTP/1.1 302 Found\r\nLocation: /api/scripts/intent\r\nContent-Length: 0\r\n\r\n')
            await writer.drain();writer.close();await writer.wait_closed()
        server=await asyncio.start_server(http,'127.0.0.1',0)
        app=FastAPI();router=create_io_router(tmp_path);app.include_router(router)
        import httpx
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
                response=await client.post('/api/io/http',json={'url':f'http://127.0.0.1:{server.sockets[0].getsockname()[1]}/redirect'})
                assert response.status_code == 200 and response.json()['status'] == 302
                assert paths == [b'/redirect']
        finally:
            await router.td_io_manager.close_all();server.close();await server.wait_closed()
    asyncio.run(run())
