# 数据、设备与协议接入指南

本文说明如何把外部程序、传感器、文件或设备数据送进 TD Open，以及怎样把节点结果发出去。适用于 0.4 当前实现。总入口见 [API 接入导航](API_GUIDE.md)，AI 生成服务见 [AI API](AI_API.md)，通过对话操作工具见 [MCP 接入](MCP_GUIDE.md)。

## 1. 先选择接入方式

| 你的目标 | 建议入口 | 是否需要额外服务或驱动 |
|---|---|---|
| 自己写的 Python 程序发送传感器值 | Touch In CHOP 的开放桥接，或 UDP / OSC | 普通数值不需要设备 SDK |
| 接收其它创意软件的 OSC | OSC In DAT / CHOP | 对方必须发送当前支持的 OSC 数据 |
| 控制灯光 | DMX Out CHOP（ArtDMX） | Art-Net 接收设备或网关；不直接驱动 USB DMX |
| 与可靠数据流程序通信 | TCP/IP DAT / WebSocket DAT | 双方约定消息格式 |
| 接入物联网主题消息 | MQTT Client DAT | 独立运行的 MQTT Broker |
| Arduino / 串口传感器 | Serial DAT / CHOP | POSIX 串口设备与访问权限 |
| 读取 JSON、导出通道、监控目录 | File In / File Out / Folder | 文件放在当前数据目录的 `io/` |
| 请求自己的 HTTP 服务 | Web Client DAT | HTTP/HTTPS 服务 |
| 让外部程序读取/更新一个值 | Web Server DAT | TD Open 自带端点，不需要另起 Web 服务器 |
| 同机进程共享最新数据 | Shared Mem In / Out | 当前需要 POSIX mmap / flock |
| Kinect、RealSense、NDI 等原生设备/SDK | 对应“外部桥接”节点 | **需自己安装 SDK、运行适配器并连接真实设备** |

当前目录里的 **40 个节点具有自包含的协议通路**，这是节点数量，不是 40 种协议；另外 **92 个参考项是外部适配入口**，对应 49 类适配依赖。那些厂商 SDK 和原生设备驱动没有随项目内置。完整依赖可通过 `GET /api/io/capabilities` 查询，或阅读 [`IO_PROTOCOLS.md`](IO_PROTOCOLS.md) 和 [`backend/io_adapters.py`](../backend/io_adapters.py)。

Touch / Pipe / Sync 等参考名称采用本项目开放的 HTTP/WebSocket、TCP 或 OSC 通路，不表示与 TouchDesigner 的私有线协议兼容。Video Stream 使用逐帧图像 JSON，不是 RTSP/RTMP 播放器；Shared Mem 使用 TD Open 的 mmap 布局，不兼容 TouchDesigner 的共享内存 ABI。

## 2. 所有 I/O 节点共同的操作步骤

1. 在节点库按英文名搜索，确认家族。DAT 适合查看文字/JSON，CHOP 适合数值控制，TOP 接收画面。
2. 在参数面板设置地址、端口或路径。需要发送数据的节点先连接它的 `in` 端口。
3. 打开 **“启用连接 / 文件操作”**，对应 JSON 参数 `enabled:true`。新插入的节点默认关闭。
4. 保持浏览器工作台运行，查看节点预览和错误提示。单次 `/api/evaluate` 不会帮你运行浏览器 I/O 循环。
5. 关闭启用开关、删除节点或切换工程，会释放该节点的会话。连接断开后可关闭再打开开关重连。

`interval` 是更新间隔，单位毫秒，范围 30–60000；网络默认 100，文件默认 500。界面轮询时输出最近一条消息，而非把所有历史包都逐条输出。发送节点通常仅在输入序列化内容变化时发送；恒定输入不会按帧反复重发。若设备需要持续心跳，用外部程序定时发送，或明确让输入随时间变化。

