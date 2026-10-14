# Alpha 验收记录

日期：2026-10-14。环境：Linux、Python 3.11、项目内 Node 22.21.1、Chromium 无头浏览器（软件 WebGL）。测试数据、报告、截图、缓存和导出保存在本项目内。自动测试使用本地模拟服务；DeepSeek 与本地模型的真实运行范围在下文注明。

## 画布点选引用与输入历史

`frontend/browser-assistant-input.mjs` 使用隔离后端和原生 Chromium 操作，通过 8 项检查：输入 @ 后点击画布节点、自动返回输入焦点；连续引用两节点并发送正确运行快照；上下键翻阅实际发送内容与边界处理；未发送草稿恢复；多行编辑和候选列表方向键优先；句中插入保留前后文字；Esc 取消及普通节点选择不改草稿；案例原件不变且无浏览器错误。测试使用本地只读对话，不调用付费 AI API。

报告和截图：`data/artifacts/assistant-input-report.json`、`assistant-input-interactions.png`。历史调取范围为当前会话，不持久化到浏览器刷新之后。

## @节点与五角星像素点云

新增 2 个节点、1 个无模型案例：静态目录 751 个节点、96 个案例（另有空白工程）。`frontend/browser-assistant-mentions.mjs` 使用真实 DeepSeek API，通过 6 项原生浏览器检查：中文 @ 搜索与键盘选择；发送原图运行信息并提出像素处理链路；应用后原图不变且图校验通过；第二次 @ 两个节点读回真实点数、Z 范围及尺寸；撤销 / 重做；内置案例原件不变。两次模型请求没有模拟或拦截。

独立 Chromium 引擎验证 `frontend/browser-star-raster.mjs`：原始五角星 PNG → 2653 个实际前景点 → 960×540 正视图，逐点核对原图采样前景，全部 Z=0，运行错误为零；导出 `data/artifacts/star-pointcloud.ply`。没有调用图片或三维生成模型。单元测试另覆盖深色前景、透明背景、轮廓采样、空遮罩、比例保留、歧义节点名、未计算状态和无效摘要拒绝。

