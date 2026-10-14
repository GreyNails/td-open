"""Bounded asynchronous I/O sessions used by node graphs and external adapters.

Files and shared memory are rooted in data/io. Network sessions are opt-in and
have a 90 second lease; polling renews the lease, closing an abandoned graph
releases its ports. Commercial/device APIs use explicit adapter channels and
are never reported as native drivers.
"""
from __future__ import annotations

import asyncio
import base64
from collections import deque
from contextlib import suppress, asynccontextmanager
from dataclasses import dataclass, field
import importlib.util
import json
import mmap
import os
from pathlib import Path
import re
import struct
import time
from typing import Any, Literal
from uuid import uuid4

import httpx
from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from urllib.parse import urlsplit
from backend.request_security import reject_sensitive_app_url
from pydantic import BaseModel, Field

MAX_BYTES = 1024 * 1024
MAX_SESSIONS = 64
PROTOCOLS = ["udp", "osc", "artnet", "tcp", "websocket", "mqtt", "serial", "sharedmem", "bridge"]


def osc_string(value: str) -> bytes:
    raw = value.encode("utf-8") + b"\0"
    return raw + b"\0" * (-len(raw) % 4)


def encode_osc(address: str, arguments: list) -> bytes:
    if not address.startswith("/") or "\0" in address:
        raise ValueError("OSC address must start with / and contain no NUL")
    tags, parts = [], []
    for value in arguments:
        if isinstance(value, bool): tags.append("T" if value else "F")
        elif value is None: tags.append("N")
        elif isinstance(value, int): tags.append("i"); parts.append(struct.pack(">i", value))
        elif isinstance(value, float): tags.append("f"); parts.append(struct.pack(">f", value))
        elif isinstance(value, str): tags.append("s"); parts.append(osc_string(value))
        elif isinstance(value, bytes):
            tags.append("b"); parts.append(struct.pack(">I", len(value)) + value + b"\0" * (-len(value) % 4))
        else: raise ValueError("OSC supports number, string, boolean, null and blob arguments")
    return osc_string(address) + osc_string("," + "".join(tags)) + b"".join(parts)


def decode_osc(data: bytes, depth: int = 0) -> Any:
    if depth > 8: raise ValueError("OSC bundle nesting exceeds 8")
    if data.startswith(b"#bundle\0"):
        if len(data) < 16: raise ValueError("Truncated OSC bundle")
        stamp, pos, messages = struct.unpack_from(">Q", data, 8)[0], 16, []
        while pos < len(data):
            length = struct.unpack_from(">I", data, pos)[0]; pos += 4
            if not length or pos + length > len(data): raise ValueError("Invalid OSC bundle element")
            messages.append(decode_osc(data[pos:pos + length], depth + 1)); pos += length
        return {"bundle": messages, "timetag": str(stamp)}
    pos = 0
    def string():
        nonlocal pos
        end = data.index(b"\0", pos)
        value = data[pos:end].decode("utf-8"); pos = (end + 4) & ~3
        return value
    address, tags = string(), string()
    if not address.startswith("/") or not tags.startswith(","): raise ValueError("Invalid OSC message")
    args = []
    for tag in tags[1:]:
        if tag in "ifsdh":
            if tag == "s": args.append(string()); continue
            fmt = {"i": ">i", "f": ">f", "d": ">d", "h": ">q"}[tag]
            args.append(struct.unpack_from(fmt, data, pos)[0]); pos += struct.calcsize(fmt)
        elif tag in "TFNI": args.append({"T": True, "F": False, "N": None, "I": None}[tag])
        elif tag == "b":
            length = struct.unpack_from(">I", data, pos)[0]; pos += 4
            if pos + length > len(data): raise ValueError("Truncated OSC blob")
            args.append({"base64": base64.b64encode(data[pos:pos + length]).decode()}); pos += (length + 3) & ~3
        else: raise ValueError(f"Unsupported OSC tag: {tag}")
    return {"address": address, "args": args}