**主机与端口如何填：**监听方 `host` 是服务器实际绑定的本机地址，连接方 `host` 是对方地址。同机先用 `127.0.0.1`；接收另一台机器的数据时需要绑定可达网卡（例如明确选择该网卡 IP），发送方填 TD Open 所在机器的局域网 IP。浏览器所在电脑与后端所在服务器不一定是同一台机器，真实网络 socket 和串口由后端所在机器打开。

不同应用不要占用同一个监听端口。下面用 `9000/9001` 做界面示例，用 `port:0` 做 API 自动分配测试，TD Open 本身继续使用 `8765`。

## 3. 可直接传递的数据格式

### 3.1 DAT：文本或 JSON

DAT 节点保留 UTF-8 文字或把对象显示为 JSON。TCP/UDP 读取的数据若是有效 JSON 会先解析，否则作为文字；无法解码为 UTF-8 的二进制表示为 `{"base64":"...","encoding":"base64"}`。不要把 JSON 外面再无意包一层字符串。

### 3.2 CHOP：完整多通道采样

推荐发送完整格式，避免丢失通道名和采样率：

```json
{
  "kind":"channels",
  "channels":[
    {"name":"tx","samples":[0.1,0.2,0.3]},
    {"name":"ty","samples":[0.5,0.7,0.6]}
  ],
  "sampleRate":60,
  "start":0,
  "timeSlice":true
}
```

`sampleRate` 为每秒采样数，`start` 为起始采样位置，`timeSlice` 表示这批采样是一个时间片。也接受单个数字、数字数组或 `{ "tx":[0.1,0.2], "ty":[0.5,0.7] }`，但简写形式默认使用 60 Hz。OSC 的 `args` 和 ArtDMX 的 `channels` 可转换为通道；带文字的 OSC 消息应先用 DAT 查看，CHOP 会对非数值报错。

### 3.3 TOP：真实图像字节

```json
{"mime":"image/png","data":"这里填写 PNG 文件的 base64 内容"}
```

也接受 `data:image/...;base64,...`。`data` 是编码后的图像文件内容，不是裸 RGBA 数组、远程 URL、文件路径或显卡共享句柄。当前桥接将图像最长边限制到 2048 像素，并通过浏览器实际解码。base64 会扩大传输体积；大视频优先使用素材上传和专用播放节点，不要逐帧塞进 UDP。

### 3.4 SOP / COMP

SOP 外部适配入口要求项目定义的 `GeometrySpec` 几何 JSON，接入前按 [`frontend/src/nodes/geometry.ts`](../frontend/src/nodes/geometry.ts) 的结构转换并通过校验。不能直接发送厂商 SDK 的内存对象或原生 C++ 指针。COMP Shared Mem 传送序列化数据，不会加载并执行一个原生 TouchDesigner 组件。

## 4. 会话 API：创建 → 发送/轮询 → 关闭

所有 I/O HTTP 接口与 TD Open 共用后端，根地址为 `http://127.0.0.1:8765/api/io`。它们不是 AI 服务商 API。以下终端命令均从项目根目录运行：

```bash
cd /storage/homes/hongzj/dell/td_open
export TD_BASE=http://127.0.0.1:8765
curl --fail-with-body "$TD_BASE/api/io/capabilities"
curl --fail-with-body "$TD_BASE/api/io/sessions"
```

| 方法与路径（相对 `/api/io`） | 请求 / 结果 |
|---|---|
| `POST /sessions` | 请求 `protocol`、连接参数；返回 `id`、`state`、实际 `address` 等 |
| `GET /sessions` | 当前会话摘要数组；不会泄露会话密码配置 |
| `POST /sessions/{id}/send` | 请求 `{"value":数据,"options":{...}}`；返回字节数 `sent` |
| `GET /sessions/{id}/messages?after=N` | 返回序号大于 N 的消息和 `dropped` |
| `DELETE /sessions/{id}` | 释放 socket、串口或 mmap；返回 `closed` |

