# 本地模型、ComfyUI 与环境安装

本地模型在自己的 GPU 上生成。入口是左侧 **本地 AI → 本地模型中心**；节点参数里的 **模型与环境** 和 **安装教程** 也可以打开。所有源代码、独立 Python 环境、权重、缓存、日志和生成文件都保存在 `td_open` 项目目录内。

七套预设已在工作台真实执行并检查输出，参数、显存与验收边界见 [真实运行记录](LOCAL_AI_VALIDATION.md)。

## 第一次使用：一键安装

1. 点击 **本地 AI**，先查看检测到的显卡、显存和空闲磁盘。
2. 在模型卡片点击 **一键安装**。第一次会安装独立环境、ComfyUI 以及该模型需要的文件；共用编码器只下载一次。
3. 在 **任务与结果** 查看下载进度。下载可以取消，重试时继续已完成的分块；文件完成后核对 SHA-256。
4. 点击模型卡的 **添加节点**。在右侧填写提示词，或上传需要的输入图片 / 音频。
5. 点击 **运行本地工作流**。任务进入队列，引擎按需启动；完成后生成资源写入节点。
6. 图片 / 视频连到画面输出；三维连到 Render；音乐点击播放，或 **读取完整文件为 PCM 采样** 后连接音频信号节点。

生成资源可从节点或模型中心打开、下载。分轨任务返回全部声部，点击某个声部的 **选为输出** 可以单独分析或播放它。

## 模型选择

| 模型 ID | 功能 | 默认配置 | 建议显存 / 内存 | 权重许可 |
| --- | --- | --- | --- | --- |
| `flux-klein-4b` | 文生图、单图 / 双参考图指令编辑 | 512×512、4 步、FP8 | 8 / 24 GiB | Apache-2.0 |
| `z-image-turbo` | 中英文文生图、图像重绘、遮罩修复 | 512×512、9 步、INT8 | 10 / 24 GiB | Apache-2.0 |
| `ace-step-15` | 风格与歌词生成音乐、参考音色 | 10 秒、8 步、LM 规划可选 | 8 / 24 GiB | MIT / Apache-2.0 |
| `hunyuan3d-21` | 单图生成 GLB 几何网格 | 30 步、128 网格解析度 | 12 / 24 GiB | 腾讯 Hunyuan 社区许可，含使用条款 |
| `melband-roformer` | 人声 / 伴奏双轨 | 本地音频输入 | 4 / 8 GiB | 见原权重与插件许可 |
| `demucs-4` | 人声 / 鼓 / 贝斯 / 其他四轨 | 4 秒分块 | 4 / 8 GiB | MIT |
| `wan22-5b` | 文生视频、图生视频 | 512×320、17 帧、20 步 | 16 / 32 GiB | Apache-2.0 |

显存建议是这组预设的使用起点，不是所有分辨率 / 时长的固定保证。提高分辨率、帧数、批量或启用更大文本模型会增加显存和内存。低显存通过 CPU 卸载节省 GPU 空间，速度受系统内存与 PCIe 影响。运行环境将显存预算限制在最多 24 GiB，并记录每次任务的真实进程显存峰值。

模型按 2026-10 的可用实现筛选，优先选择消费级显卡适用的公开权重。较旧的 Demucs 仍用于四轨兼容；最新大型或需要账户许可的模型可通过 Comfy API 工作流扩展。LTX-2.5 官方下载需要 HF 账户授权，不能把未授权 / 未实测的模型当成已经通过验收的预设。

