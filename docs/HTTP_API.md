# 本地 HTTP API 接入指南

本文适用于 TD Open 0.5，面向希望用 Python、curl、其它应用或自己的插件控制 TD Open 的开发者。示例对应仓库中的实际路由；交互式接口文档以你当前运行的版本为准。

完整导航见 [API 接入总指南](API_GUIDE.md)。如果你只是想在界面里接入语言、图片、音乐或 3D 生成服务，先看 [AI API 接入说明](AI_API.md)。设备、OSC、MQTT、文件和外部 SDK 的接入见 [I/O 接入指南](IO_GUIDE.md)，通过对话操作工具见 [MCP 接入指南](MCP_GUIDE.md)。

## 1. 先分清两个地址

| 名称 | 示例 | 填在哪里 | 用途 |
|---|---|---|---|
| TD Open 本地服务地址 | `http://127.0.0.1:8765` | 本文的 `TD_BASE`、Python 的 `base_url` | 保存工程、编辑节点、上传资源、调用 TD Open 的代理接口 |
| AI 服务商的 Base URL | 由服务商提供的 HTTPS 地址，也可以是你的本地模型服务 | 界面的连接中心 / AI 服务配置 | TD Open 后端向模型服务发送请求；具体路径由配置追加 |

不要把 TD Open 的 `/api` 地址填成模型服务的 Base URL；也不要拿模型服务的 API Key 当作本地服务登录密码。当前本地 HTTP API 没有通用的 `Bearer` 登录机制。AI 密钥用于后端连接服务商，Python 脚本的一次性令牌只用于执行脚本，两者用途不同。

开发服务器通常在 `127.0.0.1:8765` 提供界面和 API。使用 Vite 开发前端时，前端端口可能不同；程序接入优先使用 Python 后端端口。远程服务器上的 `127.0.0.1` 指的是服务器自己，SSH 端口转发后才能在你的电脑上使用同样的地址。

在项目根目录运行：

```bash
cd /storage/homes/hongzj/dell/td_open
./scripts/start.sh
```

在另一个终端设置本页示例使用的地址：

```bash
cd /storage/homes/hongzj/dell/td_open
export TD_BASE=http://127.0.0.1:8765
mkdir -p .cache/api-guide
curl --fail-with-body "$TD_BASE/api/health"
```

若想练习而不改现有作品，可以在单独终端启动另一份隔离服务：

```bash
TD_PORT=8767 TD_DATA_DIR=.cache/api-guide/server-data ./scripts/start.sh
```

随后将 `TD_BASE` 和 Python 示例中的地址改成 `http://127.0.0.1:8767`。`TD_DATA_DIR` 必须位于本项目内；未设置时数据写入 `data/`。

可以直接在浏览器打开：