创建的会话是后端资源，**不会自动在画布上新增节点**；画布节点会建立自己的会话。不要同时让手写 API 会话和画布节点监听同一个固定端口。使用 API 新建工程和节点的方法见 [本地 HTTP API](HTTP_API.md)。

一条消息的形状：

```json
{"seq":1,"time":1760000000.0,"value":{"temperature":21.3},"peer":"external"}
```

读完后记录最大的 `seq`，下次作为 `after`，避免重复处理。每个会话最多保留 128 条消息；`dropped > 0` 表示消费太慢，旧消息已被覆盖，系统没有磁盘消息队列。每个会话 90 秒未访问会过期，清理任务按周期运行；轮询或发送会续期，单纯列出会话不会续期。最多 64 个会话，通常单条载荷最多 1 MiB；UDP 最多 65507 字节。退出程序使用 `finally` 关闭会话。

下面是可直接运行的 OSC 本机闭环，不需要音视频设备，也不会改工程：

```bash
.venv/bin/python - <<'PY'
import os
import time
import httpx

base = os.environ.get("TD_BASE", "http://127.0.0.1:8765")
with httpx.Client(base_url=base + "/api/io", timeout=12) as client:
    opened = []
    def create(config):
        response = client.post("/sessions", json=config)
        response.raise_for_status()
        session = response.json()
        opened.append(session["id"])
        return session
    try:
        receiver = create({"protocol":"osc", "mode":"listen", "host":"127.0.0.1", "port":0})
        sender = create({"protocol":"osc", "mode":"connect", "host":"127.0.0.1", "port":receiver["address"][1]})
        response = client.post(f"/sessions/{sender['id']}/send", json={
            "value":{"address":"/position", "args":[0.25,0.75]}
        })
        response.raise_for_status()
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            response = client.get(f"/sessions/{receiver['id']}/messages", params={"after":0})
            response.raise_for_status()
            messages = response.json()["messages"]
            if messages:
                print(messages[-1]["value"])
                break
            time.sleep(0.05)
        else:
            raise RuntimeError("3 秒内没有收到 OSC 数据")
    finally:
        for sid in reversed(opened):
            client.delete(f"/sessions/{sid}")
PY
```

预期输出 `{'address': '/position', 'args': [0.25, 0.75]}`。这证明数据通过真实 socket 往返，不表示任意外部设备协议都已经适配。

## 5. UDP、OSC 与 Art-Net / DMX

### UDP：最简单的外部程序入门

画布添加 **UDP In DAT**（`ref_dat_udp_in`），设置 `mode=listen`、`host=127.0.0.1`、`port=9001`，启用后运行：

```bash
.venv/bin/python - <<'PY'
import json
import socket
with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
    payload = json.dumps({"temperature":21.3,"light":0.8}).encode("utf-8")
    sock.sendto(payload, ("127.0.0.1", 9001))
PY
```

节点将显示收到的对象。需要反向输出时添加 **UDP Out DAT**（`ref_dat_udp_out`），连接 DAT 输入，设置对方的 `host` 和 `port`。UDP 不保证送达、顺序或去重，重要状态可在你自己的应用层加入序号和确认。

### OSC：地址与参数

常用类型为 `ref_chop_osc_in` / `ref_chop_osc_out` 和 `ref_dat_osc_in` / `ref_dat_osc_out`。用 CHOP 接数值，用 DAT 看完整地址与参数。双方主机、端口一致，发送方额外设置 `address`，如 `/position`；地址必须以 `/` 开始。

**当前接收端的 `address` 参数不执行地址过滤**，它接收端口上所有支持的 OSC 消息。需要按路径区分时，在 DAT 后处理或在外部程序分流。TUIO 作为原始 OSC 地址和参数接收；没有自动还原完整的触摸生命周期。OSC bundle 的 timetag 会保留，但不按 timetag 定时调度。

