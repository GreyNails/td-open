# MCP 接入与 AI 对话操作教程

文档导航：[接入总览](API_GUIDE.md) · [AI API](AI_API.md) · [本地 HTTP API](HTTP_API.md) · [设备与协议](IO_GUIDE.md)

本文对应 TD Open 0.4 的实际实现。MCP 有两个独立接入方向，可以只配置其中一个：

| 你要完成的事 | 在哪里配置 | TD Open 当前支持 |
| --- | --- | --- |
| 在画布中调用素材搜索、数据库查询、自建生成服务等外部工具 | TD Open 的「连接 AI 与 MCP → MCP 连接」 | 连接外部 **Streamable HTTP** MCP 服务，发现工具并手动执行 |
| 在外部 AI 客户端中说话，让 AI 添加节点、连线、改参数 | 外部客户端的 MCP 设置 | 客户端启动 TD Open 的 **stdio** MCP 服务，通过 4 个图编辑工具读取和修改已保存作品；另有 4 个本地模型工具 |

```text
方向一：从 TD Open 调用外部工具
MCP 工具节点 → 本地 REST API → TD Open Python 后端 → Streamable HTTP → 外部 MCP 服务

方向二：让外部 AI 操作 TD Open
外部 AI 客户端 → stdio → backend.mcp_server → 本地 REST API → TD Open Python 后端
```

MCP 的 `stdio` 由客户端启动子进程，通过标准输入、输出通信；Streamable HTTP 连接一个已经运行的 HTTP 服务。这是两种不同的传输方式，不能把 `python -m ...` 或传统 `/sse` 地址直接填进当前连接中心。协议定义见 [MCP 官方传输规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)。

普通 AI API 的 Key、模型名和生成接口配置见 [AI API 接入教程](AI_API.md)。MCP 不要求你把模型 Key 再填一遍；这里的 Token 是**工具服务本身**要求的访问凭证。

## 1. 开始前：确认 TD Open 后端可访问

在仓库根目录启动 TD Open：

```bash
cd /storage/homes/hongzj/dell/td_open
bash scripts/start.sh
```

若已经运行，不需要再次启动。在另一个终端检查：

```bash
curl --fail-with-body http://127.0.0.1:8765/api/health
```

返回中应有 `"status":"ok"`。下面所有 `8765` 都指 TD Open 后端；外部示例 MCP 服务使用 `9000`，二者不是同一个端口。仓库换位置时，把命令和客户端配置中的绝对路径一并替换。

## 2. 把外部 MCP 服务接到 TD Open

### 2.1 向工具提供方取得哪些信息

需要准备：

1. **完整的 Streamable HTTP 端点**，例如 `https://tools.example.com/mcp`，不是网站首页。
2. **Bearer Token**，如果该服务无需认证则留空。填原始 Token，不要再写 `Bearer ` 前缀。
3. 你要调用的工具的准确 `name`，以及它的 `inputSchema`。可以先连接，再通过「发现工具」读取。

当前连接器支持无认证和静态 Bearer Token。OAuth 网页登录、自定义认证头、API Key 查询参数、旧 HTTP+SSE 和直接启动外部 stdio 进程，均未接入这个界面。如果提供方只提供这些方式，需要使用它提供的兼容端点或自行实现适配服务。

### 2.2 在连接中心逐项填写

打开顶部插头按钮「连接 AI 与 MCP」，切换到「MCP 连接」。以本机工具服务为例：

| 界面字段 | 示例 | 说明 |
| --- | --- | --- |
| 服务名称 | `本地素材工具` | 方便自己识别的显示名，不需要与远端服务名称一致 |
| 服务 ID | `local-tools` | 节点引用这个 ID；使用字母、数字、下划线、短横线，最长 80 字符 |
| Streamable HTTP 地址 | `http://127.0.0.1:9000/mcp` | 填完整端点；地址从 **TD Open 后端所在机器**访问 |
| Bearer Token（可选） | 无认证时留空 | 后端会加上 `Authorization: Bearer <Token>` |
| 工具权限 | `仅允许指定工具` | 也可选「不限制工具」或「禁止全部工具」；三者含义见 2.5 |
| 允许的工具名称 | `echo` | 选择「仅允许指定工具」后出现；多个名字用逗号、中文逗号或换行分隔 |