- [`/docs`](http://127.0.0.1:8765/docs)：Swagger UI，可展开接口、填写请求并执行。
- [`/redoc`](http://127.0.0.1:8765/redoc)：阅读式接口参考。
- [`/openapi.json`](http://127.0.0.1:8765/openapi.json)：生成客户端、检查字段类型时使用。

## 2. API 速查

路径均相对于本地服务根地址。除上传接口外，请求体为 JSON；带请求体时发送 `Content-Type: application/json`。

| 方法与路径 | 请求体 / 参数 | 结果 | 是否保存或执行 |
|---|---|---|---|
| `GET /api/health` | 无 | 状态、版本、节点数、数据目录 | 只读 |
| `GET /api/catalog` | 无 | 节点、参数、端口、运行环境 | 只读 |
| `GET /api/examples` | 无 | 只读案例摘要数组 | 只读 |
| `GET /api/examples/{id}` | 案例 ID | 案例原件，`settings.is_example=true` | 只读 |
| `GET /api/projects` | 无 | 工程摘要数组；案例行带 `is_example=true` | 只读 |
| `GET /api/projects/{id}` | 工程 ID | 完整工程 | 只读 |
| `POST /api/projects` | **工程本身** | 保存后的完整工程 | 用户项目按 ID 新建或更新；案例 ID 自动另存新项目 |
| `DELETE /api/projects/{id}` | 工程 ID | `{"deleted":"id"}` | 删除用户工程 JSON；案例原件不能删除 |
| `POST /api/validate` | **工程本身** | `valid`、`errors`、补全默认值的 `project` | 不保存 |
| `POST /api/commands` | `{"project":...,"commands":[...]}` | 修改后的 `project`、`applied` | 不保存 |
| `POST /api/evaluate` | `{"project":...,"time":0}` | `values`、`errors`、`skipped`、`skip_reasons` | 单次后端计算，不保存 |
| `POST /api/upload` | multipart 表单字段 `file` | 资源 `url`、`name`、`kind`、`size` | 写入素材目录 |
| `GET /api/assets/{filename}` | 上传返回的文件名 | 素材文件 | 只读 |
| `POST /api/artifacts` | multipart 表单字段 `file` | 导出文件 `url`、`name`、`size` | 写入导出目录 |
| `GET /api/exports/{filename}` | 保存返回的文件名 | 导出文件 | 只读 |
| `POST /api/scripts/intent` | 无 | 一次性 `token`、`expires_in` | 本机申请手动执行令牌 |
| `POST /api/scripts/run` | `code`、`inputs`、`time`，加令牌请求头 | `value`、`log` | 执行受信任 Python |
| `POST /api/web-render/capture` | `url` 或 `html`、尺寸、动作 | `image_url` 和页面信息 | Chromium 截图 |
| `/api/io/*` | 见 [I/O 指南](IO_GUIDE.md) | 会话、数据、设备桥接 | 依接口而定 |
| `/api/local-ai/*` | 见 [本地模型接口与安装](LOCAL_AI.md) | 环境、权重、GPU 队列、生成结果、Comfy API 工作流 | 手动启动本地下载或推理 |
| `/api/providers`、`/api/ai/*`、`/api/chat` | 见 [AI 文档](AI_API.md) | 服务配置、生成结果、对话命令 | 调用外部服务可能计费 |

`POST /api/commands` 返回的是计算得到的修改结果，不会直接改磁盘工程。自动化程序需要再调用 `POST /api/projects` 保存。HTTP 保存同一用户项目 ID 会更新该工程；案例原件 ID 会返回新项目 ID，原件保持不变。后续请求必须使用保存返回的 ID；没有版本号冲突合并机制，避免两个编辑器同时写同一个工程。

## 3. 创建、校验、保存一个最小工程

工程格式版本 `version` 当前固定为 `1`，与软件版本 `0.4` 不是同一个数字。`id` 使用字母、数字、`_`、`-`，首字符必须为字母或数字，最多 96 字符。同一层网络内的节点和连接 ID 必须唯一。

以下工程把常量 `3` 送入乘法节点，得到 `6`。保存示例文件：

```bash
cat > .cache/api-guide/project.json <<'JSON'
{
  "id": "api_guide_demo",
  "name": "API 入门：3 乘 2",
  "version": 1,
  "nodes": [
    {
      "id": "value1",
      "type": "constant",
      "position": {"x": 80, "y": 120},
      "data": {"label": "输入数值", "params": {"value": 3}}
    },
    {
      "id": "multiply1",
      "type": "math",
      "position": {"x": 360, "y": 120},
      "data": {"label": "乘以二", "params": {"operation": "multiply", "value": 2}}
    }
  ],
  "edges": [
    {"id": "edge1", "source": "value1", "sourceHandle": "out", "target": "multiply1", "targetHandle": "in"}
  ],
  "settings": {}
}
JSON

curl --fail-with-body "$TD_BASE/api/validate" \
  -H 'Content-Type: application/json' \
  --data-binary @.cache/api-guide/project.json

curl --fail-with-body "$TD_BASE/api/projects" \
  -H 'Content-Type: application/json' \
  --data-binary @.cache/api-guide/project.json

curl --fail-with-body "$TD_BASE/api/projects/api_guide_demo"
```

校验成功的响应形状为 `{"valid":true,"errors":[],"project":{...}}`。`project` 包含服务端补全的参数默认值，后续应使用它。校验返回 HTTP 200 也可能有 `valid:false`；不要只检查 HTTP 状态。字段类型、大小或整体树限制错误可能直接返回 HTTP 422。

打开 TD Open 的作品列表即可找到这个工程。`settings` 保存播放、预览和界面等设置；普通调用者可以先留空。不要往节点参数或工程设置里放 API Key，这些字段属于可导出的工程内容。

## 4. 用 Python 编辑、计算并保存

项目的虚拟环境已包含 `httpx`。以下完整示例读取上一节文件，修改常量为 `4`，计算得到 `8`，最后保存：

```bash
.venv/bin/python - <<'PY'
import json
import os
from pathlib import Path
import httpx

base = os.environ.get("TD_BASE", "http://127.0.0.1:8765")
project = json.loads(Path(".cache/api-guide/project.json").read_text())
with httpx.Client(base_url=base, timeout=30) as client:
    response = client.post("/api/commands", json={
        "project": project,
        "commands": [
            {"op": "set_param", "id": "value1", "key": "value", "value": 4},
            {"op": "rename_project", "name": "API 入门：4 乘 2"}
        ]
    })
    response.raise_for_status()
    project = response.json()["project"]

    response = client.post("/api/evaluate", json={"project": project, "time": 0})
    response.raise_for_status()
    result = response.json()
    if result["errors"]:
        raise RuntimeError(result["errors"])
    print(result["values"]["multiply1"])  # 8.0

    response = client.post("/api/projects", json=project)
    response.raise_for_status()
    print("已保存：", response.json()["id"])
PY
```

这个工程的计算响应为：

```json
{
  "values": {"value1": 4.0, "multiply1": 8.0},
  "errors": {},
  "skipped": [],
  "skip_reasons": {},
  "time": 0.0
}
```

`/api/evaluate` 不是全功能离屏渲染接口。它计算后端支持的数值、文本、表格及无状态多通道节点；图像、几何、设备音频、连续帧状态通常需要打开浏览器工作台。AI、MCP 和 Python 脚本不会因为调用此接口就自动执行。始终检查 `skipped` 和 `skip_reasons`；例如看到“上游节点需要浏览器实时运行环境”表示该分支不能通过这个接口求值。

## 5. 节点目录、参数和正确端口

显示名称如“常量”用于界面搜索，API 使用 `type:"constant"`。同名节点可能分属不同家族，因此要读取目录，而不是猜测类型名称。

```bash
curl --fail-with-body "$TD_BASE/api/catalog" -o .cache/api-guide/catalog.json
.venv/bin/python - <<'PY'
import json
from pathlib import Path
catalog = json.loads(Path(".cache/api-guide/catalog.json").read_text())
node = next(item for item in catalog["nodes"] if item["type"] == "math")
print(json.dumps(node, ensure_ascii=False, indent=2))
PY
```

主要字段：`type` 是节点类型；`params` 说明字段类型、选项和范围；`defaults` 是默认值；`inputs` / `outputs` 列出端口的 `id` 与 `kind`；`runtime` 说明主要执行环境；`reference` 描述与参考节点的覆盖关系。`reference.level="bridge"` 表示外部适配入口，不能据此认为原生驱动已经安装。

连接使用 `sourceHandle` 和 `targetHandle`，不是端口序号或屏幕上的标签。以 `math` 为例，输出是 `out`，两个输入是 `in` 和 `in2`。在缺省句柄时服务会尝试补全，但自动化脚本最好明确指定，以免连到错误的输入。

## 6. 命令结构与组件内部编辑

一个请求最多 200 条命令。命令按顺序在副本上执行，最后整体校验；只要失败，就不会返回一个可保存的半成品。命令接口本身不保存，也不启动设备或付费任务。

| `op` | 必要字段 / 示例 | 作用 |
|---|---|---|
| `add_node` | `type`、可选 `id`、`params`、`position` | 添加节点并填默认参数 |
| `set_param` | `id`、`key`、`value` | 修改一个参数 |
| `update_node` | `id`，加 `params` / `label` / `position` | 批量更新节点 |
| `remove_node` / `delete_node` | `id` | 删除节点及关联连线 |
| `connect` | `source`、`target`、`sourceHandle`、`targetHandle`，可选连接 `id` | 添加连线 |
| `disconnect` | 连接的 `id` | 删除连线 |
| `rename_project` | `name` | 修改工程名称 |
| `set_playback` | `playing`、`speed` | 更新工程播放设置 |

添加并连接节点的 `commands` 示例：

```json
[
  {"op":"add_node","type":"constant","id":"a","params":{"value":3},"position":{"x":80,"y":120}},
  {"op":"add_node","type":"math","id":"b","params":{"operation":"multiply","value":2},"position":{"x":360,"y":120}},
  {"op":"connect","id":"a_to_b","source":"a","sourceHandle":"out","target":"b","targetHandle":"in"}
]
```

内部网络位于组件节点的 `data.graph`。编辑它时传入**完整根工程**，在每条命令上增加 `scope`，值为从根层到目标组件的节点 ID 数组；不要写成 `"/container1"` 字符串，也不要把节点显示名称当 ID。

```json
{
  "project":{"id":"scope_guide_demo","name":"嵌套组件示例","version":1,"nodes":[],"edges":[],"settings":{}},
  "commands":[
    {"op":"add_node","type":"base_comp","id":"container1"},
    {"op":"add_node","scope":["container1"],"type":"constant","id":"inside_value","params":{"value":7}},
    {"op":"add_node","scope":["container1"],"type":"network_out_chop","id":"inside_out","params":{"index":1}},
    {"op":"connect","scope":["container1"],"id":"inside_edge","source":"inside_value","sourceHandle":"out","target":"inside_out","targetHandle":"in"}
  ]
}
```

将上述对象作为 `/api/commands` 请求体，取返回的 `project` 保存。双击 `container1` 可在界面内查看内部网络。再修改内部值时使用：

```json
{"op":"set_param","scope":["container1"],"id":"inside_value","key":"value","value":8}
```

多层组件用 `scope:["container1","child1"]`。内部 In / Out 节点的 `index:1..4` 对应组件 `in` / `out`、`in2` / `out2` 等外部端口。普通连线的节点 ID 只在所属层级内解析，跨层连接应通过组件端口或支持路径选择的节点。整个工程树最多 5000 个节点、20000 条边、16 层内部网络；节点家族/端口不兼容或即时依赖成环会被拒绝。

## 7. 上传素材和保存导出文件

上传已有素材的字段名必须是 `file`。下面路径需要替换为你已经放在项目目录中的真实素材：

```bash
curl --fail-with-body "$TD_BASE/api/upload" \
  -F 'file=@data/input/example.png'
```

响应示例（文件名由服务端生成）：

```json
{"url":"/api/assets/0123456789abcdef0123456789abcdef.png","name":"example.png","kind":"image","size":12345}
```

返回的 `url` 是相对本地服务地址的路径。浏览器节点可以直接使用；其它程序拼成 `TD_BASE + url` 下载。它不是操作系统绝对文件路径，也不是 AI 服务商的公开上传地址。素材默认在 `data/assets/`。

当前接收扩展名：图片 PNG/JPG/JPEG/WebP/GIF/AVIF；视频 MP4/WebM/MOV；音频 MP3/WAV/OGG/M4A/FLAC；3D GLB/glTF/OBJ/STL/FBX。上传成功表示文件保存成功，实际解码仍取决于浏览器或模型加载器支持；例如 MOV 不保证所有内部编码都可播放。glTF 的外部纹理/缓冲文件需要另外安排可访问路径，初次使用优先上传自包含 GLB。

导出接口保存调用者已经生成的 PNG、WebM、JSON 或 WAV，**不会替你把工程渲染成这些格式**。以下例子把前面工程作为导出 JSON 保存：

```bash
curl --fail-with-body "$TD_BASE/api/artifacts" \
  -F 'file=@.cache/api-guide/project.json;type=application/json'
```

返回形如 `{"url":"/api/exports/<生成的文件名>.json","name":"project.json","size":...}`。使用这个返回的 URL 下载，导出文件默认保存在 `data/exports/`。上传和导出都限制单文件 100 MiB，空文件会被拒绝。普通 JSON API 的请求体上限为 8 MiB。

## 8. Python Script：申请令牌后手动运行

界面中的 Python Script 节点只有点击运行才执行；HTTP 调用也必须先申请运行意图令牌。它不是付费 AI API，也不需要模型密钥。

下面示例在 TD Open 使用的 Python 环境中执行 `cook(inputs, time)`：

```bash
.venv/bin/python - <<'PY'
import os
import httpx

with httpx.Client(base_url=os.environ.get("TD_BASE", "http://127.0.0.1:8765"), timeout=20) as client:
    response = client.post("/api/scripts/intent")
    response.raise_for_status()
    token = response.json()["token"]
    response = client.post(
        "/api/scripts/run",
        headers={"X-TD-Script-Intent": token},
        json={
            "code": "def cook(inputs, time):\n    print('processing')\n    return {'sum': inputs['a'] + inputs['b'], 'time': time}\n",
            "inputs": {"a": 2, "b": 3},
            "time": 1.25
        }
    )
    response.raise_for_status()
    print(response.json())
PY
```

结果为 `{"value":{"sum":5,"time":1.25},"log":"processing\n"}`。每次运行都要新令牌：有效期 30 秒、绑定申请时的本机客户端地址，使用后立即消耗，包括该次脚本随后报错的情况。不要把令牌保存到工程、URL 或代码仓库。

只有本机连接 `127.0.0.1` / `::1` 可以申请和使用令牌；服务从局域网访问并不会自动获得脚本执行权限。反向代理后端地址如何呈现会影响这项检查，不能把它当成多用户身份认证。

`cook` 必须存在并返回可序列化为有限 JSON 的值。HTTP 接口可以返回一般 JSON；放入节点图时，需要符合对应 CHOP/DAT/TOP/SOP 节点的数值、表格、图像或几何格式。不要返回 NumPy 对象本身、文件句柄、`NaN` 或无穷大。

脚本在当前用户权限下运行，能访问该用户可访问的文件和网络；这是受信任代码执行，**不是沙箱**。运行环境不继承 AI 密钥等一般环境变量，但脚本权限本身并未隔离。执行超时为 10 秒，最多同时运行 2 个脚本，输入 JSON 最大 6 MiB，进程 JSON 输出上限 8 MiB，日志保留末尾 10000 字符。源码和日志写入当前数据目录的 `scripts/`，导入第三方 Python 包时要先把依赖安装到启动 TD Open 的虚拟环境。

## 9. Web Render：把网页变成画面

`Web Render TOP` 和 `/api/web-render/capture` 使用真实 Chromium 截图。首次使用先按 [README 的 Web Render 安装步骤](../README.md) 安装 Playwright Chromium，或通过 `TD_CHROMIUM` 指向已有浏览器。启动脚本把默认浏览器缓存放在项目 `.cache/ms-playwright/`。

无需外网的最小示例：

```bash
curl --fail-with-body "$TD_BASE/api/web-render/capture" \
  -H 'Content-Type: application/json' \
  --data-binary '{"html":"<html><head><title>API Demo</title></head><body style=\"background:#14253d;color:white;font:48px sans-serif\">Hello TD Open</body></html>","width":640,"height":360,"delay":100,"actions":[]}'
```

响应包含 `title`、`url`、`width`、`height` 和 `image_url`。例如 `image_url` 为 `/api/exports/<随机文件名>.png`，可以下载或填入图像输入节点。`html` 与 `url` 同时提供时优先使用 `html`；HTML 模式的相对资源地址没有普通网页的站点上下文，资源宜用完整地址或内嵌数据。

网页交互使用顺序执行的 `actions`：

```json
{
  "html":"<title>表单演示</title><input id='name'><button id='go' onclick=\"document.body.dataset.done='yes'\">确定</button>",
  "width":800,
  "height":450,
  "delay":200,
  "actions":[
    {"type":"fill","selector":"#name","value":"TD Open"},
    {"type":"click","selector":"#go"},
    {"type":"scroll","x":0,"y":100}
  ]
}
```

`width` / `height` 范围为 16–2048；`delay` 为截图前等待的毫秒数，范围 0–3000；最多 32 个动作。`click` / `fill` 需要选择器，匹配多个元素时使用第一个。全任务超时 25 秒；不保留登录会话，不接受下载。自动加载的网页不能调用受保护的 TD Open API；本机 `/api/` 资源也受限制，公开的素材/导出图片 GET 除外。需要控制工程时直接调用本文的本地 HTTP API，不要让截图页面代发控制请求。

## 10. 本机权限、密钥与常见错误

目前服务适用于可信的本机开发。默认监听 `127.0.0.1`；一般 API 没有账户系统或通用访问令牌。浏览器写请求要求同源，但同源检查不等于认证，curl/Python 不受浏览器的同源机制保护。若自行改成 `0.0.0.0` 或部署到公网，需要由部署者配置真实的访问控制。

AI/MCP 连接中心的秘密配置保存在当前数据目录的 `config/`，文件限制为当前用户可读写，并被 Git 忽略；它们不是加密密钥库。查询连接只返回 `has_api_key` / `has_token` 等状态。更新连接时省略密钥或传 `null` 保留旧值，传空字符串才清除。相反，手动写进普通节点 `params` 的 HTTP Header、密码、URL 查询参数会随工程保存和导出。

| 现象 | 检查方法 |
|---|---|
| `Connection refused` | 先打开 `/api/health`；确认后端是否运行、端口是否一致、请求发自哪台机器 |
| HTTP 404 | 检查是否误把服务商地址当本地地址；项目 ID 和文件 URL 要使用接口返回值 |
| HTTP 403“仅允许同源浏览器请求” | 界面与 API 的 Host/端口不一致；使用同源部署或开发服务器代理，不要把 AI Key 当成解法 |
| HTTP 403“单次运行令牌” | 重新申请 `/api/scripts/intent`，30 秒内使用请求头运行一次；检查是否为本机连接 |
| HTTP 422 | 读取 `detail` 或 `errors`；常见原因是额外字段、拼错节点类型、端口不存在、类型不兼容、参数超范围、依赖成环 |
| 校验 HTTP 200 但没成功 | 检查响应 `valid`，使用返回的补全工程 |
| 计算结果缺少某节点 | 查看 `errors`、`skipped`、`skip_reasons`；浏览器专用节点不会被后端完整渲染 |
| 命令返回成功，重开作品没变化 | 取 `response.project` 再提交 `/api/projects` 保存 |
| HTTP 413 / 415 | 分别检查数据大小和扩展名/内容类型；大媒体走上传，不通过 I/O 的 1 MiB 数据通道 |
| Web Render 报 Chromium 失败 | 安装项目匹配的 Playwright Chromium，检查 `TD_CHROMIUM`、字体/系统依赖和页面动作选择器 |
| 保存文件后找不到 | 看 `/api/health` 的 `data_dir`，确认是否启动了隔离实例 |

二次开发时可直接阅读 [`backend/main.py`](../backend/main.py)、[`backend/models.py`](../backend/models.py)、[`backend/graph.py`](../backend/graph.py)、[`backend/script_runtime.py`](../backend/script_runtime.py) 和 [`backend/web_runtime.py`](../backend/web_runtime.py)。本页的 API 行为来自这些本地实现；触及第三方服务时，以其自身文档和 [AI API 指南](AI_API.md) 为准。

## 案例原件与编辑副本

内置案例来自 `examples/*.tdopen.json`，本机已生成案例的固定原件在 `data/examples/`。前端打开案例时只做预览，首次编辑后自动保存到 `data/projects/`；两个浏览器会得到不同的项目 ID。新项目通过 `settings.source_example_id` 记录来源，节点与内部引用保持不变。个人项目再次编辑时更新同一个 ID。

直接使用 HTTP / MCP 保存案例 ID 也会自动返回独立的新工程。不要继续重复提交原案例 ID；应保存并使用响应中的新 ID。即使请求删除 `settings.is_example` 标记，服务器也会根据案例存储位置保护原件。案例原件的删除请求返回错误。