上面的会话闭环已经是 OSC 发送示例；若给界面监听节点发数据，只创建发送会话并把 `port` 设为其监听端口即可。HTTP JSON 发送端支持数值、字符串、布尔和 null 参数；原生解码也能读 blob，HTTP JSON 的任意对象不会自动变成 OSC blob。

### DMX：当前是 ArtDMX

添加 **DMX Out CHOP**（`ref_chop_dmx_out`），填写接收器 IP、`port=6454`、`universe`，连接通道数据并启用。`universe` 范围 0–32767，载荷 1–512 通道，值为 0–255；如果输入是 0–1，先乘以 255。接收使用 **DMX In CHOP**（`ref_chop_dmx_in`）。

API 创建会话配置示例：

```json
{"protocol":"artnet","mode":"connect","host":"127.0.0.1","port":6454}
```

随后向返回的 `/sessions/{id}/send` 提交：

```json
{"value":{"universe":0,"channels":[255,64,0,255]}}
```

替换主机为真实接收器地址后才能控制设备。当前没有 sACN、设备发现或 USB DMX 原生驱动；接收节点也没有按 `universe` 自动筛选多个宇宙。涉及多个 Universe 时可通过原始 API 消息里的 `universe` 字段自行路由。

## 6. TCP 与 WebSocket

### TCP/IP DAT

添加 **TCP/IP DAT**（`ref_dat_tcp_ip`），设置 `mode=listen`、`host=127.0.0.1`、`port=9001`、`framing=newline`，启用。外部 Python 客户端：

```bash
.venv/bin/python - <<'PY'
import json
import socket
with socket.create_connection(("127.0.0.1", 9001), timeout=5) as sock:
    sock.sendall((json.dumps({"position":[1,2,3]}) + "\n").encode())
PY
```

`framing` 必须两端一致：

| 值 | 边界规则 | 外部发送方法 |
|---|---|---|
| `newline` | 每条消息以换行分隔 | `json.dumps(value).encode() + b"\n"` |
| `length` | 4 字节无符号大端长度，再接消息体 | `struct.pack(">I", len(payload)) + payload` |
| `raw` | 每次接收的字节块 | 需要你自己处理分包、粘包，不能把块当完整业务消息 |

TCP/IP DAT 是双向节点，输入连线可向对端发送；监听模式会广播给已连接客户端。没有客户端时发送会提示 `No TCP client connected`。Pipe 参考节点采用这套开放 TCP 传输，不包含私有 Pipe 格式。

### WebSocket DAT 与逐帧图像

添加 **WebSocket DAT**（`ref_dat_websocket`），监听参数 `mode=listen`、`host=127.0.0.1`、`port=9001`。若连接已有服务器，设 `mode=connect`，实际连接目标由 `url`（例如 `ws://127.0.0.1:9001`）决定，不由 `host/port` 代替。监听模式使用 `host/port`，忽略连接 URL。

外部客户端需要保持连接才能持续收发。项目已安装 `websockets`：

```bash
.venv/bin/python - <<'PY'
import asyncio
import json
from websockets.asyncio.client import connect
async def main():
    async with connect("ws://127.0.0.1:9001", proxy=None) as socket:
        await socket.send(json.dumps({"x":0.25,"y":0.75}))
        await asyncio.sleep(1)
asyncio.run(main())
PY
```

**Video Stream In / Out TOP**（`ref_top_video_stream_in` / `ref_top_video_stream_out`）使用相同传输，数据须换成第 3 节的 `{mime,data}` 图像对象。它不会解码 RTSP URL，不支持 GPU 共享纹理句柄。需要真实 NDI/Spout 等协议时使用对应外部适配器。

## 7. MQTT：先有 Broker，再连接主题

TD Open 提供客户端，**不包含 MQTT Broker**。先在自己的环境中准备可达 Broker。画布添加 **MQTT Client DAT**（`ref_dat_mqtt_client`）：