def encode_artnet(channels: list, universe: int = 0, sequence: int = 1) -> bytes:
    if not 0 <= universe < 32768 or not 1 <= len(channels) <= 512: raise ValueError("ArtDMX requires 1..512 channels and universe 0..32767")
    raw = bytes(max(0, min(255, int(v))) for v in channels)
    raw += b"\0" * (len(raw) % 2)
    return b"Art-Net\0" + struct.pack("<H", 0x5000) + struct.pack(">HBB", 14, sequence % 256, 0) + struct.pack("<H", universe) + struct.pack(">H", len(raw)) + raw


def decode_artnet(data: bytes) -> dict:
    if len(data) < 18 or data[:8] != b"Art-Net\0" or struct.unpack_from("<H", data, 8)[0] != 0x5000:
        raise ValueError("Expected ArtDMX packet (opcode 0x5000)")
    length = struct.unpack_from(">H", data, 16)[0]
    if not 2 <= length <= 512 or length % 2 or len(data) != 18 + length: raise ValueError("Invalid ArtDMX length")
    return {"universe": struct.unpack_from("<H", data, 14)[0], "sequence": data[12], "channels": list(data[18:])}


def mqtt_string(value: str) -> bytes:
    raw = value.encode("utf-8")
    if len(raw) > 65535: raise ValueError("MQTT string is too long")
    return struct.pack(">H", len(raw)) + raw


def mqtt_packet(header: int, payload: bytes) -> bytes:
    length, encoded = len(payload), bytearray([header])
    while True:
        digit, length = length % 128, length // 128
        encoded.append(digit | (128 if length else 0))
        if not length: return bytes(encoded) + payload


async def mqtt_read(reader: asyncio.StreamReader) -> tuple[int, bytes]:
    header = (await reader.readexactly(1))[0]; length = 0
    for power in range(4):
        digit = (await reader.readexactly(1))[0]; length += (digit & 127) * 128 ** power
        if length > MAX_BYTES: raise ValueError("MQTT packet exceeds 1 MB")
        if not digit & 128: return header, await reader.readexactly(length)
    raise ValueError("Invalid MQTT remaining length")


class SessionConfig(BaseModel):
    protocol: Literal["udp", "osc", "artnet", "tcp", "websocket", "mqtt", "serial", "sharedmem", "bridge"]
    mode: Literal["listen", "connect"] = "listen"
    host: str = "127.0.0.1"
    port: int = Field(default=0, ge=0, le=65535)
    bind_host: str = "127.0.0.1"
    bind_port: int = Field(default=0, ge=0, le=65535)
    url: str = ""
    channel: str = "td-open"
    topic: str = "td-open/#"
    username: str = ""
    password: str = ""
    framing: Literal["newline", "raw", "length"] = "newline"
    device: str = ""
    baud: int = 115200
    adapter: str = ""


@dataclass
class Session:
    id: str
    config: SessionConfig
    messages: deque = field(default_factory=lambda: deque(maxlen=128))
    seq: int = 0
    state: str = "opening"
    error: str = ""
    address: Any = None
    seen: float = field(default_factory=time.monotonic)
    tasks: set = field(default_factory=set)
    peers: set = field(default_factory=set)
    transport: Any = None
    server: Any = None
    writer: Any = None
    websocket: Any = None
    fd: int | None = None
    memory: Any = None
    memory_generation: int = 0
    serial_device: Any = None

    def push(self, value: Any, peer: Any = None):
        self.seq += 1
        self.messages.append({"seq": self.seq, "time": time.time(), "value": value, "peer": str(peer) if peer else None})

    def snapshot(self):
        return {"id": self.id, "protocol": self.config.protocol, "state": self.state, "error": self.error,
                "address": self.address, "received": self.seq, "peers": len(self.peers),
                "adapter": self.config.adapter, "native_driver": not bool(self.config.adapter)}


