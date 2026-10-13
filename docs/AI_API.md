# AI 与 MCP 接入

TD Open 的 AI 调用由本地 Python 后端发起。没有配置服务时，画布和本地指令仍可使用；生成接口会明确报错，不会用演示结果冒充生成成功。音乐与 3D 使用可配置的 HTTP JSON 适配器，需要供应商提供真实接口。

## 保存连接

在连接中心填写服务，或向 `POST /api/providers` 发送：

```json
{
  "id": "my-language-model",
  "name": "我的语言模型",
  "kind": "openai",
  "base_url": "http://localhost:1234/v1",
  "api_key": "",
  "model": "your-model-id",
  "capability": "text"
}
```

`kind` 为 `openai` 或 `http`；`capability` 为 `text`、`image`、`music`、`3d`。同一个服务需要多种能力时，分别创建连接。模型名称由用户填写，没有绑定某个厂商或付费模型。

`base_url` 是 API 根地址。例如 OpenAI 兼容服务通常以 `/v1` 结尾。兼容适配器会追加 `/chat/completions` 或 `/images/generations`，不会自动补充 `/v1`。图片接口同时识别 URL 与 `b64_json`。这些路径和 JSON 字段依据 [OpenAI 官方 Chat API](https://developers.openai.com/api/reference/resources/chat) 与 [Images API](https://developers.openai.com/api/reference/resources/images)。模型、参数和账户权限仍由所接服务决定。

连接默认保存到 `data/config/providers.json`，MCP 连接保存到 `data/config/mcp_servers.json`；设置 `TD_DATA_DIR` 时使用该数据目录下的 `config/`。目录权限为 `0700`，文件权限为 `0600`；默认目录及 `.cache/` 下的测试目录已排除在 Git 之外。密钥不会写入项目 JSON，也不会返回给浏览器。`GET /api/providers` 返回连接的非敏感配置与 `has_api_key` 状态，不返回密钥值。更新连接时省略 `api_key` 或传 `null` 会保留旧密钥；明确传空字符串会清除密钥。MCP `token` 具有相同语义。

密钥采用本地文件权限保护，并非加密保险库。地址不能包含账号、密码或查询参数，认证统一使用 `Authorization: Bearer …`。供应商要求其他认证方式时，应扩展适配器。

## 通用音乐、3D 与自定义接口

例如供应商接收 `POST /generate`，提示词位于 `input.prompt`：

```json
{
  "id": "music-http",
  "name": "音乐生成服务",
  "kind": "http",
  "base_url": "https://your-provider.example/api",
  "api_key": "YOUR_SERVER_SIDE_KEY",
  "model": "your-music-model",
  "capability": "music",
  "path": "/generate",
  "body_template": {
    "model": "{{model}}",
    "input": {"prompt": "{{prompt}}"},
    "options": "{{parameters}}"
  }
}
```

占位符支持 `{{prompt}}`、`{{model}}`、`{{parameters}}`、`{{capability}}`。整个值为占位符时保留数据类型，因此 `"{{parameters}}"` 会替换为 JSON 对象。模板只做数据替换，不运行表达式、Python、Shell 或读取环境变量。省略模板时，默认请求体是 `parameters` 与 `prompt`、`model` 的合并对象。

生成请求：

```json
{
  "provider_id": "music-http",
  "capability": "music",
  "prompt": "舒缓的环境音乐，轻柔钢琴与雨声",
  "parameters": {"duration": 30}
}
```

发送到 `POST /api/ai/generate`。返回含 `provider_id`、`capability`、响应元数据 `data`，以及可识别的 `text` 或 `url`。媒体解析支持常见的 `data` / `output` / `result` 嵌套结构、URL 数组、`image_url` / `audio_url` / `audioUrl` / `model_url`，以及 `model_urls.glb` 等格式。3D 结果优先识别模型文件，不把缩略图当作模型；多个可识别结果另存于 `urls` 数组。

通用 HTTP 媒体服务若只返回任务编号或处理中状态，则返回 `status: "submitted"`、可识别的 `task_id` 与说明。没有可识别媒体或任务的通用响应返回 `status: "unrecognized"`，不会冒充生成成功。OpenAI 兼容图片接口缺少可用图片时直接报错。即使 HTTP 为 200，响应中的 `error` 或 `FAILED` 等失败状态也会被报告为错误。

内嵌 `b64_json`、`image_base64`、`audio_base64`、`model_base64` 与媒体 data URL 会保存到本地 `data/assets`，返回 `/api/assets/<随机名称>.<后缀>`。响应元数据会用本地 URL 替换 base64，避免项目文件膨胀。保存前检查 MIME 类型、文件头与大小；单次返回资源总量最多 100 MB，支持 PNG/JPEG/WebP/GIF、WAV/MP3/OGG/FLAC 与 GLB。相同内容在一次请求中只写一份，批次保存失败会清理该批次已写入的文件。

当前没有自动轮询、Webhook、供应商任务取消或远程 URL 自动下载。调用者需查询供应商异步任务结果，再将媒体 URL 用于节点。远程 URL 是否允许浏览器跨域访问，也由供应商决定。上传 multipart、非 JSON 音频流与自定义签名认证需要独立适配器。

## 对话编辑图

`POST /api/chat` 接收：

```json
{
  "message": "把噪声速度调成 0.5",
  "selected_node": "noise_1",
  "project": {"id": "demo", "name": "Demo", "nodes": [], "edges": []},
  "provider_id": "my-language-model"
}
```

这里的 `project` 应当传入编辑器当前完整项目；示例仅展示请求结构。`provider_id` 可省略。

无连接时返回 `mode: "local"`，采用明确标注的本地规则解析：添加噪声/粒子/渐变/模糊/几何/文本/LFO、调整颜色/速度、删除所选节点。颜色调整器通过色相参数改变输入画面，不能保证输出成为纯蓝色；回复会说明这一点。

配置语言模型后返回 `mode: "ai"`。模型获得算子、参数和端口说明，返回 `reply` 与 `commands`。后端验证允许的图操作、节点类型、参数名、节点引用和图结构。支持的 `op` 为 `add_node`、`set_param`、`remove_node`、`connect`、`disconnect`、`rename_project`。每次最多 40 条命令。

对话接口只提出更改，**不会自行保存项目、执行代码或调用远程 MCP 工具**。编辑器显示命令后，由用户应用；图命令接口为 `POST /api/commands`，请求体 `{project, commands}`。

## 连接外部 MCP 服务

`POST /api/mcp/servers` 保存：

```json
{
  "id": "my-tools",
  "name": "我的工具服务",
  "url": "http://127.0.0.1:9000/mcp",
  "token": "",
  "allowed_tools": ["search_assets", "generate_texture"]
}
```

服务须支持 Streamable HTTP。`allowed_tools` 可省略，此时可手动调用服务列出的工具；空数组表示不允许任何工具。当前仅支持无认证或 Bearer Token，没有 OAuth 登录流程。

`GET /api/mcp/servers` 返回脱敏连接；`POST /api/mcp/servers/{id}/tools` 发现工具。手动调用使用 `POST /api/mcp/call`：

```json
{"server_id": "my-tools", "name": "search_assets", "arguments": {"query": "cloud"}}
```

调用前检查工具是否由服务提供、是否在允许列表中。工具会在远程服务执行，具体副作用取决于工具本身；本地聊天不会自动触发调用。返回保留 MCP `content`、`isError` 与结构化字段。每个请求执行初始化、工具发现/调用与会话关闭；目前不跨请求保留会话状态。

实现使用官方 Python SDK `mcp==1.30.0`，遵循 [官方 v1 客户端生命周期](https://py.sdk.modelcontextprotocol.io/v1/client/)，由 SDK 协商协议版本。没有声称支持全部 MCP 功能。尚未接入旧 SSE、客户端 stdio 配置、OAuth、采样、资源订阅、提示词与持久化远程任务。

## 从外部 AI 客户端控制 TD Open

本项目也提供 MCP stdio 服务。先启动 TD Open 的 HTTP 后端，再在支持 MCP 的客户端中添加：

```json
{
  "mcpServers": {
    "td-open": {
      "command": "/storage/homes/hongzj/dell/td_open/.venv/bin/python",
      "args": ["-m", "backend.mcp_server"],
      "cwd": "/storage/homes/hongzj/dell/td_open",
      "env": {"TD_OPEN_APP_URL": "http://127.0.0.1:8765"}
    }
  }
}
```

不同客户端对 `cwd` 的支持不同；不支持时可使用客户端的工作目录设置，并确保 `backend` 包可导入。自行运行的命令为 `.venv/bin/python -m backend.mcp_server`，工作目录是仓库根目录。

服务基于 [官方 FastMCP](https://py.sdk.modelcontextprotocol.io/v1/server/)，暴露四个工具：

| 工具 | 作用 |
| --- | --- |
| `list_projects` | 列出已保存项目 |
| `get_project(project_id)` | 读取完整项目 |
| `list_operators` | 读取算子、参数与端口定义 |
| `apply_graph_commands(project_id, commands, apply=false)` | 验证并预览图编辑；`apply=true` 时保存 |

MCP 更改的是后端已保存的项目。浏览器在没有本地未保存修改时，每 4 秒检查外部更新并同步当前作品；有本地修改时不会覆盖编辑内容。也可从作品列表重新打开项目。当前没有多人协同锁或冲突合并机制，不应让多个客户端同时改同一个项目。

## 验证范围

测试覆盖密钥脱敏与文件权限、真实 HTTP 请求格式（MockTransport）、语言/图片/通用音乐与 3D 响应解析、内嵌媒体保存与 HTTP 读取、资源类型/大小校验、异步任务返回、失败响应、本地解析与 AI 命令校验。MCP 测试既包含会话模拟与工具允许列表，也启动真实 stdio 子进程验证握手和工具发现；另启动本机 Streamable HTTP 服务验证 Bearer 认证、发现、实际调用、工具错误和 DELETE 会话清理。测试不请求付费模型。由于未配置用户供应商账号，远程音乐、3D 和图片生成尚未进行付费服务端到端验收。