| 参数 | 示例 | 意义 |
|---|---|---|
| `host` / `port` | `127.0.0.1` / `1883` | Broker 地址与端口 |
| `topic` | `td-open/#` | 订阅主题，可以包含 Broker 支持的通配符 |
| `publish_topic` | `td-open/value` | 发布主题，不允许 `#` 或 `+` |
| `enabled` | `true` | 建立连接并开始订阅 |

输入连到该 DAT 的 `in`，变化后发往 `publish_topic`；输出包含收到的 `topic`、`payload` 和 `retained`，例如：

```json
{"topic":"td-open/sensor","payload":{"temperature":21.3},"retained":false}
```

需要用户名/密码时，当前界面节点没有对应字段，直接会话 API 支持 `username` / `password`。在自己的客户端程序中从环境变量读取真实凭据，不要写入公开工程。请求形状如下（占位文字必须替换，示例不会自动创建 Broker）：

```json
{"protocol":"mqtt","mode":"connect","host":"127.0.0.1","port":1883,"topic":"td-open/#","username":"你的用户名","password":"你的密码"}
```

对该会话发送时，要显式使用不含通配符的发布主题：

```json
{"value":{"temperature":21.3},"options":{"topic":"td-open/sensor","retain":false}}
```

当前实现采用 MQTT 3.1.1，QoS 0 发布，可接收 QoS 0/1；没有 QoS 2、TLS 和自动重连。不能把 `8883` 填进去就认为 TLS 已启用。需要这些功能时，用成熟 MQTT 客户端在外部连接 Broker，再通过本项目开放桥接传值。

## 8. 串口：设备在后端机器上

添加 **Serial DAT**（`ref_dat_serial`）或 **Serial CHOP**（`ref_chop_serial`）。设置 `device`，例如 Linux 的 `/dev/ttyUSB0` 或 macOS 的 `/dev/cu.*`，`baud` 如 `115200`，然后启用。设备路径必须为支持的 POSIX 串口路径；Windows 当前需外部串口适配器。

API 创建请求示例：

```json
{"protocol":"serial","device":"/dev/ttyUSB0","baud":115200}
```

使用 `/sessions/{id}/send` 的 `value:"LED 1\n"` 发送文本，轮询 `messages` 接收数据。当前为 8N1，波特率必须是操作系统支持的值。`Permission denied` 表示运行 TD Open 的系统用户没有设备访问权限；`No such file` 表示后端机器上没有该设备或路径已变化。

接收按字节块输出，**不自动拼接换行或帧协议**。若一个 JSON 被拆成两次串口读取，直接接 CHOP 可能报错。可靠方案是在你的串口适配程序中完成缓冲、校验、帧解析，再通过桥接发送完整对象。这里没有承诺兼容任意传感器的专有串口指令集。

## 9. 文件、目录与共享内存

### 文件读写

文件节点的 `path` 相对于当前数据目录下的 `io/`。默认 `path=example.json` 指 `td_open/data/io/example.json`；使用隔离实例时则在它的 `TD_DATA_DIR/io/`。不能填绝对路径、`../` 越界路径或经过符号链接访问其它目录。

先通过 API 写一个小 JSON：

```bash
curl --fail-with-body "$TD_BASE/api/io/files/write" \
  -H 'Content-Type: application/json' \
  --data-binary '{"path":"guide/sensor.json","value":{"tx":[0.1,0.2],"ty":[0.5,0.7]}}'

curl --fail-with-body "$TD_BASE/api/io/files/read" \
  -H 'Content-Type: application/json' \
  --data-binary '{"path":"guide/sensor.json"}'

curl --fail-with-body "$TD_BASE/api/io/files/list" \
  -H 'Content-Type: application/json' \
  --data-binary '{"path":"guide"}'
```

画布用 **File In CHOP**（`ref_chop_file_in`），`path=guide/sensor.json`，启用后即可获取 `tx`、`ty`；也可以用 **File In DAT**（`ref_dat_file_in`）查看原文。**File Out DAT/CHOP**（`ref_dat_file_out` / `ref_chop_file_out`）连接输入后写文件，`append=false` 原子覆盖，`append=true` 追加。追加**不会自动补换行**；需要 NDJSON 时输入文本本身必须带 `\n`。