class Datagram(asyncio.DatagramProtocol):
    def __init__(self, session: Session): self.session = session
    def datagram_received(self, data, addr):
        try:
            if len(data) > MAX_BYTES: raise ValueError("Datagram exceeds 1 MB")
            protocol = self.session.config.protocol
            value = decode_osc(data) if protocol == "osc" else decode_artnet(data) if protocol == "artnet" else decode_bytes(data)
            self.session.error = ""
            self.session.push(value, addr)
        except (ValueError, IndexError, struct.error, UnicodeError) as exc: self.session.error = str(exc)
    def error_received(self, exc): self.session.error = str(exc)


def decode_bytes(data: bytes) -> Any:
    try:
        text = data.decode("utf-8")
        try: return json.loads(text)
        except ValueError: return text
    except UnicodeError: return {"base64": base64.b64encode(data).decode(), "encoding": "base64"}


def payload_bytes(value: Any) -> bytes:
    if isinstance(value, dict) and "base64" in value and set(value).issubset({"base64", "encoding"}) and value.get("encoding", "base64") == "base64": data = base64.b64decode(value["base64"], validate=True)
    elif isinstance(value, str): data = value.encode("utf-8")
    else: data = json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")
    if len(data) > MAX_BYTES: raise ValueError("I/O payload exceeds 1 MB")
    return data


