# AI 服务接入：文本、图片、音乐与 3D

本指南对应 TD Open 0.4。目标是让你能从供应商文档找到信息、在连接中心填对字段、发出第一次请求，并把结果接到节点网络。模型 ID 与参数由你的供应商决定，本文不指定“所有账号都能用”的模型，也不内置 API Key。

其他方向：[接入总览](API_GUIDE.md)、[MCP 双向接入](MCP_GUIDE.md)、[本地 HTTP API](HTTP_API.md)、[设备与协议](IO_GUIDE.md)。

## 引用节点与图片转平面点云

在创作助手中输入 `@`，用中文名称、节点类型或 ID 搜索当前网络的节点。上下键选择、Enter / Tab 插入，Esc 关闭，也可以点击候选项。也可以输入 `@` 后直接点击画布中的目标节点，引用会插入当前光标位置，并自动回到对话输入框；输入下一次 `@` 可继续点选其他节点。Esc 取消当前引用选择。插入的是唯一 `@节点ID`，上方标签显示对应名称，避免同名节点混淆。可以同时引用多个节点，每次最多 12 个；组件内部节点需先进入该组件网络。

输入框支持 **↑ 调取上一条已发送内容、↓ 调取较新内容并返回原草稿**，范围是当前会话中你发送的消息，不包含助手回复。未发送的草稿会保留；候选列表展开时方向键用于选择节点。多行输入在首行按 ↑ 开始调取历史，在末行按 ↓ 返回；进入历史浏览后可连续按方向键翻阅。Shift+Enter 换行。

发送时，助手获得引用节点与选中节点的完整参数（含默认值）、端口定义、实际连线，以及浏览器当前运行的输入输出摘要。摘要包含图片尺寸和粗略像素统计、点云实际点数 / 面数 / 全量坐标包围盒 / 少量坐标样本、信号样本或表格片段、当前执行错误。没有运行过的节点明确标记 `not_cooked`，没有连线的输入标记 `unconnected`。

这不是视觉识图功能：不会将整张图片或全部点坐标传给语言模型；模型看到的是统计和样本。它不能仅凭统计判断图片是什么图案，也不能访问本机任意文件。当前请求携带当前工程及这些摘要，不发送聊天历史；提问时请明确引用节点。文字、表格和信号只发送有限片段。没有配置模型时，输入 `@节点ID 查看参数和输入输出` 可以显示本地快照，但自由规划工作流仍需语言模型。

### 五角星图片：通过计算变成平面点云

从「示例作品」搜索「星图」，打开 **星图 · 图片变成平面点云**。它直接读取仓库附带的黑底白色五角星 PNG，无需安装模型、下载权重或配置 AI 服务。也可以在第一个「图片 / 视频」节点导入自己的图片，缩放方式选 `contain`，避免裁掉星角。

链路：**图片 / 视频 → 图片转平面点云 → 平面点云正视图 → 画面输出**。

| 设置 | 作用 |
| --- | --- |
| `mask=bright` | 亮色五角星、深色背景；默认亮度阈值 0.5 |
| `mask=dark` | 深色五角星、白色背景 |
| `mask=alpha` | 按透明度取前景，仅适合有透明背景的图片；不透明图片会选中整张矩形 |
| `region=fill` / `outline` | 填满星形内部 / 只保留边界像素 |
| `resolution` | 最长边采样数，8–512；越高点越密。保留输入 TOP 的宽高比 |
| `width` | 整张输入图的平面宽度；点位置在 XY 平面，Z 始终为 0 |
| `view_width`、`point_size` | 正视图的视野宽度和点半径；只改变显示，不改变点坐标 |
| `source_color` | 正视图使用采样出的原图颜色；关闭后使用统一点颜色 |

先引用自己的图片节点，再发送：

> @media_1 这是一张黑底白色五角星图片。请通过节点计算变成填满内部的五角星平面点云，Z=0，最长边采样 200。不要重新生图或生成三维模型，不改原图。用金色小点显示，接到已有输出。

检查提案后点击「应用修改」。随后引用新点云节点和正视图节点，要求读取点数、Z 最小最大值及输入输出尺寸。`@media_1` 是附带案例的图片 ID，自己的工程请从候选列表选择实际节点。