**Folder DAT**（`ref_dat_folder`）的 `path` 填目录相对路径，返回名称、是否目录、大小和修改时间。单文件/单条数据上限 1 MiB，大素材应走 `/api/upload`。文件输出仅在输入变化时写入；相同输入不会不断追加重复行。

### 共享 mmap

本版本在 CHOP、TOP、COMP 家族提供 **Shared Mem In / Out**。两端使用相同家族、`channel` 相同（如 `sensor-demo`），启用后交换最新序列化值。它不是历史队列，高频写入可能覆盖中间状态。

会话 API 两端均使用：

```json
{"protocol":"sharedmem","channel":"sensor-demo"}
```

一个会话 `/send`，另一个轮询 `/messages` 即可验证。底层文件为当前数据目录 `io/sharedmem/sensor-demo.bin`。原生程序直连时遵循：

- 0–7 字节：小端 unsigned 64 位 generation，写入过程中为奇数。
- 8–15 字节：小端 unsigned 64 位载荷字节数。
- 从 16 字节起：最大 1 MiB UTF-8 JSON/文字/二进制。
- 写者使用 `flock(LOCK_EX)`，先写奇数 generation，再写内容与长度，最后写下一个偶数；读者只接受前后 generation 相同且为偶数的内容。

当前需 POSIX `flock`。若外部程序在 Windows，优先使用 HTTP/WebSocket 桥接，不要按此布局冒充 TouchDesigner 原生共享内存。

## 10. HTTP 客户端与自己的 JSON 端点

### Web Client DAT：请求外部 API

添加 **Web Client DAT**（`ref_dat_web_client`）。参数 `url` 填完整请求地址，`method` 可为 GET/POST/PUT/PATCH/DELETE/HEAD，`headers` 必须是 JSON 对象的文本。例如 `{"Content-Type":"application/json"}`。如果输入连入 DAT，输入值将作为请求体发送；收到的输出包括 `status`、`headers`、`value`。

无需外网的诊断可用本地公开健康检查：

```bash
curl --fail-with-body "$TD_BASE/api/io/http" \
  -H 'Content-Type: application/json' \
  --data-binary '{"url":"http://127.0.0.1:8765/api/health","method":"GET","headers":{}}'
```

若你的服务用了其它端口，修改 JSON 内的 URL。请求成功时外层 HTTP 状态是 200，但目标服务可能返回 4xx/5xx，程序仍需检查响应中的 `status`。节点界面会把目标 4xx/5xx 标记为错误。代理请求超时 10 秒、响应上限 1 MiB、不自动跟随重定向，也不默认读取进程环境中的代理配置。

输入为普通文字时直接发送 UTF-8；输入为对象时会序列化。需要特定 Content-Type 应由 `headers` 明确设置。`headers` 中若填真实密钥，它会成为工程明文参数并随导出保存；AI 生成服务更适合使用连接中心单独保存密钥和专用 AI 节点。

### Web Server DAT：对外提供一个值

添加 **Web Server DAT**（`ref_dat_web_server`），设 `channel=guide` 并启用。共享端点为 `/api/io/web/guide`；它使用已有的 TD Open HTTP 端口，不另开 9001。

```bash
curl --fail-with-body "$TD_BASE/api/io/web/guide" \
  -H 'Content-Type: application/json' \
  --data-binary '{"value":{"brightness":0.7}}'

curl --fail-with-body "$TD_BASE/api/io/web/guide"
```

GET 返回 `{"channel":"guide","value":{"brightness":0.7}}`。节点没有输入连线时可读取外部 POST 的值；有输入时，输入变化会发布到 GET 响应，因此要明确哪一端拥有写入权。该值只在后端内存中，服务重启后清空。端点不是通用网站托管器，没有模板路由和独立用户认证。