class IOManager:
    def __init__(self, data_dir: Path):
        io_path = data_dir.resolve() / "io"
        if io_path.is_symlink(): raise ValueError("I/O directory cannot be a symbolic link")
        self.root = io_path.resolve(); self.root.mkdir(parents=True, exist_ok=True)
        self.sessions: dict[str, Session] = {}
        self.reaper = None
        self.bridge_status: dict[str, dict] = {}
        self.http_channels: dict[str, Any] = {}
        self.protected_ports: set[int] = set()

    def remember_app_ports(self, request: Request):
        server = request.scope.get("server")
        if server and server[1]: self.protected_ports.add(int(server[1]))
        # Include the development frontend/reverse-proxy port as well as ASGI.
        for raw in (str(request.url), request.headers.get("origin", "")):
            try:
                url = urlsplit(raw)
                if url.hostname: self.protected_ports.add(url.port or (443 if url.scheme == "https" else 80))
            except ValueError: pass

    def reject_app_port(self, port: int):
        # Apply to every hostname so alternate addresses and DNS rebinding cannot
        # turn a raw TCP/WS connection into HTTP access to the application.
        if int(port) in self.protected_ports:
            raise ValueError("I/O transport cannot connect back to an application/frontend port")

    def path(self, relative: str) -> Path:
        candidate = self.root / relative
        if Path(relative).is_absolute() or not candidate.resolve().is_relative_to(self.root):
            raise ValueError("File path must remain inside project data/io")
        current = candidate
        while current != self.root:
            if current.is_symlink(): raise ValueError("Symbolic links are not allowed in I/O paths")
            current = current.parent
        return candidate

    def task(self, session: Session, coroutine):
        async def run():
            try: await coroutine
            except asyncio.CancelledError: raise
            except Exception as exc:
                session.error = str(exc) or type(exc).__name__; session.state = "error"
        task = asyncio.create_task(run()); session.tasks.add(task)
        task.add_done_callback(session.tasks.discard)
        return task

    async def expire(self):
        while True:
            await asyncio.sleep(15)
            for sid, session in list(self.sessions.items()):
                if time.monotonic() - session.seen > 90: await self.close(sid)

    def get(self, sid: str) -> Session:
        if sid not in self.sessions: raise KeyError("I/O session expired or does not exist")
        session = self.sessions[sid]; session.seen = time.monotonic(); return session

    async def open(self, config: SessionConfig) -> Session:
        if len(self.sessions) >= MAX_SESSIONS: raise ValueError("At most 64 active I/O sessions")
        session = Session(uuid4().hex, config); self.sessions[session.id] = session
        if not self.reaper: self.reaper = asyncio.create_task(self.expire())
        try:
            protocol = config.protocol
            if config.mode == "connect" or protocol == "mqtt":
                if protocol == "websocket":
                    url = urlsplit(config.url)
                    self.reject_app_port(url.port or (443 if url.scheme == "wss" else 80))
                elif protocol in ("tcp", "mqtt", "udp", "osc", "artnet"):
                    self.reject_app_port(config.port)
            if protocol in ("udp", "osc", "artnet"):
                endpoint = (config.host, config.port) if config.mode == "listen" else (config.bind_host, config.bind_port)
                transport, _ = await asyncio.get_running_loop().create_datagram_endpoint(lambda: Datagram(session), local_addr=endpoint, allow_broadcast=protocol == "artnet")
                session.transport = transport; session.address = transport.get_extra_info("sockname")
            elif protocol in ("tcp", "mqtt"):
                if protocol == "tcp" and config.mode == "listen":
                    session.server = await asyncio.start_server(lambda r, w: self.accept_tcp(session, r, w), config.host, config.port, limit=MAX_BYTES + 4)
                    session.address = session.server.sockets[0].getsockname()
                else:
                    reader, writer = await asyncio.wait_for(asyncio.open_connection(config.host, config.port, limit=MAX_BYTES + 4), 8)
                    session.writer = writer; session.address = writer.get_extra_info("sockname")
                    if protocol == "mqtt": await self.open_mqtt(session, reader, writer)
                    else: self.task(session, self.read_tcp(session, reader, writer))
            elif protocol == "websocket":
                from websockets.asyncio.client import connect
                from websockets.asyncio.server import serve
                if config.mode == "listen":
                    async def handler(websocket):
                        session.peers.add(websocket)
                        try: await self.read_websocket(session, websocket)
                        finally: session.peers.discard(websocket)
                    session.server = await serve(handler, config.host, config.port, max_size=MAX_BYTES)
                    session.address = session.server.sockets[0].getsockname()
                else:
                    session.websocket = await connect(config.url, open_timeout=8, max_size=MAX_BYTES, proxy=None)
                    session.address = session.websocket.local_address
                    self.task(session, self.read_websocket(session, session.websocket))
            elif protocol == "serial": self.open_serial(session)
            elif protocol == "sharedmem": self.open_memory(session)
            elif protocol == "bridge":
                if not re.fullmatch(r"[A-Za-z0-9_.-]{1,96}", config.channel): raise ValueError("Bridge channel: use 1..96 letters, digits, _, -, .")
                session.address = f"/api/io/bridge/{config.channel}"
            session.state = "ready"
            return session
        except Exception:
            await self.close(session.id)
            raise

    async def accept_tcp(self, session, reader, writer):
        session.peers.add(writer)
        try: await self.read_tcp(session, reader, writer)
        except (OSError, ValueError, asyncio.IncompleteReadError) as exc: session.error = str(exc)
        finally:
            session.peers.discard(writer); writer.close()
            with suppress(Exception): await writer.wait_closed()

    async def read_tcp(self, session, reader, writer):
        while True:
            framing = session.config.framing
            if framing == "length":
                head = await reader.readexactly(4); length = struct.unpack(">I", head)[0]
                if length > MAX_BYTES: raise ValueError("TCP frame exceeds 1 MB")
                data = await reader.readexactly(length)
            elif framing == "newline":
                data = await reader.readline()
                if not data: break
                if data.endswith(b"\n"):
                    data = data[:-1]
                    if not data:
                        session.push("", writer.get_extra_info("peername")); continue
            else: data = await reader.read(65536)
            if not data: break
            if len(data) > MAX_BYTES: raise ValueError("TCP frame exceeds 1 MB")
            session.push(decode_bytes(data), writer.get_extra_info("peername"))
        if session.config.mode == "connect": session.state = "disconnected"

    async def read_websocket(self, session, websocket):
        async for value in websocket:
            session.push(decode_bytes(value.encode() if isinstance(value, str) else value), websocket.remote_address)
        if session.config.mode == "connect": session.state = "disconnected"

    async def open_mqtt(self, session, reader, writer):
        cfg = session.config; flags = 2 | (128 if cfg.username else 0) | (64 if cfg.password else 0)
        payload = mqtt_string("td-open-" + session.id[:12])
        if cfg.username: payload += mqtt_string(cfg.username)
        if cfg.password: payload += mqtt_string(cfg.password)
        writer.write(mqtt_packet(0x10, mqtt_string("MQTT") + bytes([4, flags]) + struct.pack(">H", 30) + payload)); await writer.drain()
        kind, body = await asyncio.wait_for(mqtt_read(reader), 8)
        if kind != 0x20 or len(body) != 2 or body[1]: raise ValueError(f"MQTT broker rejected CONNECT: {list(body)}")
        if cfg.topic:
            writer.write(mqtt_packet(0x82, b"\0\1" + mqtt_string(cfg.topic) + b"\0")); await writer.drain()
            kind, body = await asyncio.wait_for(mqtt_read(reader), 8)
            if kind != 0x90 or len(body) < 3 or body[2] == 0x80: raise ValueError("MQTT subscription rejected")
        self.task(session, self.read_mqtt(session, reader, writer))
        async def ping():
            while True:
                await asyncio.sleep(15); writer.write(b"\xc0\0"); await writer.drain()
        self.task(session, ping())

    async def read_mqtt(self, session, reader, writer):
        while True:
            header, body = await mqtt_read(reader)
            if header >> 4 != 3: continue
            length = struct.unpack_from(">H", body)[0]; topic = body[2:2 + length].decode(); offset = 2 + length
            qos = header >> 1 & 3
            if qos:
                packet = body[offset:offset + 2]; offset += 2
                if qos == 1: writer.write(b"\x40\x02" + packet); await writer.drain()
                else: raise ValueError("This MQTT node supports QoS 0/1 receiving, not QoS 2")
            session.push({"topic": topic, "payload": decode_bytes(body[offset:]), "retained": bool(header & 1)})

    def open_serial(self, session):
        if os.name == "nt":
            import serial
            device = session.config.device
            if not re.fullmatch(r"COM[1-9][0-9]{0,3}", device, re.IGNORECASE):
                raise ValueError("Windows serial device must be COM1, COM2, etc.")
            session.serial_device = serial.Serial(device, session.config.baud, timeout=0, write_timeout=2)
            session.address = device
            async def poll_serial():
                while True:
                    data = session.serial_device.read(65536)
                    if data: session.push(decode_bytes(data))
                    await asyncio.sleep(.01)
            self.task(session, poll_serial())
            return
        import termios
        device = Path(session.config.device).resolve()
        if not str(device).startswith(("/dev/tty", "/dev/pts/", "/dev/cu.")):
            raise ValueError("Serial device must be /dev/tty*, /dev/pts/* or /dev/cu.*")
        speed = getattr(termios, "B" + str(session.config.baud), None)
        if speed is None: raise ValueError("Unsupported serial baud rate")
        fd = os.open(device, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK); session.fd = fd
        attrs = termios.tcgetattr(fd); attrs[0] = 0; attrs[1] = 0; attrs[2] = termios.CS8 | termios.CREAD | termios.CLOCAL; attrs[3] = 0
        attrs[4] = speed; attrs[5] = speed; attrs[6][termios.VMIN] = 0; attrs[6][termios.VTIME] = 0
        termios.tcsetattr(fd, termios.TCSANOW, attrs); session.address = str(device)
        def readable():
            try:
                data = os.read(fd, 65536)
                if data: session.push(decode_bytes(data))
            except OSError as exc: session.error = str(exc)
        asyncio.get_running_loop().add_reader(fd, readable)

    def open_memory(self, session):
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,96}", session.config.channel): raise ValueError("Invalid shared memory channel")
        path = self.path("sharedmem/" + session.config.channel + ".bin"); path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o600); session.fd = fd
        size = MAX_BYTES + 16
        if os.fstat(fd).st_size != size: os.ftruncate(fd, size)
        session.memory = mmap.mmap(fd, size); session.address = str(path.relative_to(self.root))
        self.task(session, self.read_memory(session))

    async def read_memory(self, session):
        while True:
            await asyncio.sleep(0.03)
            generation, length = struct.unpack_from("<QQ", session.memory, 0)
            if generation % 2 or generation == session.memory_generation: continue
            if length > MAX_BYTES: raise ValueError("Invalid shared memory payload length")
            raw = session.memory[16:16 + length]
            if struct.unpack_from("<Q", session.memory, 0)[0] != generation: continue
            session.memory_generation = generation; session.push(decode_bytes(raw))

    async def send(self, sid: str, value: Any, options: dict | None = None):
        session = self.get(sid); cfg = session.config; options = options or {}; protocol = cfg.protocol
        data = payload_bytes(value)
        if protocol in ("udp", "osc", "artnet"):
            if protocol == "osc":
                message = value if isinstance(value, dict) else {"args": value if isinstance(value, list) else [value]}
                data = encode_osc(message.get("address", options.get("address", "/td-open")), message.get("args", []))
            elif protocol == "artnet": data = encode_artnet(value.get("channels", []) if isinstance(value, dict) else value, int(options.get("universe", value.get("universe", 0) if isinstance(value, dict) else 0)), int(options.get("sequence", 1)))
            if len(data) > 65507: raise ValueError("UDP packet exceeds 65507 bytes; use TCP/WebSocket for images")
            target = (options.get("host", cfg.host), int(options.get("port", cfg.port)))
            if not 1 <= target[1] <= 65535: raise ValueError("Destination port must be 1..65535")
            self.reject_app_port(target[1])
            session.transport.sendto(data, target)
        elif protocol == "tcp":
            if cfg.framing == "newline": data += b"\n"
            elif cfg.framing == "length": data = struct.pack(">I", len(data)) + data
            writers = [session.writer] if session.writer else list(session.peers)
            if not writers: raise ValueError("No TCP client connected")
            for writer in writers: writer.write(data); await writer.drain()
        elif protocol == "websocket":
            peers = [session.websocket] if session.websocket else list(session.peers)
            if not peers: raise ValueError("No WebSocket client connected")
            for peer in peers: await peer.send(data if isinstance(value, dict) and "base64" in value and set(value).issubset({"base64", "encoding"}) else data.decode("utf-8", errors="strict"))
        elif protocol == "mqtt":
            topic = str(options.get("topic", cfg.topic))
            if not topic or "+" in topic or "#" in topic: raise ValueError("MQTT publish topic cannot contain wildcard")
            session.writer.write(mqtt_packet(0x31 if options.get("retain") else 0x30, mqtt_string(topic) + data)); await session.writer.drain()
        elif protocol == "serial":
            if session.serial_device is not None:
                await asyncio.to_thread(session.serial_device.write, data)
                return {"sent": len(data), "session": sid}
            offset = 0
            while offset < len(data):
                try: offset += os.write(session.fd, data[offset:])
                except BlockingIOError: await asyncio.sleep(0.005)
        elif protocol == "sharedmem":
            if os.name == "nt":
                import msvcrt
                os.lseek(session.fd, 0, os.SEEK_SET)
                msvcrt.locking(session.fd, msvcrt.LK_LOCK, 1)
            else:
                import fcntl
                fcntl.flock(session.fd, fcntl.LOCK_EX)
            try:
                generation = struct.unpack_from("<Q", session.memory, 0)[0]
                generation = generation + 2 if generation % 2 == 0 else generation + 1
                struct.pack_into("<QQ", session.memory, 0, generation - 1, len(data)); session.memory[16:16 + len(data)] = data
                struct.pack_into("<Q", session.memory, 0, generation); session.memory.flush()
            finally:
                if os.name == "nt":
                    os.lseek(session.fd, 0, os.SEEK_SET)
                    msvcrt.locking(session.fd, msvcrt.LK_UNLCK, 1)
                else: fcntl.flock(session.fd, fcntl.LOCK_UN)
        else: self.bridge_push(cfg.channel, value, "node")
        return {"sent": len(data), "session": sid}

    def bridge_push(self, channel: str, value: Any, source: str = "external"):
        payload_bytes(value)
        if source == "external": self.bridge_status[channel] = {"connected": True, "last_seen": time.time()}
        count = 0
        for session in self.sessions.values():
            if session.config.protocol == "bridge" and session.config.channel == channel:
                session.push(value, source); count += 1
        return {"delivered": count, "channel": channel}

    async def close(self, sid: str):
        session = self.sessions.pop(sid, None)
        if not session: return
        for task in list(session.tasks): task.cancel()
        if session.tasks: await asyncio.gather(*list(session.tasks), return_exceptions=True)
        if session.transport: session.transport.close()
        if session.server:
            session.server.close(); await session.server.wait_closed()
        for writer in [session.writer, *session.peers]:
            if writer:
                result = writer.close()
                if hasattr(result, "__await__"): await result
                if hasattr(writer, "wait_closed"):
                    with suppress(Exception): await writer.wait_closed()
        if session.websocket: await session.websocket.close()
        if session.memory: session.memory.close()
        if session.serial_device: session.serial_device.close()
        if session.fd is not None:
            if session.config.protocol == "serial": asyncio.get_running_loop().remove_reader(session.fd)
            os.close(session.fd)
        session.state = "closed"

    async def close_all(self):
        if self.reaper:
            self.reaper.cancel()
            with suppress(asyncio.CancelledError): await self.reaper
            self.reaper = None
        for sid in list(self.sessions): await self.close(sid)