此前失败的原因：`trace_sop` 生成像素边界线段，没有三角面；`model_to_pointcloud_sop` 必须从网格三角面采样，因此不能直接接轮廓线。`raster_sop` 则把整幅图片转为矩形高度场，也不会自动去除背景。新 `image_to_pointcloud_sop` 按像素前景直接生成点，不经过三维模型；同时改善了助手中文节点检索，并提供相关节点的参数和端口说明。

实测使用 DeepSeek 官方连接完成提案、应用和只读查询。内置 PNG 在最长边 200 时得到 **2653 个点**；浏览器逐点验证全部落在原图采样前景内，Z 全部为 0，正视图输出 960×540。效果见下图。不同图片或阈值会产生不同点数。复杂照片需要先用已有图像处理节点获得遮罩；这次功能没有自动语义抠图。

![直接由 PNG 像素采样得到的五角星点阵](images/star-pointcloud.png)

### HTTP 接入与复测

`POST /api/chat` 在原有 `message`、`project`、`provider_id`、`selected_node` 外支持：

```json
{
  "mentioned_nodes": ["media_1"],
  "node_runtime": [{
    "id": "media_1",
    "inputs": {},
    "outputs": {"out": {"kind": "image", "width": 640, "height": 360}},
    "error": null
  }]
}
```

上例是附加字段片段，需要与现有请求合并。`node_runtime` 是前端采集的快照；后端不会代替浏览器运行 WebGL 或解码图片。后端校验引用 ID、端口和摘要大小，并从工程本身读取参数与连线；无法引用已删除或其他网络中的节点。服务端不将摘要当成执行权限，所有修改仍由命令白名单和图校验约束。

开发者可运行 `npm --prefix frontend test` 和 `.venv/bin/python -m pytest`。真实浏览器检查脚本：`frontend/browser-assistant-mentions.mjs`（需 `TD_LIVE_AI=1`，使用已保存的服务，调用官方 API，会消耗用量）与 `frontend/browser-star-raster.mjs`（无需 AI 请求，检查实际 PNG→点云→画面，导出 PLY 和缩略图）。均在项目根目录执行；前者要求隔离测试服务，默认端口 8782，浏览器路径通过 `TD_CHROMIUM` 指定，配置方式参见下方已有 DeepSeek 实测步骤。

## 先选正确的接入方式

| 你的接口是什么 | 协议选择 | 生成类型 | 本项目当前做什么 |
| --- | --- | --- | --- |
| 兼容 `POST /chat/completions` | OpenAI 兼容 | 语言 / 对话 | 发送 `model`、`messages`、`stream:false`，读取文本 |
| 兼容 `POST /images/generations` | OpenAI 兼容 | 图片 | 发送模型与提示词，读取图片 URL 或 base64 |
| 自定义 JSON 文本/图片服务 | 自定义 HTTP | 语言 / 对话或图片 | 按请求路径和 JSON 模板发送 POST |
| 音乐生成接口 | 自定义 HTTP | 音乐 | 接收音频 URL/base64，或报告异步任务 ID |
| 3D 生成接口 | 自定义 HTTP | 3D 模型 | 接收模型 URL/base64，或报告异步任务 ID |
| 只提供 MCP 工具 | MCP 连接页 | 不填在 AI 服务页 | 参照 MCP 文档发现并调用工具 |
| WebSocket、流式 SSE、multipart 上传、非 Bearer 签名或直接返回二进制 | 需要适配服务/开发适配器 | 按输出类型设置 | 当前通用 AI 请求器仅接受 HTTP POST → JSON 响应 |

“OpenAI 兼容”描述的是接口格式，不代表必须使用 OpenAI。也不表示供应商只要声称支持 OpenAI，就一定支持聊天和图片这两个路径。当前适配器没有直接调用 `/responses`、图片编辑、音频转写或流式生成接口。

## 连接中心每个字段怎么填

点击左侧“连接”或顶部插头图标，在 **AI 服务** 页填写：