## 11. 外部 SDK 桥接：让真实设备的数据进来

### 第一步：确认是否真的有原生适配器

搜索带 **“外部桥接”** 的节点，比如 `RealSense · 外部桥接`（`ref_top_realsense`）。描述会列出 SDK/硬件依赖。没有适配器时节点明确提示等待，不会生成假的设备画面。

`GET /api/io/capabilities` 中 `native_driver:false` 表示没有内置驱动；`connected:true` 仅说明该默认适配通道最近收到了外部消息，**不是硬件健康证明或 SDK 安装检测**。自定义通道名可以供节点使用，但依赖状态摘要按默认适配器 ID 统计。

### 第二步：先用通用桥接跑通数据结构

不安装 SDK 也能测试桥接管道。添加 **Touch In CHOP**（`ref_chop_touch_in`），设 `channel=guide-sensor`，启用；随后发送明确的测试样本：

```bash
curl --fail-with-body "$TD_BASE/api/io/bridge/guide-sensor" \
  -H 'Content-Type: application/json' \
  --data-binary '{"value":{"kind":"channels","channels":[{"name":"temperature","samples":[21.3]}],"sampleRate":1,"start":0,"timeSlice":true}}'
```

返回 `{"delivered":1,"channel":"guide-sensor"}` 表示推送给一个已存在的桥接订阅会话，**不表示渲染已完成**。`delivered:0` 表示还没有订阅者，通常是节点未启用、浏览器未运行或通道名不同；桥接不会替未来订阅者保留这条消息。示例中的 `21.3` 是测试值，不是软件自动读到的真实温度。

### 第三步：替换为真实 SDK 读数

你自己的适配进程负责：初始化 SDK → 连接设备 → 读取真实数据 → 转换为第 3 节的结构 → POST 推送或 WebSocket 发送。适配器可以使用厂商要求的 Python/C++/其它语言；不需要导入 TD Open 内部模块。

下面是发送一张你已经保存的真实图片的完整适配端示例，路径替换为项目内已有文件：

```bash
.venv/bin/python - <<'PY'
import base64
import os
from pathlib import Path
import httpx

path = Path("data/input/camera-frame.png")  # 替换为已有的 PNG
if not path.is_file():
    raise SystemExit("请先把真实图片放到 data/input/camera-frame.png")
if path.stat().st_size > 750_000:
    raise SystemExit("图片过大，请缩小后再通过 1 MiB 桥接传输")
value = {"mime":"image/png", "data":base64.b64encode(path.read_bytes()).decode()}
base = os.environ.get("TD_BASE", "http://127.0.0.1:8765")
response = httpx.post(base + "/api/io/bridge/guide-camera", json={"value":value}, timeout=10)
response.raise_for_status()
print(response.json())
PY
```

对应画布使用 **Touch In TOP**（`ref_top_touch_in`），`channel=guide-camera`。接真实 RealSense 时改为 RealSense 节点并使用相同通道，把 `Path.read_bytes()` 替换为你的 SDK 帧编码结果；这一步需要实际 SDK 代码，本仓库并未内置它。

仓库还提供 [`scripts/io-bridge.py`](../scripts/io-bridge.py)：

```bash
# 发送一张 data/ 内已有图片；--image 相对于项目 data/，不跟随 TD_DATA_DIR。
.venv/bin/python scripts/io-bridge.py --channel guide-camera --image input/camera-frame.png

# 转发一行测试 JSON；实际 SDK 程序可输出同样的逐行 JSON 到管道。
printf '%s\n' '{"tx":[0.2],"ty":[0.6]}' | .venv/bin/python scripts/io-bridge.py --channel guide-sensor
```

工具默认连接 `http://127.0.0.1:8765`，其它实例用 `--server http://127.0.0.1:8767`。每一行 stdin 必须是一条完整 JSON；调试日志应写到 stderr，别混入 JSON 数据流。

### WebSocket 双向桥接

