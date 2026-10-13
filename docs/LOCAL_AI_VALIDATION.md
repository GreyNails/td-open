# 本地模型真实运行记录

验证日期：2026-10-14。通过真实浏览器导入项目、点击 **运行本地工作流**，由 TD Open 调度固定版本 ComfyUI 和真实权重。没有拦截生成 API、没有用演示图片代替模型输出，也没有调用收费服务。

测试机器为 Linux、Python 3.11、PyTorch 2.8.0 cu128、单张 NVIDIA L40。虽然实体显卡超过 24 GiB，运行器强制设置 **24 GiB 总预算**，为上下文留出 1.5 GiB，模型串行执行并卸载文本编码器到 CPU。**这验证的是显存预算下的运行；尚未在实体 RTX 3090 / 4090、Windows、AMD 或 macOS 上复测。** 时长不代表家用显卡的速度。

| 模型 | 实测任务和参数 | 界面结果 | 用时 | 进程显存峰值 |
| --- | --- | --- | --- | --- |
| FLUX.2 Klein 4B FP8 | 文生图，512×512，4 步 | PNG，可预览与下载 | 17.27 秒 | 4.62 GiB |
| Z-Image Turbo INT8 | 文生图，512×512，9 步 | PNG，可预览与下载 | 15.07 秒 | 6.94 GiB |
| ACE-Step 1.5 Turbo | 10 秒器乐，8 步，LM 规划关闭 | 48 kHz 双声道 WAV；界面完整 PCM 解码 | 15.57 秒 | 6.61 GiB |
| Hunyuan3D 2.1 Shape | 使用实生成参考图，30 步，128 解析度，4096 潜空间点 | GLB，在 Three.js 中实际渲染 | 36.70 秒 | 7.36 GiB |
| MelBand RoFormer | 上述实生成音乐，双轨分离 | 人声 / 伴奏两条 WAV，可单独播放和解码 | 4.48 秒 | 2.70 GiB |
| Demucs HT | 同一音频，4 秒分块 | 人声 / 鼓 / 贝斯 / 其他四条 WAV | 6.55 秒 | 1.05 GiB |
| Wan 2.2 TI2V 5B | 图生视频，512×320，17 帧，16 fps，20 步 | H.264 MP4，在界面预览 | 33.98 秒 | 12.69 GiB |

机器可读取的记录见 [validation.json](../backend/local_ai/validation.json)。逐次任务另记录 NVML 进程峰值与 PyTorch allocated / reserved 峰值；模型中心中“权重已校验”和“界面实测通过”分别描述文件完整性和这组实际运行。

另外通过工作台实测了 **FLUX 参考图编辑、Z-Image 图生图、遮罩重绘、拆开的原生 Z-Image 采样网络、导入 Comfy API JSON 工作流**。遮罩任务进一步逐像素核对：黑色遮罩区域与原图完全一致，白色区域发生变化。

## 输出文件检查

PNG 检查尺寸及像素变化，排除空白输出。WAV 使用 SoundFile 解码，检查采样率、声道、时长、有限值和非零 RMS。GLB 使用 Trimesh 解码，实生成主体含 14,496 个三角面、一个连通分量。MP4 使用 PyAV 逐帧解码，检查 17 帧、512×320、16 fps，并确认首尾帧发生变化。

Hunyuan 的初始输出含大量孤立表面碎片，导致预览围绕错误范围缩放；已加入可关闭的 **移除孤立碎片，保留主体** 步骤，并重新通过界面生成、下载及渲染验证。该步骤保留模型实际生成的最大连通表面，不用基础几何体替换输出；多物体输入如需保留全部部件应关闭。此预设只生成几何，不生成 PBR 贴图，几何质量仍取决于参考图和生成模型。

## 如何复现

先按 [安装与接入说明](LOCAL_AI.md) 安装环境和七组权重。另开隔离工作台，所有结果仍保存在项目内：

```bash
TD_PORT=8774 TD_DATA_DIR=.cache/local-ai-qa TD_LOCAL_AI_DIR=data/local-ai \
  .venv/bin/python -m backend.main
```

另一个终端：

```bash
export PATH="$PWD/.tools/node-v22.21.1-linux-x64/bin:$PATH"
export TD_CHROMIUM=/path/to/chromium
TD_BASE_URL=http://127.0.0.1:8774 node frontend/browser-local-ai-live.mjs

data/local-ai/envs/comfy/bin/python scripts/verify-local-media.py
```

脚本只接受项目内 `.cache` 隔离服务，避免覆盖日常作品；通过浏览器操作生成节点，顺序生成参考图和音乐，再将其送入三维、分轨与视频模型。实测工作流、截图、资源检查、显存记录保存在 `data/artifacts/local-*`，权重不进入公开仓库。`TD_LOCAL_PROFILES` 可以指定逗号分隔的模型 ID。

## 验证边界

通过以上参数不能推导任意分辨率、时长、歌词、参考素材或第三方节点都能稳定运行。长视频、高解析度网格、更多参考图和 LM 规划需要单独验收。LoRA、ControlNet 和额外模型的节点接入已提供，用户自行安装的每一份权重不能自动视为已实测。ComfyUI 的整个第三方插件生态也不属于这七组预设的验收范围。

LTX-2.5 官方权重需要 Hugging Face 账户接受许可。本机尚未提供该授权，因此没有下载或实测该模型，也没有把它标成可用预设；取得授权后可依照官方模板，通过 Comfy API 工作流节点接入。