官方来源：[FLUX.2](https://github.com/black-forest-labs/flux2)、[Z-Image](https://github.com/Tongyi-MAI/Z-Image)、[ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5)、[Hunyuan3D 2.1](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1)、[Wan 2.2](https://github.com/Wan-Video/Wan2.2)、[Demucs](https://github.com/facebookresearch/demucs)、[MelBand 插件](https://github.com/kijai/ComfyUI-MelBandRoFormer)。软件源码的 MIT 许可不替代模型权重或 ComfyUI 的许可。权重与第三方运行源码默认不提交到 GitHub。

## 环境方案

一键 CUDA 安装面向 **Linux / Windows + NVIDIA GPU + Python 3.11**。建议 RTX 30 系列或更新、最新兼容驱动，至少 32 GiB 系统内存。macOS、AMD 或已有独立 ComfyUI 的使用者，可以手动安装适合平台的 PyTorch，并在环境设置连接该服务。

默认选择一套独立环境：

一键安装使用精简核心方案，保留 ComfyUI 引擎、原生节点与界面，使用工作台自带案例和文档。官方模板的示例视频 / 图片大包不属于推理依赖，可在需要时手动安装 `comfyui-workflow-templates`；下面的完整手动安装命令会包含这些可选示例包。

```text
td_open/
├── backend/local_ai/             # 主程序中的调度、下载、模型清单与工作流
├── data/local-ai/
│   ├── envs/comfy/               # 独立 Python 环境
│   ├── runtimes/comfyui/         # 固定版本 ComfyUI，含两种音频插件
│   ├── models/                  # 共用权重目录
│   ├── input/ output/ temp/     # Comfy 输入、中间文件与输出
│   ├── logs/                    # 安装与运行日志
│   ├── cache/                   # HF / Torch / 平台缓存
│   └── settings.json            # GPU、显存预算、回环地址
├── data/local-ai-jobs/           # 任务、参数、实际工作流与结果记录
└── data/assets/                 # 工作台可直接访问的最终资源
```

显存预算在 **环境设置** 中设置，范围 4–24 GiB。只使用选择的单张 GPU；不把两张卡合并为一张 24 GiB 显卡。模型串行执行。预算给 CUDA 上下文与工作区预留余量，出现 OOM 时仍需要减小任务规模。停止服务只能停止 TD Open 自己启动的进程。

## 命令行一键安装

从项目根目录运行。命令与界面使用同一个安装器：

```bash
cd /storage/homes/hongzj/dell/td_open
.venv/bin/python scripts/local-ai.py hardware
.venv/bin/python scripts/local-ai.py install --profile flux-klein-4b
.venv/bin/python scripts/local-ai.py install --profile ace-step-15
.venv/bin/python scripts/local-ai.py configure --gpu 0 --vram 24
.venv/bin/python scripts/local-ai.py start
```

安装所有预设需要较多磁盘，先查看模型卡的真实文件大小：

```bash
.venv/bin/python scripts/local-ai.py install --all
```

安装器检测不足时会返回缺少空间的提示。停止 CLI 下载用 `Ctrl+C`，然后使用相同命令重试。续传 `.part` 和 `.ranges.json` 文件需要一起保留。

## 手动安装环境

Linux 从仓库根目录运行下面的步骤。使用系统 Python 3.11 创建独立环境；主程序 `.venv` 已经是 3.11 时也可以用它创建：

```bash
export TMPDIR="$PWD/.cache/tmp"
export PIP_CACHE_DIR="$PWD/.cache/pip-local-ai"
export HF_HOME="$PWD/data/local-ai/cache/huggingface"
mkdir -p "$TMPDIR" "$PIP_CACHE_DIR" "$HF_HOME"
.venv/bin/python -m venv data/local-ai/envs/comfy
data/local-ai/envs/comfy/bin/python -m pip install --upgrade pip
data/local-ai/envs/comfy/bin/python -m pip install \
  torch==2.8.0 torchvision==0.23.0 torchaudio==2.8.0 \
  --index-url https://download.pytorch.org/whl/cu128 \
  --extra-index-url https://pypi.org/simple

git clone https://github.com/Comfy-Org/ComfyUI.git data/local-ai/runtimes/comfyui
git -C data/local-ai/runtimes/comfyui checkout 7bf5df9e38763dbdd94a0f9c939273019025c2bc
data/local-ai/envs/comfy/bin/python -m pip install \
  -r data/local-ai/runtimes/comfyui/requirements.txt \
  demucs==4.0.1 soundfile rotary-embedding-torch trimesh \
  -c backend/local_ai/requirements.lock

git clone https://github.com/kijai/ComfyUI-MelBandRoFormer.git \
  data/local-ai/runtimes/comfyui/custom_nodes/ComfyUI-MelBandRoFormer
git -C data/local-ai/runtimes/comfyui/custom_nodes/ComfyUI-MelBandRoFormer \
  checkout 92c86854e6654f4aacc97484471af95c98ea16d4

.venv/bin/python scripts/local-ai.py verify-environment --register
```

环境约束固定本次验证的依赖版本，避免最新依赖变更破坏节点。上述完整安装会额外下载官方模板的示例媒体；只需 TD Open 工作台时可使用一键安装的精简方案。精简引擎启动时可能提示可选 `comfyui-workflow-templates` 未安装，此提示不表示推理节点失败；需要 Comfy 官方模板浏览器时单独安装该包。

最后一步验证依赖、CUDA 与固定 ComfyUI 版本，并安装项目自己的 WAV / Demucs 插件。成功后会写入 `ready.json`，工作台才把环境视为就绪。实际解析依赖保存在 `data/local-ai/envs/comfy/requirements.installed.txt`。

Windows 使用同样的 Python / Git 命令；把 `data/local-ai/envs/comfy/bin/python` 替换为 `data\local-ai\envs\comfy\Scripts\python.exe`。主程序使用自己的 Python；ComfyUI 使用模型环境的 Python，两者不能混为一个解释器。

## 手动下载与放置权重

每张模型卡的 **文件说明** 会显示所有必需文件、固定版本官方链接和项目内路径。完整可机器读取清单是 [manifest.json](../backend/local_ai/manifest.json)，包含文件大小、仓库 revision 与 SHA-256。可只下载权重而不再次装环境：

```bash
.venv/bin/python scripts/local-ai.py download --profile z-image-turbo
.venv/bin/python scripts/local-ai.py download --profile wan22-5b
```

也可用浏览器或自己的下载器保存文件，务必保持清单中的文件名和子目录。例子：

```text
data/local-ai/models/
├── diffusion_models/
│   ├── flux-2-klein-4b-fp8.safetensors
│   ├── z_image_turbo_int8_convrot.safetensors
│   ├── acestep_v1.5_turbo.safetensors
│   ├── wan2.2_ti2v_5B_fp16.safetensors
│   └── MelBandRoformer_fp16.safetensors
├── text_encoders/
│   ├── qwen_3_4b_fp8_mixed.safetensors
│   ├── qwen_0.6b_ace15.safetensors
│   ├── qwen_1.7b_ace15.safetensors
│   └── umt5_xxl_fp8_e4m3fn_scaled.safetensors
├── vae/
│   ├── flux2-vae.safetensors
│   ├── ae.safetensors
│   ├── ace_1.5_vae.safetensors
│   └── wan2.2_vae.safetensors
├── checkpoints/hunyuan_3d_v2.1.safetensors
└── demucs/955717e8-8726e21a.th
```

手动放置后再执行 `download --profile ...`，安装器会校验已有文件并写入 `.verified.json`，不会重复下载校验通过的文件。自动下载会尝试对应的公开镜像，再使用固定 HF 源；最终必须与固定源的 SHA-256 相符。

## 各类节点怎么连接

### 图片、参考图编辑与遮罩修复

`本地图片生成 → 画面输出`。选择模型后使用该模型推荐步数：Klein 4 步，Z-Image 9 步。修改参数只修改配置；每次生成均手动运行。

参考图编辑用 `图片 / 视频 → 本地参考图编辑 → 输出`，或在节点 **输入素材地址** 填上传后的 `/api/assets/...png`。第二参考图可选。描述应是编辑指令，例如“将白色机器人改成蓝色陶瓷，保持造型”。

常规重绘使用 Z-Image；**降噪强度**越小越接近原图。遮罩修复需要原图和单独的灰度遮罩：白色参与重绘，黑色区域在最终图中保留原图。透明度遮罩与白色灰度遮罩含义不同，此预设使用红色通道作为灰度值。

### 音乐与分轨

音乐节点填写风格描述、歌词、时长、BPM、语言和调性。纯器乐可使用 `[Instrumental]`。默认关闭 LM 音频编码规划以减少内存和耗时；开启时会实际运行 1.7B 模型。参考音色输入需要真实音频文件。当前 Comfy 预设不提供 ACE 独立程序中的 Cover / Repaint 编辑入口。

分轨节点选择 Demucs 或 MelBand，上传音频并在 **输入素材地址** 填 `/api/assets/...wav`，或连接已有音频节点。连接有本地 URL 的音频节点会处理完整文件；连接实时 PCM 则处理当前采样块。

完成后各轨单独下载。点击 **选为输出** 后，再点击 **读取完整文件为 PCM 采样**，该声部便可连接到 FFT、频谱、滤波或音频输出节点。播放声音需要一次明确的播放操作。

### 三维

`参考图 → 本地三维模型生成 → Render → 画面输出`。使用清晰、背景简单、主体完整的单图。当前轻量预设生成几何网格并输出 GLB，不包含高显存 PBR 纹理绘制。网格解析度决定解码精度；先用 128，再考虑 256。

### 视频

仅填写提示词是文生视频；提供起始图后为图生视频。Wan 宽高为 32 的倍数，帧数为 `4n+1`；默认 17 帧用于快速验收。帧率是输出播放速度，不能代替增加生成帧数。

`本地视频生成 → 输出` 可实时预览保存的 MP4。长片段按多段生成；高分辨率的上限与系统内存、卸载带宽和编码耗时有关，不能从一次短片成功推断任意长度都可运行。

## 精细流程与 Comfy 工作流

内置 Comfy 节点覆盖检查点 / UNet / CLIP / VAE 加载、LoRA、提示词、潜空间、采样、ControlNet、边缘图、遮罩、放大、音频编码、视频封装和 GLB 保存。端口上的 MODEL、CLIP、VAE、LATENT、CONDITIONING 等类型对应 Comfy 的真实连线类型。

这些节点在画布上组合后，从 **保存图片 / 音频 / 视频 / 网格** 节点点击 **运行本地工作流**。后台只执行该节点的上游网络。工作台普通图像节点接入 Comfy 流程时会保存当前图像快照，再交给本地引擎。

LoRA、ControlNet 和放大模型需要与基础模型匹配的额外权重，放在 `models/loras`、`models/controlnet`、`models/upscale_models`。加载器填写文件名；这些功能入口不意味着所有扩展权重已经内置或已经实测。

模型中心的 **Comfy 节点库** 读取运行引擎的 `/object_info`，显示真实已安装类。通用节点支持四个连线输入、四个输出及 JSON 参数。超过这些端口数量或包含复杂插件的网络，用 **ComfyUI 工作流** 节点运行完整 API 图：

1. 在 ComfyUI 中保存 **API 格式** 工作流。
2. 在工作台添加 **ComfyUI 工作流** 节点，粘贴导出的 JSON。
3. 选择预览类型，手动运行。
4. 完成后查看全部资源与实际执行工作流。

API 格式是以下结构；普通带 `nodes` / `links` 的界面布局 JSON 不能直接发送到 `/prompt`：

```json
{
  "1": {"class_type": "LoadImage", "inputs": {"image": "example.png"}},
  "2": {"class_type": "SaveImage", "inputs": {"images": ["1", 0], "filename_prefix": "td_open/example"}}
}
```

此示例要求 `example.png` 已位于 Comfy 输入目录。工作台保存资源的真实路径不会写入公共工作流中的密钥。

## 连接已有 ComfyUI

在 **环境设置** 填回环地址，例如 `http://127.0.0.1:8188`，取消 **由 TD Open 启动和管理进程** 并保存。若服务位于另一台机器，先建立 SSH 转发，再使用回环端口。

预设要求相同类名与权重文件名。外部 ComfyUI 可通过自己的 `extra_model_paths.yaml` 映射项目的 `data/local-ai/models`，或手动放入其模型目录。音频预设还需要项目的 `td_open_nodes` WAV / Demucs 插件；MelBand 需要相应插件。外部环境的启动、停止和依赖更新由原服务维护。

官方协议：[ComfyUI API 示例](https://github.com/Comfy-Org/ComfyUI/tree/master/script_examples)、[ComfyUI 安装与概念](https://docs.comfy.org/)。

## 常见错误

| 现象 | 检查 / 处理 |
| --- | --- |
| 环境没有就绪 | 查看 `install-*.log`；手动安装后执行 `verify-environment --register` |
| 下载连接失败 | 重试续传，或从模型卡的固定官方地址手动下载；保留 `.part` 与分块记录 |
| SHA-256 不符 | 权重损坏或镜像版本不同；移动错误文件后使用固定官方源重下 |
| 模型需要账户授权 | 在官方页面取得访问权限，按手动说明使用自己的 HF Token；未授权不能自动下载 |
| 权重未安装 / 文件找不到 | 核对模型卡列出的文件名、目录和真实大小；不是每个模型共用同一个 VAE |
| Comfy 缺少节点 | 检查固定运行版本、插件安装及启动日志中的导入错误 |
| CUDA OOM | 降低分辨率、帧数或时长；停止其他 GPU 程序；确认单卡预算与 CPU 卸载设置 |
| 进程超过显存上限 | 任务已停止；减小任务规模后重试，查看任务记录中的实测峰值 |
| 音频无声 | 先播放 / 启用 PCM；生成、解码与浏览器播放授权是三个步骤 |
| 视频没有运动 | 检查真正的帧数、步数和提示词；不同帧率只改变播放速度 |
| 没有返回资源 | 工作流需要 SaveImage、TDOpenSaveWAV、SaveVideo 或 SaveGLB 等保存节点 |
| 服务退出 | 查看 `comfy-server.log`；确认驱动、PyTorch CUDA 版本和 CPU 内存 |

## 二次开发

- [manifest.json](../backend/local_ai/manifest.json)：模型、固定权重、文件大小、校验值与环境版本。
- [workflows.py](../backend/local_ai/workflows.py)：各模型的真实 Comfy API 图。
- [compiler.py](../backend/local_ai/compiler.py)：工作台子图到 Comfy API 图的转换。
- [manager.py](../backend/local_ai/manager.py)：队列、环境安装、进程、输入输出与显存记录。
- [comfy_nodes.py](../backend/local_ai/comfy_nodes.py)：项目自己的 WAV 输出与 Demucs 适配器。
- [localAICatalog.ts](../frontend/src/nodes/localAICatalog.ts)：用户可组合的节点与参数。

添加模型时，先声明权重来源、版本和许可，再实现工作流，最后通过工作台运行并保留生成文件、耗时和显存记录。静态节点注册或下载完成不等同于实际推理验收通过。

## 新模型与账户授权

扩展已安装 ComfyUI 的模型与节点时，优先使用其官方教程和 API 格式工作流。一般插件目录为 `data/local-ai/runtimes/comfyui/custom_nodes/`，必须用 `data/local-ai/envs/comfy/bin/python` 安装插件依赖，重启服务后在 **Comfy 节点库** 刷新。普通画布工作流 JSON 和 API JSON 格式不同，使用 Comfy 设置中的开发者模式导出 API 格式；工作台节点支持直接导入该 JSON 文件。

需要 Hugging Face 授权的权重应先在官方页面接受许可，然后将只读 Token 保存在 `data/config/huggingface.token`，或启动安装进程时设置 `HF_TOKEN`。该文件位于忽略的数据目录，不发送到前端，不提交到 GitHub。当前固定清单的七套模型不需要账户授权；LTX-2.5 未授权、未验收，不能通过公开镜像绕过许可。

## HTTP API 与二次开发

这些路径属于 **TD Open（默认端口 8765）**；ComfyUI 引擎（默认端口 8189）的 `/prompt` 是另一套协议。请求生成需要显式 POST；`/api/evaluate`、修改参数和打开工程不会自动启动 GPU 推理。

| 方法与路径 | 请求或结果 |
| --- | --- |
| `GET /api/local-ai/status` | 显卡、环境、配置、权重安装/校验、实测记录、最近任务 |
| `GET /api/local-ai/manifest` | 七个 profile 和固定权重清单 |
| `POST /api/local-ai/install` | `{"profile_ids":["flux-klein-4b"],"environment":true}`；返回安装 job |
| `POST /api/local-ai/settings` | `url`、`gpu`、`vram_limit_gb`、`managed`、`download_source` |
| `POST /api/local-ai/start`、`/stop` | 启动 / 停止本程序管理的引擎；有运行任务时不能停机或更换配置 |
| `GET /api/local-ai/object-info` | 引擎实际安装的原生节点 schema |
| `GET /api/local-ai/files/{folder}` | 指定模型目录中的文件名，如 `loras`、`vae`、`controlnet` |
| `POST /api/local-ai/generate` | `profile_id`、`parameters`、`inputs`；或完整 `workflow` |
| `GET /api/local-ai/jobs/{id}` | 进度、终态、显存、耗时、全部输出文件 URL |
| `GET /api/local-ai/jobs/{id}/workflow` | 本次实际执行的 Comfy API 图 |
| `POST /api/local-ai/jobs/{id}/cancel` | 取消该任务，已完成文件保留 |
| `GET /api/local-ai/logs/{filename}` | 限定安装/引擎日志的末尾片段 |

`download_source` 支持 `auto`（同一官方文件的公开镜像，最终核对固定哈希）或 `official`（仅官方源）。托管模式限制单卡 4–24 GiB；**连接已有外部引擎时，其显存配置由外部服务控制，TD Open 不注入分配器上限**。同一托管模型目录的执行锁让多个 TD Open 实例共享串行队列。

Python 最小例子，使用主程序 `.venv` 的 HTTPX：

```python
import time
import httpx

with httpx.Client(base_url="http://127.0.0.1:8765", timeout=120) as client:
    status = client.get("/api/local-ai/status").raise_for_status().json()
    assert any(p["id"] == "flux-klein-4b" and p["installed"] for p in status["profiles"])
    queued = client.post("/api/local-ai/generate", json={
        "profile_id": "flux-klein-4b",
        "parameters": {"prompt": "A small ceramic robot", "width": 512,
                       "height": 512, "steps": 4, "seed": 42},
        "inputs": {},
    }).raise_for_status().json()
    while True:
        job = client.get("/api/local-ai/jobs/" + queued["id"]).raise_for_status().json()
        if job["status"] in {"succeeded", "failed", "cancelled", "interrupted"}:
            break
        print(job["progress"], job["message"])
        time.sleep(2)
    if job["status"] != "succeeded":
        raise RuntimeError(job["message"])
    for output in job["outputs"]:
        print(output["kind"], output["name"], output["url"])
```

图生三维、重绘或分轨先调用 `/api/upload` 上传真实文件，再传 `inputs={"image":"/api/assets/...png"}`、`{"audio":"/api/assets/...wav"}` 或 `{"image":...,"mask":...}`。只接受本程序返回的素材 / 导出 URL，不接受任意服务器文件路径。图编辑器的高层节点会自动把上传资源或上游画面转换成这些输入。

原生 API 图放到 `workflow`，省略 `profile_id`。如需关联此次上传，在 LoadImage / LoadAudio 字段填 `__TD_INPUT__image` / `__TD_INPUT__audio`，并在 `inputs` 中提供对应 URL；执行器会上传到引擎并替换标记。必须包含实际返回资源的保存节点。

任务返回不会自动覆盖某个已保存工程。浏览器为提交时的项目作用域记录 job ID，并只回写仍对应这次任务的节点；Python 或 MCP 客户端需要再使用图编辑 API 将资源 URL 写入目标节点。页面切换、参数修改和嵌套组件不会把旧任务结果误写到当前选中节点。
