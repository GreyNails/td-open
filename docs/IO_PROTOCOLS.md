# Node I/O and native device adapters

The I/O nodes are disabled when inserted. Connect input data where applicable,
set a path/address and turn **启用连接 / 文件操作** on. Turning it off, deleting
the node or switching projects closes its session. Sessions expire after 90
seconds without polling, including abandoned browser tabs. The server allows
64 sessions and bounds each payload to 1 MiB (UDP: 65,507 bytes).

## Implemented transports

The catalog has **40 nodes with self-contained transport paths**, including six
Touch input/output nodes using the open HTTP/WebSocket bridge. This is a node
count, not 40 different protocols or 40 TouchDesigner-compatible wire formats.
The other **92 external references** require one of **49 adapter categories**;
their native SDK integrations are not bundled.

| Transport | Actual behavior | Boundaries |
|---|---|---|
| UDP | OS UDP socket listen/send, UTF-8/JSON/binary | Datagram transport, no reliability |
| OSC | OSC 1.0 addresses, numeric/string/blob arguments, nested bundles | Bundle timetags are preserved, not scheduled; TUIO is raw OSC data |
| Art-Net / DMX | ArtDMX universe and 1–512 slots, values 0–255 | No sACN, discovery or physical USB DMX driver |
| TCP | Listen/connect, duplex and broadcasts to connected peers | Newline, unsigned big-endian 32-bit length, or raw chunk framing |
| WebSocket | RFC 6455 listen/connect, text/JSON/binary receive | WebSocket video exchanges decoded base64 images, not RTSP/RTMP codecs |
| MQTT | MQTT 3.1.1 CONNECT/SUBSCRIBE, QoS 0 publish, QoS 0/1 receive | No QoS 2, TLS or reconnect in this version |
| Serial | Actual POSIX 8N1 device read/write, configurable baud | Linux/macOS permissions and device required; received chunks aren't lines |
| Shared memory | Shared file-backed mmap with seqlock header | Open TD Open layout, **not** the TouchDesigner shared-memory ABI |
| File / Folder | Read, atomic write/append, list metadata | Confined to `data/io`; symlinks and parent-path escapes rejected |
| HTTP | GET/POST/PUT/PATCH/DELETE/HEAD client and JSON server endpoint | Bounded response, 10s timeout, no automatic redirects |
| External bridge | HTTP POST and WebSocket sensor/frame exchange | Does not install a proprietary device driver |

Touch, Pipe and Sync reference nodes use the documented open bridge/TCP/OSC
transport. They are not wire-compatible implementations of Derivative's private
protocols. COMP Shared Mem exchanges serialized data, not an executable scene.

Automatic HTTP requests reject privileged TD Open API paths, including encoded
path variants, and do not follow redirects. Raw TCP, MQTT, UDP and WebSocket
clients cannot connect to the application or frontend's listening port, even
through another hostname. This conservative port rule also applies to remote
hosts on that same port; keep the local app on its dedicated development port
when using common external service ports. These restrictions prevent an imported
graph from turning an I/O node into an automatic call to script execution or
private configuration endpoints. Script execution uses a separate manual UI
request and a short-lived, single-use token held only in server memory.


## Values

DAT nodes expose UTF-8 or JSON. CHOP nodes preserve the portable multichannel
value, including names, samples, sample rate and starting sample:

```json
{"kind":"channels","channels":[{"name":"tx","samples":[0.1,0.2]},{"name":"ty","samples":[0.5,0.7]}],"sampleRate":60,"start":0,"timeSlice":true}
```

A number, array of numbers, OSC `args`, ArtDMX `channels`, or a mapping of channel
names to sample arrays is also accepted. TOP nodes decode actual image bytes:

```json
{"mime":"image/png","data":"<base64 PNG bytes>"}
```

They do not synthesize frames when a hardware adapter is missing. A missing
adapter appears as an explicit node error identifying the required SDK/device.
The 92 device, SDK, format and external-protocol references in `ioDefinitions.ts` are adapter access
points, **not 92 native drivers**. `GET /api/io/capabilities` exposes each
required dependency, `native_driver:false`, and recent adapter connection state.