点击「保存连接」，然后在上方已保存服务旁点击「发现工具」。应看到 JSON 列表，包含工具的 `name`、`description` 和 `inputSchema`。工具参数使用 `inputSchema.properties` 中的字段名，必须提供 `required` 列出的必填项；数字、布尔值和数组应保持 JSON 类型。这些字段的协议含义见 [MCP 官方工具规范](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)。

保存后，表单停留在这条连接的编辑状态，可以从「服务 ID」字段复制 ID。要修改已有连接，点击上方该连接的编辑按钮；其 ID 只读，名称、地址和工具权限可以更新。要添加另一条连接，点击「新增连接」。

编辑已有连接时，Token 输入框留空表示保留已保存的 Token；填写新值则替换，保存后输入框会再次清空，界面显示是否「已保存 Token」。当前界面没有清除凭证按钮，确实要移除旧 Token 时使用 2.5 所述 API，明确发送 `"token":""`。

### 2.3 把工具放进节点图

假设发现结果里有：

```json
{
  "name": "echo",
  "description": "Return the supplied message.",
  "inputSchema": {
    "type": "object",
    "properties": {"message": {"type": "string"}},
    "required": ["message"]
  }
}
```

1. 在节点搜索里查找 `MCP 工具`，添加节点。
2. 选中节点，在参数面板填写：

   | 节点字段 | 填写值 | 对应 HTTP 请求字段 |
   | --- | --- | --- |
   | 服务器 ID | `local-tools` | `server_id` |
   | 工具名称 | `echo` | `name`；项目 JSON 中参数键为 `tool` |
   | 参数 JSON | `{"message":"你好，TD Open"}` | `arguments` 对象 |

3. 点击「运行工具」。参数 JSON 必须是对象，使用双引号；不是 Python 字典，也不要填 Markdown 代码围栏。
4. 成功后在节点的结果区域查看返回内容。连接 `MCP 工具 → 文字画面 → 画面输出`，可把结果文本绘制到画面。

工具节点不会随每一帧重新请求，也不会由播放按钮自动触发；每次请求都需要点击「运行工具」。`mcp_tool` 没有输入端口，当前参数来自面板内的 JSON，不会自动把另一个节点的内容插入 `arguments`。

HTTP 接口保留 MCP 的 `content`、`structuredContent`、`isError` 等返回字段。当前节点主要把 `content` 序列化为结果文本，并输出 DAT 字符串；界面保存的结果文本最多 20,000 字符。它不会自动把 MCP 图片、音频、资源链接解包成对应媒体节点，也不会自动下载 `resource_link`。需要准确解析结构化结果时，使用下一节的 HTTP 接口；需要生成媒体时也可使用 [AI API 适配器](AI_API.md)。

### 2.4 用 HTTP API 保存连接、发现和调用

以下命令使用一个**无需认证**的本机服务，示例不会请求付费模型。先启动第 3 节示例服务，或替换为你已经运行的服务。

保存连接：

```bash
curl --fail-with-body -X POST http://127.0.0.1:8765/api/mcp/servers \
  -H 'Content-Type: application/json' \
  --data '{"id":"local-tools","name":"本地素材工具","url":"http://127.0.0.1:9000/mcp","token":"","allowed_tools":["echo"]}'
```

查看已保存服务：

```bash
curl --fail-with-body http://127.0.0.1:8765/api/mcp/servers
```

发现工具：

```bash
curl --fail-with-body -X POST \
  http://127.0.0.1:8765/api/mcp/servers/local-tools/tools
```

手动调用：

```bash
curl --fail-with-body -X POST http://127.0.0.1:8765/api/mcp/call \
  -H 'Content-Type: application/json' \
  --data '{"server_id":"local-tools","name":"echo","arguments":{"message":"你好，TD Open"}}'
```

成功响应中可包含：

```json
{
  "content": [{"type":"text","text":"{\"message\":\"你好，TD Open\"}"}],
  "structuredContent": {"message":"你好，TD Open"},
  "isError": false
}
```

具体的 `content` 格式由服务决定。HTTP 200 不一定代表工具成功：`isError: true` 表示工具执行失败，前端会显示错误；HTTP 客户端也应检查该字段。

### 2.5 完整配置字段与允许列表

`POST /api/mcp/servers` 接收以下字段，不接受额外字段：