| 界面字段 | API 字段 | 填法与常见误区 |
| --- | --- | --- |
| 服务名称 | `name` | 自己能认出的名称，例如“工作用文本”“音乐测试” |
| 协议 | `kind` | `openai` 或 `http`；音乐和 3D 选 `http` |
| 生成类型 | `capability` | `text` / `image` / `music` / `3d`；必须与运行节点一致 |
| 模型名称 | `model` | 供应商给出的精确模型 ID，不是自己起的展示名称 |
| API 基础地址 | `base_url` | 包含版本前缀的 API 根地址，不含具体生成路径 |
| API Key | `api_key` | 只填密钥本体，不要重复写 `Bearer `；本地免认证服务可空 |
| 请求路径（HTTP） | `path` | 以 `/` 开头，例如 `/generate/music`；不能填完整 URL、查询参数或 `..` |
| 请求体模板（HTTP） | `body_template` | 合法 JSON 对象；键名照供应商文档，变量规则见后文 |
| 已保存连接的 ID | `id` | 系统生成，显示在连接列表；程序调用时使用它，不是服务名称或模型名 |

同一供应商既做语言又做图片时，分别创建两条连接。画布中“服务 ID”的下拉选项按节点能力筛选；列表为空时先检查是否保存了相同生成类型的连接。

保存连接只做配置校验，不会消耗额度探测接口。选中已有 AI 连接后可修改配置；界面 API Key 留空会保留原密钥。**直接调用 API** 时则是：省略 `api_key` 或传 `null` 保留；显式 `""` 清除。密钥不会出现在 `GET /api/providers` 返回值，只有 `has_api_key` 标识。

### 地址是怎么拼出来的

程序把 `base_url` 去掉末尾 `/`，然后直接追加路径：

```text
https://api.openai.com/v1 + /chat/completions
→ https://api.openai.com/v1/chat/completions

https://image.example/api/v2 + /generate
→ https://image.example/api/v2/generate
```

因此不要把 `.../chat/completions` 整段填进基础地址，也不要指望程序自动补 `/v1`。`http://127.0.0.1:8765/api` 是 TD Open 自己的接口，不是模型服务地址。地址中不允许用户名、密码、查询参数或 `#fragment`；需要查询参数认证的供应商要增加适配层。

## 文本生成：从连接到结果

1. 在供应商控制台开通一个支持聊天补全的模型，取得 API Key、API 根地址和模型 ID。
2. 新建 AI 服务：协议“OpenAI 兼容”，生成类型“语言 / 对话”，填写其余字段并保存。
3. 节点库搜索“AI 文本”，添加节点并选中刚保存的服务。
4. 提示词先用“请用一句中文介绍节点式创作”，点击运行。
5. 成功后检查文字结果。需要把文字画到画面上时，连接 `AI 文本 → 文字画面 → 画面输出`，使用兼容的文本输入端口。
6. 若要让 AI 修改图，在右侧“创作助手”的模型选择中选这条语言连接；发送描述后预览命令，再点击应用。