## API and a local OSC pair

The API is served by the existing app. No separate process is required.

```python
import httpx
client = httpx.Client(base_url="http://127.0.0.1:8765/api/io")
receiver = client.post("/sessions", json={"protocol":"osc", "port":0}).json()
sender = client.post("/sessions", json={"protocol":"osc", "mode":"connect", "port":receiver["address"][1]}).json()
client.post(f"/sessions/{sender['id']}/send", json={"value":{"address":"/position", "args":[0.25,0.75]}})
print(client.get(f"/sessions/{receiver['id']}/messages", params={"after":0}).json())
for session in (sender, receiver):
    client.delete(f"/sessions/{session['id']}")
```

`GET /sessions/{id}/messages?after=N` returns a bounded queue of messages with
sequence numbers. `dropped` counts messages overwritten since the last cursor.
Clients renew the lease by polling. Errors include unavailable ports/devices,
invalid payloads and disconnected peers; they aren't replaced with fabricated
success values.

## External SDK integration

A native adapter owns SDK initialization, physical device access and conversion
to portable values. It sends:

```python
httpx.post("http://127.0.0.1:8765/api/io/bridge/realsense", json={"value": actual_measurement})
```

Alternatively connect to `/api/io/bridge/realsense/ws`. The bridge returns
messages containing `seq`, `time`, `value` and `peer`. Choose the same channel
in the node's parameters. The small `scripts/io-bridge.py` utility can forward
newline-delimited JSON from a native adapter's stdout or send an existing image
from `data/` without requiring the SDK to import app internals.

The native dependencies are enumerated in `backend/io_adapters.py`: Kinect,
Azure Kinect, NDI, Spout/Syphon, DirectX, RenderStream, Notch, NVIDIA SDKs, OAK,
Oculus/OpenVR, Orbbec, Ouster, RealSense, ZED, tracking systems, laser DACs,
Substance, calibration systems, OpenColorIO, VST and others. A reachable bridge
is evidence of a connected adapter, not proof that its SDK is installed locally.

## Shared mmap layout

`data/io/sharedmem/<channel>.bin`, maximum payload 1 MiB plus a 16-byte header:

- Offset 0: little-endian unsigned 64-bit generation; odd while writing.
- Offset 8: little-endian unsigned 64-bit payload byte length.
- Offset 16: UTF-8 JSON/text or binary payload.

Writers acquire `flock(LOCK_EX)`, store an odd generation, update bytes/length,
then store the next even generation. Readers accept a value only when both
before/after generation reads match and are even. This also works between
independent processes on the same machine.

## Verification

`pytest tests/test_io_runtime.py` exercises actual loopback UDP/OSC/ArtNet,
TCP framing, WebSocket, MQTT broker traffic, HTTP, POSIX PTY serial and mmap.
It also covers bounded file paths, bridge state and socket-origin validation.
Frontend tests check multichannel conversion, opt-in behavior, async creation /
delete races, no repeat writes, and explicit missing-driver reporting.

Protocol references: [OSC 1.0](https://opensoundcontrol.stanford.edu/spec-1_0.html),
[MQTT 3.1.1](https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/os/mqtt-v3.1.1-os.html),
[websockets API](https://websockets.readthedocs.io/en/stable/reference/asyncio/client.html).

## Local application boundary

Protocol nodes cannot target the application's own service or frontend ports.
HTTP and Web Render reject sensitive TD Open API paths after URL decoding and
path normalization. Python execution additionally requires a short-lived,
single-use intent token obtained by the explicit Run action. Imported graphs do
not carry these tokens. These measures do not make trusted Python code a sandbox.

The raw transport port check is deliberately conservative across all destination
hosts. A deployment that exposes the frontend on port 443 also blocks protocol
nodes targeting port 443; the default local 8765 deployment avoids this conflict.