| 字段 | 类型/默认值 | 规则 |
| --- | --- | --- |
| `id` | 字符串；省略时生成 | 1–80 个字母、数字、`_`、`-`；已有相同 ID 时更新该条 |
| `name` | 必填字符串 | 1–120 字符 |
| `url` | 必填字符串 | `http://` 或 `https://`；不能包含用户名、密码、查询参数或 `#fragment` |
| `token` | 字符串或 `null`；默认 `null` | 最长 8192 字符；省略或 `null` 保留该 ID 的旧 Token，`""` 明确清除 |
| `allowed_tools` | 字符串数组或 `null`；默认 `null` | 对应界面的「工具权限」；见下面区别 |

`allowed_tools` 的含义必须区分：

| 界面选择 | API 保存值 | 发现结果与可执行范围 |
| --- | --- | --- |
| 不限制工具 | `null`；API 省略字段也是此默认值 | 服务提供的全部工具都可发现、手动执行 |
| 禁止全部工具 | `[]` | 空列表，一个也不允许 |
| 仅允许指定工具 | `["echo", "search_assets"]` | 只显示并允许服务实际提供且在数组内的工具 |

选择「仅允许指定工具」时至少填一个名称；界面会去掉重复名称，并阻止保存空列表。要禁止所有工具，直接选择「禁止全部工具」。允许列表中的名字必须使用远端工具的准确 `name`，而不是说明文字。

调用前，后端先检查允许列表，再初始化 MCP 会话、发现工具、确认工具存在后调用；发现支持分页，最多 50 页。每次发现或调用都会创建并关闭会话，不跨请求保存远端会话状态。当前单次外层超时为 100 秒，不提供持续后台任务、任务恢复或自动重试。

通过 API 更新同一 ID 时，应提交完整的 `name`、`url` 和希望保留的 `allowed_tools`。与 Token 不同，**API 省略 `allowed_tools` 会重置为 `null`，不会保留旧允许列表**。连接中心编辑时会载入并提交已有的工具权限，空 Token 输入则省略 `token` 字段，因此普通界面编辑会保留旧凭证。

Token 只保存在后端 `data/config/mcp_servers.json`；设置 `TD_DATA_DIR` 时位于该目录的 `config/`。配置目录权限为 `0700`，文件为 `0600`，属于本地文件权限保护，并非加密存储。列表和保存响应只返回 `has_token`，不回传 Token；项目 JSON 中记录服务器 ID，不存放 Token。不要把密钥填进 `arguments` 或项目参数，因为这些值会随作品保存、导出。

## 3. 没有现成服务：运行一个最小 Python MCP 服务

项目已依赖官方 Python SDK `mcp==1.30.0`。以下示例使用同一虚拟环境，不调用模型或第三方 API。保存为仓库内的 `.cache/mcp-demo.py`（若目录不存在，先创建 `.cache/`）：

```python
from mcp.server.fastmcp import FastMCP

server = FastMCP(
    "TD Open Demo Tools",
    host="127.0.0.1",
    port=9000,
    json_response=True,
)


@server.tool()
def echo(message: str) -> dict[str, str]:
    """Return the supplied message."""
    return {"message": message}


if __name__ == "__main__":
    server.run(transport="streamable-http")
```

启动：

```bash
cd /storage/homes/hongzj/dell/td_open
.venv/bin/python .cache/mcp-demo.py
```

端点是 `http://127.0.0.1:9000/mcp`，Token 留空；再按第 2 节保存连接、发现和调用 `echo`。服务终端持续运行才可调用，结束时按 `Ctrl+C`。