报告：`data/artifacts/assistant-mentions-report.json`、`star-raster-validation.json`；真实界面：[截图](images/assistant-star-pointcloud.png)。使用方法见 [@节点与平面点云](AI_API.md#引用节点与图片转平面点云)。

## DeepSeek 官方创作助手实测

使用用户授权的官方密钥访问 `https://api.deepseek.com`：模型列表 HTTP 200，实际可用模型为 `deepseek-flash` 与 `deepseek-v4-pro`。本次选择 `deepseek-flash`；正式服务的只读对话 HTTP 200，正确解释现有节点链路并返回空命令，案例原件不变。

`frontend/browser-live-assistant.mjs` 在隔离数据目录使用真实后端与官方 API，未拦截或模拟 AI 请求，通过 6 项浏览器检查：密钥不进入浏览器响应；修改提案未经应用不会改图或保存；改参与重命名应用后保存独立项目；撤销 / 重做保留同一项目 ID；新建柔光节点并正确替换输入连接，通过图校验；刷新后保留实际创建的工作流。两次浏览器 AI 请求分别耗时 3.95 秒和 9.81 秒，仅代表本次实测，不是时延承诺。

报告：`data/artifacts/deepseek-models-check.json`、`deepseek-chat-readonly.json`、`deepseek-assistant-browser-report.json`；截图：`deepseek-assistant-live.png`。密钥仅存在本机权限为 `0600` 的后端配置文件，不包含在报告、截图或 Git 产物中。复现需显式授权真实请求，步骤见 [DeepSeek 接入说明](AI_API.md#deepseek-官方已实测的创作助手连接)。

## 案例保护、框选与端口修复

Python **351 项**、前端 **374 项**通过；TypeScript 与生产构建通过。HTTP / MCP 直接保存案例会返回新的项目 ID，原件不能被覆盖或删除；MCP 返回实际保存后的项目，后续操作可继续使用该 ID。

`frontend/browser-editor-fixes.mjs` 使用隔离数据目录和两个独立浏览器会话，通过 10 项实际操作检查：仅查看案例不创建项目；两位编辑者首次修改生成不同副本；后续修改与刷新继续同一副本；空白处左键框选；成组拖动；多选复制、删除和撤销；五输入节点所有端口位于卡片内；实际拖线到第五个输入后自动保存；18 条 SVG 连线的两端与实际端口贴合；整理后卡片无重叠、端点继续正确。原件 API 返回内容保持不变。

本机已有 9 个演示案例保存为只读原件，2 份此前的编辑保留为独立项目；旧工程文件的字节哈希保持不变。迁移记录：`data/artifacts/example-protection-migration.json`。浏览器报告：`data/artifacts/editor-fixes-browser-report.json`，截图：`editor-box-selection.png`、`editor-fixes-studio.png`。

受保护的真实“潮汐之像”案例另通过 8 项音乐回归：普通播放输出非零 PCM、静音为零、暂停与恢复、浏览器声音恢复、原始 WAV 试听、音量修改与四声部同步、带声音录像。播放本身不保存案例；修改音量创建项目副本，案例原件保持不变。报告：`data/artifacts/music-controls-browser-report.json`。

复现编辑检查使用隔离服务：`TD_BASE_URL=http://127.0.0.1:8780 TD_CHROMIUM=/path/to/chromium node frontend/browser-editor-fixes.mjs`。音乐检查使用 `frontend/browser-performance-audio.mjs`，需在隔离数据目录的 `examples/tidal_muse_ready.json` 放入已生成的案例，并将其中全部素材复制到该目录的 `assets/`，包括 JSON 字符串里记录的四声部 URL。不要对真实用户目录运行会编辑或保存工程的验收脚本。

## 0.5.1 四轨点云作品

自动测试：Python 348 项、前端 371 项通过；TypeScript 与生产构建通过。

新增 [潮汐之像案例](TIDAL_MUSE.md)，749 个静态节点、95 个案例（另有空白工程）。完整 16 节点网络通过实际工作界面的“生成整件作品”依次执行四个本地模型，未拦截生成请求，也未使用替代几何或假音频。

| 实际模型 | 耗时 | 实测显存峰值 |
| --- | ---: | ---: |
| flux-klein-4b | 8.58 秒 | 5274 MiB |
| hunyuan3d-21 | 104.55 秒 | 7588 MiB |
| ace-step-15 | 4.41 秒 | 8782 MiB |
| demucs-4 | 2.33 秒 | 3746 MiB |

本机 L40 单卡设置 24 GiB 预算；四个任务峰值均低于预算。真实 GLB 表面采样 28000 点；32 秒生成音乐由 Demucs 分离为四条可解码 WAV。独立关闭人声、鼓、贝斯、其他控制分别产生非零像素差异；共享音频时钟暂停保持冻结，恢复后继续推进。已验证在正式工作台打开保存工程、同步播放、回到起点、PLY 导出、带音轨 WebM 录制，以及内置案例文档。32 秒 MP4 按实际 PCM 时间线逐帧导出并合成原始音乐，不表示实时 24 fps 性能承诺。

验收报告保存在本机 `data/artifacts/tidal-muse-live-report.json`、`tidal-render-inspection.json`、`tidal-ready-browser-report.json`。ML 环境另运行 `scripts/validate-mesh-cleanup.py`，验证边界外壳、反向外壳、主体表面、独立立方体和空结果的处理。

## 音乐播放入口修复

案例预览区新增直接播放、音量、静音、真实输出电平和原始 WAV 试听入口。普通播放按钮与空格可首次启用案例音乐；麦克风输入与音乐输出控制独立。浏览器音频暂停时，界面显示真实状态，并提供显式恢复按钮。

`frontend/browser-performance-audio.mjs` 在隔离工程中使用实际保存的 WAV 和原生 AudioContext 验证 8 项：无需选中节点即可播放、普通播放启动音乐、WAV 试听、静音 / 取消静音、暂停 / 继续、浏览器声音恢复、与节点参数一致的音量控制、带音轨录像。直接读取音量之后的 PCM：播放电平非零、静音电平为零；录制文件含 48 kHz 双声道 Opus，均值约 -29 dB。此检查验证浏览器输出，不代表远程用户的扬声器状态已被检查。

本机报告：`data/artifacts/music-controls-browser-report.json`，截图：`music-controls-studio.png`，录像：`music-controls-recording.webm`。

## 0.5 本地模型与 ComfyUI

七组模型均通过真实工作台按钮执行，使用固定官方权重，无生成 API 拦截；另完成五组图像编辑与原生工作流实测。详见 [完整运行参数与显存记录](LOCAL_AI_VALIDATION.md)。输出检查覆盖 PNG 像素、WAV 采样、GLB 网格及 MP4 解码与运动。单张 L40 强制 24 GiB 预算，最高进程显存峰值 12.69 GiB；不等于实体游戏显卡测试。

- Python：346 项通过，含 95 份公开工程、下载续传、工作流编译与 MCP 八工具发现。
- 前端：365 项通过；TypeScript / Vite 构建通过。
- 案例渲染：94 个网络通过，不需要模型的实时案例实际渲染，本地模型案例提供明确的安装说明卡。
- MCP 实测：真实 stdio 发现八个工具，提交本地图片生成、获取资源并取消另一条排队任务，第一条生成正常完成。
- 文档：六篇应用内接入文档；模型与环境中心、JSON 导入和任务回写已在浏览器验证。
- 运行日志与实跑证据：`data/artifacts/local-ai-*`；源码约束和公共测量：`backend/local_ai/validation.json`。

## 0.4.1 接入文档与连接配置更新

增加五篇应用内接入文档、四种能力的本地演练服务与配置；修复 MCP 编辑时的 Token 保留和工具权限设置，并补齐 WAV 导出文件下载路径。2026-10-14 验证：

| 检查 | 结果 | 本地产物 |
| --- | --- | --- |
| Python 全量回归，含四份教程配置及 WAV 下载 | **313 项通过** | `data/artifacts/pytest-api-guide.xml` |
| 四份教程配置的真实 HTTP 请求 | **4/4 通过**：文字回声、PNG 像素、WAV 采样、GLB 结构及资源下载 | `data/artifacts/api-docs-runtime.json` |
| 前端全量回归 | **359 项通过** | `data/artifacts/frontend-tests-api-guide.json` |
| TypeScript 与生产构建 | 通过；文档单独延迟加载 | `data/artifacts/frontend-build-api-guide.log` |
| 文档中心与 MCP 设置真实浏览器检查 | **12 组通过**，包括中文锚点、复制、下载、五篇深链、390px 窄屏及三种工具权限 | `data/artifacts/api-guide-browser.json` |
| HTTP / I/O 文档与实际接口 | **47 项通过**，含 Chromium、真实回环协议、文件、WAV 与脚本授权令牌 | `.cache/api-guide/verification/result.json` |
| MCP 双向接入 | 真实 Streamable HTTP 发现和调用；stdio 四个工具、预览不保存、应用修改、嵌套作用域通过 | `.cache/api-docs-mcp/verification.json` |
| 文档链接、锚点和示例语法 | 55 个相对链接、1 个锚点、48 个 JSON 示例、13 个 Python 和 37 个 Bash 片段通过；5 个配置符合 schema | `.cache/api-guide/verification/cross-check.json` |

复现文档中心检查：`TD_CHROMIUM=/path/to/chromium node frontend/browser-api-guide-check.mjs`。脚本自行启动前端并拦截全部 API 请求，不写入真实用户数据。实际 AI 适配器的教程回归为 `tests/test_api_tutorial.py`；测试素材明确标注非 AI，未使用付费供应商。应用文档与仓库 Markdown 使用同一份源文件。

## 0.4 初始验收

| 检查 | 结果 | 本地产物 |
| --- | --- | --- |
| Python 后端、图、脚本、协议、AI/MCP 与全部工程 | **308 项通过** | `data/artifacts/pytest-results.xml` |
| 前端算法、数据、组件、资源释放和布局 | **359 项通过** | `data/artifacts/frontend-tests.json` |
| 浏览器主流程 | **14 项通过**，无 JS 异常 | `data/artifacts/browser-e2e-results.json` |
| 共享边界、拖动合并与保存 | **11 项通过** | `data/artifacts/dock-workspace-results.json` |
| 图库搜索、分类与打开 | **5 项通过** | `data/artifacts/gallery-browser-results.json` |
| WAV / WebM / GLB 与自动播放失败恢复 | **8 项通过** | `data/artifacts/media-qa-results.json` |
| 嵌套组件 / Python / Chromium / WebM 集成 | **5 项通过** | `data/artifacts/reference-integration.json` |
| CHOP / DAT 实际浏览器执行 | **9 项通过** | `data/artifacts/channel-data-browser-check.json` |
| PCM 解码、WAV 和 WebRTC 音频 | **11 项通过** | `data/artifacts/audio-runtime-browser-check.json` |
| 浏览器输入与资源释放 | **13 项通过** | `data/artifacts/browser-inputs-check.json` |
| 网格、材质、物理与场景 | **14 项通过** | `data/artifacts/geometry-v2-browser.json` |
| Time / Animation / Replicator / 路径作用域 | **13 项通过** | `data/artifacts/component-scope-browser.json` |
| 新 TOP 执行与像素语义 | **45 节点 + 7 语义检查通过** | `data/artifacts/reference-top-browser-check.json` |
| RGB Key / Lens / Level / Reorder / HSV / Matte / Inside / Blur | **41 项浏览器检查通过**，含三输入 Matte | `data/artifacts/compatibility-top-browser.json` |
| 全部图库案例 | **82/82 通过**：76 个真实画面，6 个 AI/MCP 配置提示卡 | `data/artifacts/examples-render-report.json` |
| 新案例导出 JSON 直接导入 | **20/20 通过**，检查稳定 ID、路径和子图 | `data/artifacts/reference-exports-browser.json` |
| 共享清单、TypeScript、生产构建及 Python wheel | 通过；699 个入口、83 个公开工程 | `data/artifacts/frontend-build.log`、`python-wheel-build.log` |

699 个入口包含 92 个外部驱动适配入口；API 另注册一个 `python_scale` 示例，所以 `/api/health` 报告 700。六张截图共 531 项：432 项可运行子集、7 项相关子集、92 项需要外部驱动。它们都不代表完整 TouchDesigner 等价，见 [逐项进度](REFERENCE_COVERAGE.md)。

## 本次重点验证

组件验证包括父子 In/Out、多输出编号、嵌套编辑保存/撤销、相对与绝对路径、局部时钟、独立复制状态，以及跨层隐式引用循环拒绝。浏览器直接执行公开 JSON，未用另一套测试模板替代导入结果。

音频验证实际解码 PCM、生成可读取 WAV，并建立本地 WebRTC 连接收到非零样本；不把解析 SDP 当作音频成功。摄像头采用 Chromium 模拟设备，MIDI 使用端口模拟；键盘、指针和释放行为在真实浏览器中验证。未声称实测所有摄像头、MIDI 接口或操作系统。

协议验证实际使用回环 UDP/OSC/Art-Net、TCP、WebSocket、MQTT 测试 broker、POSIX 伪终端和 mmap。原生厂商 SDK 不在此测试范围。新增脚本运行令牌验证覆盖缺失、重放、过期和客户端不匹配；协议/网页不能通过编码路径或原始 TCP 回调应用的敏感 API。受信任 Python 仍具备宿主权限，进程超时和输出限制不构成安全沙箱。

实例物理使用 cannon-es，场景和材质使用 Three.js。CPU 网格/像素算法有明确复杂度预算；测试通过不构成 4K/60fps 或长时间演出性能承诺。构建仍提示较大的 Three.js/应用分块；Python 有 Starlette/httpx 弃用提示，均未导致测试失败。

## 复现

项目根目录使用 Node 22：

```bash
.venv/bin/python -m pytest
npm --prefix frontend test
npm --prefix frontend run build
node scripts/sync-catalog.mjs --check
node scripts/export-examples.mjs
.venv/bin/python scripts/export-node-docs.py
.venv/bin/python scripts/audit-reference-capabilities.py
```

隔离服务：

```bash
TD_PORT=8766 TD_DATA_DIR=.cache/browser-qa ./scripts/start.sh
```

浏览器验证需要 Chromium（部分脚本自行启动 Vite，仍使用项目内缓存）：

```bash
export TD_BASE_URL=http://127.0.0.1:8766
export TD_CHROMIUM=/path/to/chromium
node frontend/browser-e2e.mjs
node frontend/browser-dock-check.mjs
node frontend/browser-gallery-check.mjs
TD_MEDIA_QA_DATA_DIR=.cache/browser-qa node frontend/browser-media-check.mjs
node frontend/browser-reference-integration.mjs
node frontend/browser-channel-data-check.mjs
node frontend/browser-audio-runtime-check.mjs
node frontend/browser-inputs-check.mjs
node frontend/browser-geometry-v2-check.mjs
node frontend/browser-component-scope-check.mjs
node frontend/browser-reference-top-check.mjs
node frontend/browser-compatibility-top-check.mjs
node frontend/browser-reference-exports-check.mjs
node frontend/render-examples.mjs
```

脚本会保存测试作品和配置，只应对隔离数据目录运行。原始报告和私人数据不随 Git 发布，源码包含复现脚本和真实效果图。DeepSeek 官方语言接口已实测；其他付费供应商、专有设备 SDK、跨平台驱动、长时间演出与专业视频同步尚未完成验证。