以 OpenAI 自身为例，根地址是 `https://api.openai.com/v1`，API 使用 Bearer 认证，聊天接口是 `/chat/completions`。填你账号可用且支持该接口的模型 ID；不要把 ChatGPT 网页会话当作 API。依据：[官方认证说明](https://developers.openai.com/api/reference/overview)、[聊天接口参考](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)。

本地自托管的兼容服务也是相同步骤：根地址改为其实际监听地址（例如 `http://127.0.0.1:1234/v1`），模型名仍按服务端配置。这个端口只是示例，TD Open 不会自动启动模型，也不包含模型权重。

### DeepSeek 官方：已实测的创作助手连接

2026-10-14 使用官方接口验证了真实对话、改参、重命名、节点创建、端口连接、撤销 / 重做和自动保存。配置如下：

| 字段 | 填写内容 |
| --- | --- |
| 服务名称 | `DeepSeek 官方` |
| 协议 | `OpenAI 兼容` |
| 生成类型 | `语言 / 对话` |
| API 基础地址 | `https://api.deepseek.com` |
| 模型名称 | `deepseek-flash` |
| API Key | 自己账号的官方密钥，仅填入本机连接设置 |

程序实际请求 `https://api.deepseek.com/chat/completions`。本次认证后的 `GET /models` 返回 `deepseek-flash` 与 `deepseek-v4-pro`；验证使用前者。模型名称以你账号实时返回的列表为准，依据：[DeepSeek 官方接入说明](https://api-docs.deepseek.com/)。

保存后刷新工作台，在创作助手底部的**对话模型**选择 **DeepSeek 官方**。保持“本地指令模式”时不会请求 DeepSeek。选中噪声节点，可以发送：“将所选节点的流动速度改为 0.17、纹理尺度改为 4，并把作品重命名为夜色流光。”先检查返回的修改提案，再点击**应用修改**。仅对话不会改图；编辑案例会保存为独立项目，原件保留。

真实验收脚本为 `frontend/browser-live-assistant.mjs`，必须显式设置 `TD_LIVE_AI=1` 才会调用供应商，且仅接受项目内 `.cache/` 的隔离服务。先在隔离服务的连接设置中添加语言连接，然后运行：

```bash
TD_PORT=8782 TD_DATA_DIR=.cache/deepseek-chat-qa ./scripts/start.sh
# 另一终端；TD_PROVIDER_ID 使用隔离连接设置中的实际 ID
TD_LIVE_AI=1 TD_PROVIDER_ID=deepseek-official \
  TD_BASE_URL=http://127.0.0.1:8782 TD_CHROMIUM=/path/to/chromium \
  node frontend/browser-live-assistant.mjs
```

脚本会真实生成回复并保存隔离测试项目。密钥从后端配置读取，不要把密钥填入脚本、工作流 JSON 或上述命令。测试报告与截图保存到 `data/artifacts/`。

### 用 Python 安全保存一个连接

在项目根目录运行 `.venv/bin/python`，使用交互输入避免把真实密钥粘到代码或命令历史里：

```python
import getpass
import httpx

client = httpx.Client(base_url="http://127.0.0.1:8765", timeout=200)
config = {
    "id": "my-text",
    "name": "我的语言模型",
    "kind": "openai",
    "capability": "text",
    "base_url": input("API 根地址: ").strip(),
    "model": input("模型 ID: ").strip(),
    "api_key": getpass.getpass("API Key（免认证可留空）: "),
}
response = client.post("/api/providers", json=config)
response.raise_for_status()
print(response.json())  # 脱敏配置，不含原密钥
client.close()
```

保存后下面的请求会调用真实供应商，可能计费：

```bash
curl --fail-with-body http://127.0.0.1:8765/api/ai/generate \
  -H 'Content-Type: application/json' \
  -d '{"provider_id":"my-text","capability":"text","prompt":"请用一句中文介绍节点式创作"}'
```

成功响应的关键字段：

```json
{
  "provider_id": "my-text",
  "capability": "text",
  "text": "这里是服务实际返回的文本",
  "data": {"choices": [{"message": {"content": "这里是服务实际返回的文本"}}]}
}
```

`data` 是归一化/脱敏后的供应商响应，具体字段因服务不同而变化。直接调用 `/api/ai/generate` **只返回结果，不会自动修改任何画布节点**；界面“运行节点”会把返回值写入当前节点。脚本调用要更新作品时，另用 `/api/commands` 与保存接口。

## 图片生成：URL 与 base64 两种结果

1. 新建一条“图片”能力连接；兼容 Images API 的服务选“OpenAI 兼容”。
2. 添加“AI 图片”节点，选服务并填写提示词。
3. 点击运行，收到图片后连接 `AI 图片 → 色彩调整 / 合成 → 画面输出`。
4. 返回的是 URL 时，浏览器直接加载它；返回 base64 时，后端保存为本地素材并返回 `/api/assets/...`。

兼容路径是 `POST /images/generations`，图片模型、尺寸、质量等支持项以服务商及具体模型为准。OpenAI 的官方接口参考有请求和 base64 响应示例：[Images API](https://developers.openai.com/api/reference/resources/images/methods/generate)。

下面假设已保存 `id: my-image`、`capability: image` 的连接：

```bash
curl --fail-with-body http://127.0.0.1:8765/api/ai/generate \
  -H 'Content-Type: application/json' \
  -d '{
    "provider_id":"my-image",
    "capability":"image",
    "prompt":"抽象紫色玻璃雕塑，深色背景",
    "parameters":{"size":"1024x1024"}
  }'
```

这里的 `size` 只是示例，服务若不接受该字段请移除或改成其支持值。当前画布 AI 节点的运行按钮只发送服务 ID、生成类型和提示词；**没有通用额外参数表单**。需要图片尺寸、质量、时长等额外参数，可用上述本地 API 的 `parameters`，或用 HTTP 模板写固定值。

供应商可以返回下面任意一种常见结构：

```json
{"data":[{"url":"https://cdn.example/result.png"}]}
```

```json
{"data":[{"b64_json":"替换为完整且有效的图片base64"}]}
```

示例域名和字符串不是实际素材。后端校验媒体头、类型和大小，不会把错误文本当作图片保存。远程链接过期或不允许 CORS 时，重新取得可访问链接，或自行下载文件再通过界面“导入素材”上传；程序没有自动下载所有远程链接的功能。

## 音乐生成：接自定义 JSON 服务

音乐 API 没有统一字段。先从供应商文档找到一个实际的生成请求，例如：

```text
POST https://music.example/api/generate
Authorization: Bearer 密钥
Content-Type: application/json
```

```json
{
  "model": "服务商的音乐模型ID",
  "input": {"prompt": "轻柔钢琴与环境雨声", "duration_seconds": 15}
}
```

那么连接应填为：

| 字段 | 值 |
| --- | --- |
| 协议 | 自定义 HTTP |
| 生成类型 | 音乐 |
| API 基础地址 | `https://music.example/api`（换成真实供应商） |
| 请求路径 | `/generate` |
| 模型名称 | 供应商模型 ID |
| API Key | 供应商密钥本体 |
| 请求体模板 | 下面的 JSON |

```json
{
  "model": "{{model}}",
  "input": {
    "prompt": "{{prompt}}",
    "duration_seconds": 15
  }
}
```

保存后添加“AI 音乐”，选这条服务，填写风格/乐器/长度要求，点击运行。如果供应商同步返回：

```json
{"output":{"audio_url":"https://cdn.example/generated.wav"}}
```

节点会保存识别出的结果 URL。点击参数面板中的音频播放按钮后，音量/频谱才能驱动画面；可将 AI 音乐的 CHOP 输出接粒子或图像节点的调制输入。需要原始多通道 PCM 时，把结果 URL 填入 Audio File In 节点，再接滤波、频谱、播放或 WAV 导出。

音乐生成不等于语音朗读、转写或识别接口。如果服务只返回裸 WAV/MP3 字节，当前 JSON 适配器会报“未返回有效 JSON”；需让一个小型适配服务保存字节并返回音频 URL，或转成带 MIME 的 base64。

## 3D 生成：返回模型而不是缩略图

用“自定义 HTTP”新建 `3d` 连接。假设供应商的请求格式如下，则按它写模板；不是所有 3D 服务都接受这个格式：

```json
{
  "model": "{{model}}",
  "input": {
    "prompt": "{{prompt}}",
    "format": "glb"
  }
}
```

添加“AI 三维”节点，选择服务后手动运行。拿到模型后接：

```text
AI 三维（SOP） → 3D 渲染（Render TOP） → 画面输出
```

相对稳妥的交换资源是自包含 GLB：几何、材质和贴图在一个文件中，减少外部纹理丢失。当前加载器还支持符合条件的 glTF、OBJ、FBX，但具体资产能否正确显示取决于加载器、外部资源、格式内容和 CORS，文件扩展名不是完整兼容保证。

后端识别模型字段，并优先取模型而非预览图，例如：

```json
{
  "result": {
    "model_urls": {"glb": "https://cdn.example/result.glb"},
    "thumbnail_url": "https://cdn.example/preview.png"
  }
}
```

`url` 正确却没有模型时，先用浏览器或下载工具确认它返回的是模型文件，而不是登录页、任务 JSON 或 HTML 分享页，再检查外部贴图地址与浏览器控制台。API 请求成功只说明收到了响应，不保证第三方模型数据一定可渲染。

## 请求体模板的完整规则

模板必须是 **JSON 对象**。变量只能使用下面四个：

| 变量 | 来源 | 常用位置 |
| --- | --- | --- |
| `{{prompt}}` | 节点提示词或生成请求的 `prompt` | 提示词字符串 |
| `{{model}}` | 请求覆盖的 `model`，否则连接配置的模型 | 模型 ID |
| `{{parameters}}` | 本地 API 请求的 `parameters` 对象，未传为 `{}` | 参数/选项对象 |
| `{{capability}}` | `text` / `image` / `music` / `3d` | 服务的路由字段 |

整个 JSON 值刚好是占位符时保留原类型。例如：

```json
{"input":{"prompt":"{{prompt}}"},"options":"{{parameters}}"}
```

请求的 `parameters` 为 `{"duration":30,"seed":7}` 时，上游收到：

```json
{"input":{"prompt":"你的提示词"},"options":{"duration":30,"seed":7}}
```

嵌在长字符串中则做文本替换，例如 `"请画：{{prompt}}"`。**不支持** `{{parameters.duration}}`、环境变量、条件判断、JSONPath、Python 或 JavaScript 表达式；未识别的占位符不会自动取值。也不能用模板配置 HTTP 头、切换请求方法或映射返回字段。

连接中心会发送你输入的模板。直接用配置 API 省略模板或传 `null` 时，默认请求体为 `parameters` 加 `prompt`、`model`；其中后两个使用实际请求值。空对象 `{}` 则是明确要求向供应商发送空 JSON，不等同于省略模板。

### 固定参数和动态参数怎么选

- 日常在画布按钮中运行：把供应商需要的时长、格式、采样步数等固定参数写进模板。
- 用 Python/curl 批量生成：通过本地 `/api/ai/generate` 的 `parameters` 传递对象，模板用完整的 `{{parameters}}` 放到供应商规定的对象位置。
- 供应商要求动态字段平铺在顶层时，可通过配置 API 省略模板使用默认合并；界面目前没有“省略模板”开关。
- 特殊认证、文件上传、复杂参数转换或任务查询：用适配服务处理，不要把密钥写进模板。

## 认证、超时和配置更新

通用请求由后端发起，使用 `Content-Type: application/json`，有密钥时加 `Authorization: Bearer <key>`。不支持在界面添加 `X-API-Key`、Cookie、签名、组织头或自定义认证头；需要这些认证时，在自己的适配服务里完成。模板中的 `api_key`、`token`、`password` 等凭证字段会被配置校验拒绝。

AI 上游连接超时为 15 秒，HTTPX 请求读写等默认超时为 180 秒；这不是端到端生成时长承诺。浏览器关闭、请求超时或你取消等待，并不保证远端供应商取消了计费任务。程序不会自动重试生成，确认任务状态后再重发。

同 ID 保存是覆盖配置，不是只改一个字段的 PATCH。用 API 更新时先读取脱敏配置，移除 `has_api_key` 后保留其他有效字段，再写回；省略密钥可保留原值。下面只改连接显示名称：

```python
import httpx

with httpx.Client(base_url="http://127.0.0.1:8765") as client:
    response = client.get("/api/providers")
    response.raise_for_status()
    rows = response.json()
    item = next(row for row in rows if row["id"] == "my-text")
    item.pop("has_api_key", None)
    item["name"] = "重命名后的语言模型"
    response = client.post("/api/providers", json=item)
    response.raise_for_status()
    print(response.json())
```

不要把列表接口的 `has_api_key` 原样发回去：配置模型拒绝未声明字段。当前没有删除连接的 API/界面按钮；不用的连接可不再选择，轮换密钥通过更新同 ID 配置完成。

## 返回 JSON 怎样被识别

| 结果类型 | 可识别的典型字段 |
| --- | --- |
| 文本 | `choices[0].message.content`、`text`、`output_text`、`reply`；部分 `data/output/result/response/content` 嵌套 |
| 图片 | `data[].url`、`image_url`、`b64_json`、`image_base64` |
| 音频 | `audio_url`、`audioUrl`、`audio_base64` |
| 模型 | `model_url`、`model_urls.glb`、`model_base64` |
| 多个媒体 | 常见嵌套对象/数组；本地结果的 `url` 为第一项，多项时另有 `urls` |
| 任务 | `task_id`、`job_id`、`request_id`、`id` 与常见状态字段 |

有 `url` 或 `text` 表示解析到了结果；正常成功响应**不保证带 `status: success`**。`data` 里的大段 base64 会被替换为本地 URL，密钥类字段会脱敏。任何供应商任意字段都能识别并不是本版本的承诺。

内嵌媒体会落入 `data/assets`，支持 PNG/JPEG/WebP/GIF、WAV/MP3/OGG/FLAC 与 GLB，并校验真实文件头。单次返回资源总量限制为 100 MB。仅返回远程 HTTP URL 时不会自动归档；到期链接需要自行换成永久链接或下载后导入。内嵌音频最好带明确 MIME：

```json
{"audio_base64":"完整音频base64","mime_type":"audio/wav"}
```

## 异步任务：提交成功不等于生成完成

供应商若返回：

```json
{"task_id":"job-123","status":"processing"}
```

TD Open 会返回类似：

```json
{
  "provider_id":"my-music",
  "capability":"music",
  "data":{"task_id":"job-123","status":"processing"},
  "status":"submitted",
  "task_id":"job-123",
  "message":"服务返回了异步任务，尚未取得媒体地址；请在供应商侧查询任务结果。"
}
```

**本版没有通用自动轮询、Webhook、任务取消、进度条或任务队列。** 应按该供应商文档查询任务；拿到最终图片/音频/模型 URL 后，填入对应节点的“生成资源地址”（`result_url`），或下载媒体后导入。

需要一键完成时，可在你自己的适配服务里：提交任务 → 等待/查询 → 返回标准结果 JSON。适配器需考虑请求时限，长任务不要无限阻塞；本项目文档不把这层转换当作已经内置。

供应商返回 200 但含 `error` 或 `FAILED` 等失败状态时，本地会报错。无媒体也无明确任务时，通用 HTTP 适配器返回 `status: unrecognized`；兼容图片适配器则直接报缺少图片。不能把 HTTP 200 当作模型成功。

## 对话操作节点是怎样工作的

在创作助手里选择语言连接后，程序向语言模型发送当前图、节点索引和一部分相关参数说明，要求返回 `reply` 与 `commands`。允许命令为添加、改参、删除、连接、断开、重命名，每次最多 40 条；命令经过图校验后供用户预览和应用。

没有选择模型时为明确标注的“本地指令模式”，支持按节点中文名、英文名或类型 ID 添加，以及有限的颜色/速度/删除操作；它不是离线大模型。

语言模型的普通自由文本回答可以用于“AI 文本”节点，但图编辑助手要求特定 JSON 格式。能聊天不等于能稳定返回图命令。“模型未返回可用的图编辑 JSON”时可换用更遵循结构要求的模型或简化请求。

助手不会自行执行 Python、运行生成节点、调用外部 MCP 或保存供应商配置。通过外部 AI 调用 TD Open 的工具，请阅读 [MCP 双向接入](MCP_GUIDE.md)。

## 无需密钥的本地接入演练

仓库提供一个**明确的模拟服务**：文字为回显说明，图片为程序色块，音频为正弦波，3D 为测试三角形。它只用于验证连接和媒体处理，不调用模型、不联网、不收费。

在项目根目录开第一个终端：

```bash
cd /storage/homes/hongzj/dell/td_open
.venv/bin/python examples/api/mock_provider.py --port 9010
```

在第二个终端启动隔离 TD Open，避免把练习连接混入自己的配置：

```bash
cd /storage/homes/hongzj/dell/td_open
TD_PORT=8766 TD_DATA_DIR=.cache/api-guide-demo ./scripts/start.sh
```

第三个终端导入四条练习连接：

```bash
curl --fail-with-body http://127.0.0.1:8766/api/providers -H 'Content-Type: application/json' --data-binary @examples/api/demo-text.provider.json
curl --fail-with-body http://127.0.0.1:8766/api/providers -H 'Content-Type: application/json' --data-binary @examples/api/demo-image.provider.json
curl --fail-with-body http://127.0.0.1:8766/api/providers -H 'Content-Type: application/json' --data-binary @examples/api/demo-music.provider.json
curl --fail-with-body http://127.0.0.1:8766/api/providers -H 'Content-Type: application/json' --data-binary @examples/api/demo-3d.provider.json
```

打开 `http://127.0.0.1:8766`，分别添加四种 AI 节点、选择带“演练”字样的连接，然后运行。也可先用 curl 测试图片：

```bash
curl --fail-with-body http://127.0.0.1:8766/api/ai/generate \
  -H 'Content-Type: application/json' \
  -d '{"provider_id":"demo-image","capability":"image","prompt":"连接测试"}'
```

应返回以 `/api/assets/` 开头的 `url`；将它加在 **8766** 根地址后可以读取素材。请求成功后再换成自己的真实服务配置。演练服务端口、模型 ID、返回内容均不是供应商 API 的承诺；结束时在相应终端按 Ctrl+C 停止。

## 常见错误对照

| 现象 / 错误 | 检查与处理 |
| --- | --- |
| 服务下拉框为空 | 保存连接、关闭重开连接中心；确认节点能力与连接生成类型一致 |
| 未找到连接配置 | `provider_id` 填连接 ID，不能填展示名称或模型名；迁移作品后需在新机器重建连接 |
| 音乐/3D 要使用 HTTP | 将协议改为自定义 HTTP，按供应商格式填模板 |
| 能力与生成类型不匹配 | text/image/music/3d 必须前后一致 |
| 请填写模型名称 | 兼容协议要求精确模型 ID；自定义 HTTP 是否需要模型由服务商决定 |
| 上游 HTTP 401 / 403 | 核对密钥、模型授权、账号权限；确认没有把 `Bearer ` 一起填入 Key |
| 上游 HTTP 404 | 检查拼接后的实际 URL，是否重复路径或缺少 `/v1` |
| 上游 HTTP 400 / 422 | 核对模型、参数名、类型及合法枚举；删掉服务不接受的额外参数 |
| 上游 HTTP 429 | 检查供应商额度/限流；根据供应商说明稍后重试，避免重复提交任务 |
| 本地 HTTP 502 | 可能是上游 HTTP 错误、网络错误、失败状态或 JSON 结构不符；看本地 `detail` 提示 |
| 本地 HTTP 504 | 上游超时；先查供应商任务状态，再决定重试或改异步接法 |
| 未返回有效 JSON | 可能请求到网页、重定向、SSE 或裸音频；使用 JSON 接口/适配服务 |
| 模板保存失败 | 不能有单引号键、注释、尾逗号；顶层必须是对象；不得包含密钥字段 |
| `submitted` | 已识别异步任务，但尚无媒体；按服务商文档查询，不要当成成功图片 |
| `unrecognized` | 返回结构不在识别范围，检查原始 `data`，适配为常见 URL 字段 |
| 有 URL 但图片/模型不显示 | 检查过期/登录权限/资源类型/CORS/外部贴图及浏览器侧网络可达性 |
| 音乐不响 | 点击播放授权；核对浏览器音频输出、有效音频格式和URL；自动播放失败不影响保存节点 |
| 模型只返回预览图 | 要取真实 `.glb` 等模型 URL，不能使用缩略图或分享页 |
| 已保存但依然不能访问 | 保存没有测试外部连接；从运行 TD Open 的服务器验证网络和端口 |

本项目不会在错误信息里回显供应商可能泄露密钥的原始错误体。需要更详细诊断时使用供应商控制台日志；分享截图、请求样例或日志前移除密钥与私人提示词。

## 二次开发者从哪里扩展

AI 适配逻辑在 `backend/integrations.py`：`ProviderConfig` 约束配置，`render_template` 做纯数据替换，`generate_with_provider` 拼接请求，`post_json` 负责 HTTP，`media_urls` / `persist_returned_media` 识别并保存媒体。节点界面请求在 `frontend/src/App.tsx` 的 `runNode`。

一个独立适配服务可以保留供应商专有认证与异步协议，只向 TD Open 暴露稳定的 `POST + JSON`：输入 `prompt/model/options`，输出 `text`、`image_url`、`audio_url` 或 `model_url`。这样其他开发者无需把每一家供应商逻辑塞进节点引擎。

当前验证覆盖请求/返回格式、密钥保留与脱敏、真实本地 HTTP、媒体保存、错误和图命令，并已实测 DeepSeek 官方语言接口及创作助手完整流程；其他供应商账号、模型和计费生成需分别验证。本文官方引用用于接口规范核对，本地功能范围仍以项目代码与测试为准。