可以在这个服务里添加自己的 `@server.tool()` 函数，调用数据库、模型或业务 API，并按函数参数生成工具输入说明。它是独立 Python 服务，函数实际执行权限与启动它的账户一致；这里的 `echo` 仅回传文字。SDK 的服务端与客户端用法见 [官方 Python SDK v1 文档](https://py.sdk.modelcontextprotocol.io/v1/)。

## 4. 把 TD Open 接到外部 AI 客户端

### 4.1 先明确哪些进程需要运行

这一方向的调用链是：

1. 你先启动 TD Open HTTP 后端，并在浏览器中保存作品。
2. 外部 AI 客户端按配置启动 `.venv/bin/python -m backend.mcp_server` 子进程。
3. 客户端通过 stdio 调用工具；子进程通过 `TD_OPEN_APP_URL` 访问 TD Open 后端。

`backend.mcp_server` 本身不启动网页、不监听 `/mcp` HTTP 端点，也不读取你的外部 MCP 连接列表。不要在 TD Open 连接中心填 `http://127.0.0.1:8765/mcp`，这个路由不存在。支持仅远程 HTTP MCP 的客户端，不能直接使用这套 stdio 配置。

### 4.2 通用客户端配置

在客户端的本地 MCP/工具服务设置中加入以下配置。不同客户端的配置文件位置、顶层键和启用方式不同；下面采用常见的 `mcpServers` 写法，按客户端文档调整。

```json
{
  "mcpServers": {
    "td-open": {
      "command": "/storage/homes/hongzj/dell/td_open/.venv/bin/python",
      "args": ["-m", "backend.mcp_server"],
      "cwd": "/storage/homes/hongzj/dell/td_open",
      "env": {
        "TD_OPEN_APP_URL": "http://127.0.0.1:8765"
      }
    }
  }
}
```

可复制的文件在 [examples/api/mcp-client.json.example](../examples/api/mcp-client.json.example)。它不含密钥。

| 字段 | 作用 |
| --- | --- |
| `command` | 项目虚拟环境 Python 的绝对路径，保证能导入 `mcp` 和项目依赖 |
| `args` | 使用模块方式启动 `backend.mcp_server`，保持数组中的两个独立参数 |
| `cwd` | 仓库根目录，让 Python 找到 `backend` 包；有些客户端不支持此字段 |
| `env.TD_OPEN_APP_URL` | TD Open HTTP 后端根地址，不加 `/api`；默认 `http://127.0.0.1:8765` |

客户端不支持 `cwd` 时，可以删除 `cwd`，在 `env` 中加入 `"PYTHONPATH":"/storage/homes/hongzj/dell/td_open"`；另一种办法是在项目虚拟环境中完成 `pip install -e .` 后使用已安装的包。路径包含空格时，JSON 字符串原样保留，不要给 `command` 内再嵌套引号。Windows 原生 Python 路径通常改为 `.venv\\Scripts\\python.exe`；不要把 Linux 路径直接复制到 Windows 客户端本机执行。

保存配置后在客户端重新连接/启用服务，工具列表应包含以下 4 个图编辑工具，以及文末的 4 个本地模型工具（共 8 个）。如果你在终端手动运行 stdio 命令，它等待协议输入且不显示网页是正常现象；交互通常由客户端完成。不要在服务标准输出中添加日志，因为该通道用于 MCP 消息。

### 4.3 四个工具的参数和返回值

| 工具 | 参数 | 返回内容/副作用 |
| --- | --- | --- |
| `list_projects` | `{}` | 已保存作品列表，包括 `id`、`name`、`version`、`node_count`、`edge_count`、`updated_at`；只读 |
| `get_project` | `{"project_id":"作品ID"}` | 完整项目，含 `nodes`、`edges`、`settings` 和组件的 `data.graph`；只读 |
| `list_operators` | `{}` | `nodes` 和 `families`；节点说明含类型、默认参数、参数定义和输入输出端口；只读 |
| `apply_graph_commands` | `project_id`、`commands`；可选 `apply`，默认 `false` | 返回 `applied`、修改后的完整 `project`、`message`；仅 `apply: true` 时写入已保存作品 |

`project_id` 从 `list_projects` 复制，不要使用作品标题。必须指向已存在的作品；这 4 个工具没有“新建作品”工具，先在界面新建并保存即可。工具调用使用 MCP 的普通 JSON 参数，客户端负责协议封装，不需要把 `/api/...` URL 当成工具名。

`apply_graph_commands` 每批最多 100 条命令，整批在副本上校验；发生错误时不保存这一批。预览不是锁定的事务：再次以 `apply: true` 调用时，会重新读取当前已保存项目并应用命令，因此两次调用之间如果别人修改了作品，应重新读取和检查。

编辑案例原件并应用时，服务自动创建独立项目，原件不变。使用响应中的 `project.id` 继续编辑，并从工作台“我的作品”打开新项目；不要继续提交原件 ID，否则每次都会另建副本。只预览不会创建项目。

### 4.4 最小例子：预览，再保存两节点图

先在 TD Open 新建一个空白作品并保存，使用 `list_projects` 获取其 ID。以下 `your-project-id` 必须替换为实际 ID；如果图中已有这些节点 ID，请换一组未使用的 ID。

调用 `apply_graph_commands`，参数为：

```json
{
  "project_id": "your-project-id",
  "apply": false,
  "commands": [
    {"op":"add_node","type":"noise","id":"mcp_noise","params":{"speed":0.25},"position":{"x":80,"y":120}},
    {"op":"add_node","type":"output","id":"mcp_output","position":{"x":380,"y":120}},
    {"op":"connect","id":"mcp_edge","source":"mcp_noise","target":"mcp_output","sourceHandle":"out","targetHandle":"in"}
  ]
}
```

响应中的 `applied` 为 `false`，并包含预览项目，磁盘作品未改。确认这就是你需要的更改后，用**同一份参数**再次调用，只把 `apply` 改成 `true`。返回 `applied: true` 才代表保存完成；不要把预览回复当成已执行。

后续把噪声速度改为 `0.5`，可以调用：

```json
{
  "project_id": "your-project-id",
  "commands": [{"op":"set_param","id":"mcp_noise","key":"speed","value":0.5}],
  "apply": true
}
```

浏览器在当前作品没有本地未保存更改时，每 4 秒检查后端更新并同步；也可以从作品列表重新打开。服务修改的是已保存项目，不是浏览器选中节点或当前面板状态。当前没有多人锁或冲突合并机制。

### 4.5 可用图命令、端口与组件 scope

stdio 工具只允许下面 6 种 `op`：

| `op` | 必填字段 | 可选字段与行为 |
| --- | --- | --- |
| `add_node` | `type` | `id`、`label`、`params`、`position:{x,y}`；缺省 ID 自动生成，参数补上节点默认值 |
| `set_param` | `id`、`key`、`value` | 修改一个参数；参数名与类型以算子定义为准 |
| `remove_node` | `id` | 删除节点及本网络内关联连线 |
| `connect` | `source`、`target` | `id` 是新连线 ID；可指定 `sourceHandle`、`targetHandle`，建议显式使用算子端口 ID |
| `disconnect` | `id` | 这里是**连线 ID**，从 `get_project().edges` 查找 |
| `rename_project` | `name` | 修改作品名称；在 scope 内则修改内部网络名称 |

需要操作组件内部时，在每条命令上加 `scope`，例如 `"scope":["base1","child1"]`，依次进入这两个组件的 `data.graph`。`scope: []` 或省略表示根网络；数组最多 16 层。节点 ID 使用该层的局部 ID，不写 `/base1/child1/node` 路径。连线两端也必须在同一 scope，跨组件数据通过组件和 In/Out 节点转接。

以下命令在当前作品创建一个组件和内部噪声节点，再调整其速度：

```json
{
  "project_id": "your-project-id",
  "apply": false,
  "commands": [
    {"op":"add_node","type":"base_comp","id":"mcp_base"},
    {"op":"add_node","scope":["mcp_base"],"type":"noise","id":"inside_noise"},
    {"op":"set_param","scope":["mcp_base"],"id":"inside_noise","key":"speed","value":0.1}
  ]
}
```

这段只演示内部编辑，未配置组件输出；需要画面输出时还要添加内部 Out 和外层 Output。`base_comp`、`engine_comp`、`container_comp`、`widget_comp`、`time_comp`、`replicator_comp` 通过 `add_node` 创建时会自动带空内部网络。

`update_node`、`set_playback`、执行 Python、调用云端生成 API、执行远端 MCP、导出图片、修改连接凭证等，都不在这 4 个 MCP 工具的能力范围内。后端其他 HTTP 接口即便提供某些功能，也不意味着 stdio 服务已经暴露对应工具。

### 4.6 让 AI 通过对话操作

在已经连接 `td-open` 工具服务的外部 AI 客户端中，可以直接说：

> 使用 TD Open 工具，先列出作品，找到“我的练习”。读取作品和算子定义，在空白位置添加噪声并连接画面输出，把噪声速度设为 0.25。先用 apply=false 给我预览改动。

检查后再说：

> 按刚才这组命令应用到该作品，使用 apply=true 保存，然后重新读取确认。

AI 应先取得真实项目 ID、节点类型和端口，不依靠猜测。已经明确授权一次具体编辑时，也可以在最初请求中要求它读取、校验并保存；`apply` 的具体使用由你和客户端的工具权限设置决定。

TD Open **内部**的聊天面板是另一个入口：配置语言模型后，对话生成图编辑命令供你查看和应用。当前内部聊天不会自主发现或调用外部 MCP 工具，也不会自动点击 AI 生成节点。想“通过聊天调用外部素材工具，再操作 TD Open”，需要一个同时连接那些工具和 `td-open` 的外部 AI 客户端自行编排；本项目尚未提供内置的多工具 Agent 执行循环。

## 5. TD Open 在服务器上：远程与 SSH 接入

地址中的 `127.0.0.1` 永远指**发起该连接的进程所在机器**：

- 浏览器打开 TD Open，不代表外部 MCP 请求从浏览器发出；请求来自 TD Open Python 后端。
- 外部 AI 客户端的 stdio `command` 默认在客户端本机执行。电脑上的客户端不能直接运行服务器磁盘中的 Linux 路径。

### 5.1 用 SSH 在服务器上运行 stdio 服务

如果客户端支持通过 `command` 启动 SSH，可以使用下面的通用配置。把 `user@your-server` 和仓库路径换成真实值，并先在终端确认 SSH 已可正常登录。

```json
{
  "mcpServers": {
    "td-open-remote": {
      "command": "ssh",
      "args": [
        "-T",
        "user@your-server",
        "cd /storage/homes/hongzj/dell/td_open && exec env TD_OPEN_APP_URL=http://127.0.0.1:8765 .venv/bin/python -m backend.mcp_server"
      ]
    }
  }
}
```

此时 stdio 子进程和 HTTP 后端都在服务器上，后端可以继续监听服务器的 `127.0.0.1`。SSH 使用已有的密钥/代理配置，不在 MCP JSON 里填写 SSH 密码。`-T` 不分配终端，避免控制字符混入协议；远端 shell 启动文件也不应向标准输出打印欢迎语。

### 5.2 用 SSH 转发 HTTP 后端

另一种方式是本机已经有一份 TD Open 代码与依赖，在本机运行 stdio 服务，通过隧道连接服务器后端：

```bash
ssh -N -L 18765:127.0.0.1:8765 user@your-server
```

保持隧道终端运行，将本机 MCP 配置的 `TD_OPEN_APP_URL` 改为 `http://127.0.0.1:18765`，而 `command`/`cwd` 改为本机代码路径。这不是把服务器路径直接拿到本机执行。

TD Open 的这些项目/连接管理 HTTP 接口没有内置登录鉴权。远程访问可用 SSH 隧道；若自行公开部署，需要你在部署层配置访问控制。当前 stdio 包装器不提供向后端追加自定义认证头的配置项。

## 6. 常见问题排查

| 现象 | 检查与处理 |
| --- | --- |
| 「未找到连接配置」或 404 | 节点 `server_id` 必须等于已保存服务 ID；先调用 `GET /api/mcp/servers` 核对 |
| 发现结果为空 | 检查是否保存了 `allowed_tools: []`；也可能允许列表中的名字没有被服务提供 |
| 「此工具不在该连接的允许列表中」或 403 | 修改允许列表，使用发现结果里的准确 `name`，大小写保持一致 |
| 「MCP 服务未提供该工具」或 404 | 工具名称已改、拼写错误，或连接到了另一台服务；重新发现工具 |
| 连接/调用失败，返回 502 | 确认完整 `/mcp` 端点、服务支持 Streamable HTTP、Token 未多写 `Bearer `、参数符合 schema；OAuth 或旧 SSE 不能直接使用 |
| 「MCP 服务请求超时」或 504 | 远端在本次 100 秒期限内没有完成；长任务需服务先返回任务 ID，再显式调用其查询工具，本项目不自动轮询 |
| HTTP 200 但 `isError: true` | 已到达 MCP 服务，但工具执行失败；读 `content` 中的错误，再检查业务参数、权限和服务日志 |
| 节点提示 JSON 解析失败或 HTTP 422 | `arguments` 必须是 JSON 对象：键和文字用双引号；不要传数组、`null`、单引号字典或尾逗号 |
| 保存 URL 时 HTTP 422 | URL 必须为 HTTP(S)，不能含 URL 用户名/密码、查询参数或片段；凭证放 Token 字段 |
| 通过 API 重存连接后突然需要认证 | API 明确发送 `"token":""` 会清除旧值；省略 `token` 或传 `null` 才保留。界面编辑时留空会省略该字段 |
| stdio 启动报 `No module named backend` | 使用仓库根目录 `cwd`，或配置正确 `PYTHONPATH`/安装本项目；确认 `command` 指向项目虚拟环境 |
| stdio 启动报 `No module named mcp` | 项目依赖未安装到这个 Python 环境；从仓库根目录运行 `.venv/bin/python -m pip install -e .` |
| 发现 8 个工具，但调用时 `Cannot reach TD Open` | stdio 握手本身不要求后端在线；启动后端，再核对 `TD_OPEN_APP_URL` 和远程地址含义 |
| 图命令报未知算子/端口或循环依赖 | 先读取 `list_operators` 和完整项目，使用准确的类型与端口 ID，检查 scope；失败批次不会保存 |
| AI 说改好了，浏览器没变化 | 查看返回是否 `applied: true`、项目 ID 是否正确；保存浏览器的本地更改，等待同步或重新打开作品 |
| 同一组添加命令第二次执行报 ID 已存在 | 第一次可能已经 `apply: true` 保存；先读项目确认，不要重复添加相同 ID |
| HTTP 接口正常，但 stdio 一直断开 | 检查客户端是否支持 stdio、是否支持 `cwd`、SSH 是否交互等待密码，以及标准输出是否被日志污染 |
| 发现工具正常，但连续操作没有共享上下文 | 每次 HTTP MCP 请求都会关闭会话；服务若要求持续会话，当前连接器不满足，应改为显式任务 ID/状态参数或扩展实现 |

## 7. 开发者入口与验证范围

| 文件 | 内容 |
| --- | --- |
| [backend/integrations.py](../backend/integrations.py) | `MCPConfig`、凭证保存/脱敏、外部服务初始化、分页发现、允许列表和调用 |
| [backend/mcp_server.py](../backend/mcp_server.py) | 提供给外部 AI 客户端的 8 个 stdio 工具 |
| [backend/graph.py](../backend/graph.py) | 图命令、组件 scope、原子校验 |
| [frontend/src/Settings.tsx](../frontend/src/Settings.tsx) | 连接中心表单和工具发现 |
| [frontend/src/App.tsx](../frontend/src/App.tsx) | 手动运行工具、结果写回、外部更改同步 |
| [tests/test_integrations.py](../tests/test_integrations.py) | 模拟会话、真实 stdio 握手、真实本机 Streamable HTTP 发现/调用/错误/关闭 |

协议概念已核对官方文档；本项目锁定的 SDK 版本是 `1.30.0`，接入能力以本页和本地实现为准，不能从某个较新协议的完整能力列表推断本项目已经支持。当前只集成工具发现和调用，没有 MCP 资源订阅、提示词浏览、采样、OAuth 登录、远程任务恢复或内部聊天自动调用外部工具。

本教程的最小 FastMCP 服务已在本机实际启动，发现、调用 `echo` 和结构化结果均已验证；stdio 配置也已通过真实子进程连接隔离的 TD Open 后端，完成 4 个工具调用、预览不落盘、应用保存和嵌套 scope 修改验证。示例不要求供应商账号。任何外部业务工具能否成功，仍取决于该服务的输入定义、认证和实际运行状态。


## 本地生成模型的 MCP 工具（0.5）

stdio 服务另外提供四个本地模型工具：`get_local_model_status` 查看显卡、环境、权重与实测记录；`run_local_model` 在用户明确要求生成时提交真实 GPU 任务；`get_local_model_job` 查询进度与全部资源 URL；`cancel_local_model_job` 取消指定任务。它们调用运行中的 TD Open 后端，不需要云端生成 API Key。

例如让 AI 依次执行：检查 `flux-klein-4b` 是否安装 → 调用 `run_local_model(profile_id="flux-klein-4b", parameters={"prompt":"A small ceramic robot","steps":4})` → 用返回的 32 位 job ID 查询结果 → 按用户要求通过图编辑工具把 `result_url` 写入本地生成节点并保存。查询任务时无需重复提交生成。八工具发现、本地 GPU 生成、结果下载与取消第二条排队任务已通过真实 stdio 会话验证，记录保存在 `data/artifacts/local-ai-mcp-live.json`。

运行工具不会自动覆盖工程；在编辑器存在未保存修改时，先保存作品再让外部 AI 更新。图片、遮罩或音频先由 `/api/upload` 上传，随后将工作台返回的 URL 放入 `inputs.image`、`inputs.mask` 或 `inputs.audio`。模型安装步骤见 [本地模型与 ComfyUI](LOCAL_AI.md)，全部接口见 [本地模型 API](LOCAL_AI.md#http-api-与二次开发)。