持续传输或要从输出节点读取数据时连接：

```text
ws://127.0.0.1:8765/api/io/bridge/guide-sensor/ws
```

桥接 WebSocket 与 HTTP 的包裹格式不同：**WS 发送原始 value，HTTP POST 发送 `{"value":value}`**。WS 接收的是带 `seq/time/value/peer` 的消息封套：

```bash
.venv/bin/python - <<'PY'
import asyncio
import json
from websockets.asyncio.client import connect
async def main():
    async with connect("ws://127.0.0.1:8765/api/io/bridge/guide-sensor/ws", proxy=None) as socket:
        await socket.send(json.dumps({"tx":[0.2],"ty":[0.6]}))
        message = json.loads(await asyncio.wait_for(socket.recv(), timeout=3))
        print(message["value"])
asyncio.run(main())
PY
```

同通道订阅者会收到发送者自己的消息，避免把每条接收消息原样无限回传。桥接通道名使用 1–96 个英文字母、数字、`_`、`-`、`.`。浏览器连接必须同源；本机适配器直接连接无需额外 TD Open Bearer Token。

## 12. 排错与二次开发边界

| 问题 | 原因与处理 |
|---|---|
| 节点一直没有数据 | 确认 `enabled`、工作台正在运行、后端所在机器、监听端口/通道、上游是否真的发送 |
| `Address already in use` | 端口已被另一个节点、API 会话或进程占用；关闭旧会话或改端口 |
| `I/O session expired` | 90 秒未续期或服务已重启；重新创建会话，前端关闭再开启 |
| 收到旧数据/漏消息 | 检查 `after` 游标、`dropped` 和轮询频率；共享内存只保留最新值，前端每次也只用最新消息 |
| OSC CHOP 报非数值 | 使用 DAT 查看消息，移除文字参数或在外部程序转成数值 |
| MQTT 发布失败 | 发布主题不能含 `#` / `+`，检查 Broker 是否可达及凭据，TLS 不是当前内置功能 |
| 共享内存不工作 | 当前需 POSIX，确认通道名和数据目录一致；不能直接连接 TouchDesigner ABI |
| 文件路径被拒绝 | 使用当前 `data/io` 相对路径，禁止绝对路径、越界和符号链接 |
| 图像桥接报错 | 使用真实 PNG/JPEG 等图像字节 base64；检查 MIME、体积，不能填网页 URL 或设备句柄 |
| 外部适配节点一直等待 | 该入口没有内置驱动；安装设备 SDK 并启动你的适配进程，确保先启用订阅节点再发数据 |
| HTTP 代理被拒绝访问 `/api/...` | 自动图节点不能调用受保护的 TD Open 控制/秘密配置接口；从明确的 UI 动作或自己的程序直接使用 [本地 HTTP API](HTTP_API.md) |
| TCP/UDP/WS/MQTT 目标端口被拒绝 | 原始传输不能回连 TD Open / 前端监听端口；规则按端口保守检查，对其它主机同端口也生效 |

I/O 服务没有独立账户认证；默认在可信本机使用。需要多人共享或跨机器连接时，部署者应安排访问控制和网络边界。不要把设备密码或私密 HTTP Header 保存进准备公开的工程。

扩展协议时可沿着 [`ioDefinitions.ts`](../frontend/src/nodes/ioDefinitions.ts)（节点名称/家族/依赖）→ [`ioCatalog.ts`](../frontend/src/nodes/ioCatalog.ts)（参数）→ [`ioRuntime.ts`](../frontend/src/nodes/ioRuntime.ts)（前端生命周期和转换）→ [`io_runtime.py`](../backend/io_runtime.py)（实际通信）查看。回归检查在 [`tests/test_io_runtime.py`](../tests/test_io_runtime.py)，包含本机 UDP/OSC/ArtDMX、TCP、WebSocket、测试 Broker、POSIX PTY 和 mmap；这些测试不替代真实硬件验收。