def create_io_router(data_dir: Path) -> APIRouter:
    manager = IOManager(data_dir)
    @asynccontextmanager
    async def lifespan(_app):
        try: yield
        finally: await manager.close_all()
    router = APIRouter(prefix="/api/io", tags=["node I/O"], lifespan=lifespan)
    router.td_io_manager = manager

    def error(exc):
        return HTTPException(status_code=404 if isinstance(exc, KeyError) else 400, detail=str(exc))

    @router.get("/capabilities")
    async def capabilities():
        from backend.io_adapters import ADAPTERS
        return {"protocols": PROTOCOLS, "file_root": "data/io", "max_bytes": MAX_BYTES,
                "lease_seconds": 90, "sessions": len(manager.sessions),
                "websocket": bool(importlib.util.find_spec("websockets")), "serial": os.name == "posix" or bool(importlib.util.find_spec("serial")),
                "adapters": [{**item, "connected": any(v.get("connected") and time.time() - v["last_seen"] < 90 for k, v in manager.bridge_status.items() if k == item["id"]), "native_driver": False} for item in ADAPTERS]}

    @router.post("/sessions")
    async def create(config: SessionConfig, request: Request):
        manager.remember_app_ports(request)
        try: return (await manager.open(config)).snapshot()
        except (ValueError, OSError, ImportError, TimeoutError, EOFError) as exc: raise error(exc) from exc

    @router.get("/sessions")
    async def sessions(): return [session.snapshot() for session in manager.sessions.values()]

    @router.get("/sessions/{sid}/messages")
    async def messages(sid: str, after: int = 0):
        try:
            session = manager.get(sid)
            return {**session.snapshot(), "messages": [m for m in session.messages if m["seq"] > after], "dropped": max(0, session.seq - after - len(session.messages))}
        except KeyError as exc: raise error(exc) from exc

    @router.post("/sessions/{sid}/send")
    async def send(sid: str, body: dict, request: Request):
        manager.remember_app_ports(request)
        try: return await manager.send(sid, body.get("value"), body.get("options"))
        except (KeyError, ValueError, OSError, struct.error) as exc: raise error(exc) from exc

    @router.delete("/sessions/{sid}")
    async def close(sid: str):
        await manager.close(sid); return {"closed": sid}

    @router.post("/files/read")
    async def read_file(body: dict):
        try:
            path = manager.path(str(body.get("path", "")))
            if path.stat().st_size > MAX_BYTES: raise ValueError("File exceeds 1 MB; use asset importer for larger media")
            raw = path.read_bytes()
            return {"value": {"base64": base64.b64encode(raw).decode()} if body.get("binary") else decode_bytes(raw), "bytes": len(raw), "modified": path.stat().st_mtime}
        except (ValueError, OSError) as exc: raise error(exc) from exc

    @router.post("/files/write")
    async def write_file(body: dict):
        try:
            path = manager.path(str(body.get("path", ""))); data = payload_bytes(body.get("value", "")); path.parent.mkdir(parents=True, exist_ok=True)
            if body.get("append"):
                if path.exists() and path.stat().st_size + len(data) > MAX_BYTES: raise ValueError("Append would exceed 1 MB")
                with path.open("ab") as handle: handle.write(data)
            else:
                temporary = path.with_name("." + path.name + "." + uuid4().hex + ".tmp")
                try: temporary.write_bytes(data); os.replace(temporary, path)
                finally: temporary.unlink(missing_ok=True)
            return {"written": len(data), "path": str(path.relative_to(manager.root))}
        except (ValueError, OSError) as exc: raise error(exc) from exc

    @router.post("/files/list")
    async def list_files(body: dict):
        try:
            path = manager.path(str(body.get("path", "")))
            if not path.is_dir(): raise ValueError("Folder does not exist")
            result = []
            for child in sorted(path.iterdir()):
                if child.is_symlink(): continue
                result.append({"name": child.name, "folder": child.is_dir(), "bytes": child.stat().st_size, "modified": child.stat().st_mtime})
                if len(result) >= 4096: break
            return {"files": result}
        except (ValueError, OSError) as exc: raise error(exc) from exc

    @router.post("/http")
    async def http_request(body: dict):
        try:
            url = str(body.get("url", ""))
            if not url.startswith(("http://", "https://")): raise ValueError("HTTP URL must use http:// or https://")
            reject_sensitive_app_url(url)
            method = str(body.get("method", "GET")).upper()
            if method not in ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"): raise ValueError("Unsupported HTTP method")
            headers = body.get("headers", {})
            async with httpx.AsyncClient(timeout=10, follow_redirects=False, trust_env=False) as client:
                async with client.stream(method, url, headers=headers, content=payload_bytes(body["value"]) if "value" in body else None) as response:
                    raw = bytearray()
                    async for chunk in response.aiter_bytes():
                        raw.extend(chunk)
                        if len(raw) > MAX_BYTES: raise ValueError("HTTP response exceeds 1 MB")
                    return {"status": response.status_code, "headers": dict(response.headers), "value": decode_bytes(bytes(raw))}
        except (ValueError, httpx.HTTPError) as exc: raise error(exc) from exc

    @router.get("/web/{channel}")
    async def web_get(channel: str):
        return {"channel": channel, "value": manager.http_channels.get(channel)}

    @router.post("/web/{channel}")
    async def web_post(channel: str, body: dict):
        try:
            value = body.get("value", body); payload_bytes(value); manager.http_channels[channel] = value
            return manager.bridge_push("http-" + channel, value)
        except ValueError as exc: raise error(exc) from exc

    @router.post("/bridge/{channel}")
    async def bridge_post(channel: str, body: dict):
        try: return manager.bridge_push(channel, body.get("value", body))
        except ValueError as exc: raise error(exc) from exc

    @router.websocket("/bridge/{channel}/ws")
    async def bridge_socket(websocket: WebSocket, channel: str):
        origin = websocket.headers.get("origin")
        if origin:
            from urllib.parse import urlsplit
            if urlsplit(origin).netloc != websocket.headers.get("host"):
                await websocket.close(code=1008); return
        await websocket.accept()
        session = await manager.open(SessionConfig(protocol="bridge", channel=channel))
        async def receive():
            while True:
                data = await websocket.receive_text()
                if len(data.encode()) > MAX_BYTES: raise ValueError("Bridge payload exceeds 1 MB")
                manager.bridge_push(channel, decode_bytes(data.encode()))
        task = asyncio.create_task(receive()); cursor = 0
        try:
            while not task.done():
                manager.get(session.id)
                for message in list(session.messages):
                    if message["seq"] > cursor:
                        await websocket.send_json(message); cursor = message["seq"]
                await asyncio.sleep(0.03)
            await task
        except (WebSocketDisconnect, RuntimeError, ValueError): pass
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError, WebSocketDisconnect, RuntimeError, ValueError): await task
            await manager.close(session.id)

    return router
