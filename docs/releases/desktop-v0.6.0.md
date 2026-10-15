Windows 与 macOS 桌面安装包已加入，同一套节点、案例、自由工作区、创作助手、AI API / MCP 和 Python 后端继续用于网页版与桌面版。

| 系统 | 下载 |
| --- | --- |
| Windows 10 / 11，Intel / AMD 64 位 | `TD-Open-0.6.0-win-x64.exe` |
| macOS 13.5+，Apple Silicon（M 系列） | `TD-Open-0.6.0-mac-arm64.dmg` |
| macOS 13.5+，Intel | `TD-Open-0.6.0-mac-x64.dmg` |

Windows 双击安装；Mac 打开 DMG，将 TD Open 拖到 Applications。包内包含 Python、Node.js、Chromium 与 FFmpeg，首次运行不用先安装开发环境。Mac 同时提供 ZIP。

安装后的三个原生应用都经过启动、案例另存、中文路径、Python 计算、Chromium 网页截图、上传、音频采样、WebGL 2 和退出清理检查。实际报告见附件 `verification-*.json`、`VALIDATION.json`，工作台截图见 `desktop-*.png`。校验值见 `SHA256SUMS.txt`。

本次包未购买商业签名证书；Windows 可能显示未知发布者，Mac 使用临时签名、尚未公证。确认来源后按系统提示允许打开。安装、数据迁移和首次打开的步骤见 [桌面版说明](https://github.com/GreyNails/td-open/blob/main/docs/DESKTOP.md)。

大型生成模型不包含在安装包中，首次使用需要在本地模型中心下载。七组模型已有的完整推理记录来自 Linux / NVIDIA；Mac 的 MPS、FP8 和自定义 CUDA 算子兼容性有差异，不能将本次桌面检查视为全部模型在 Mac 的推理验证。Intel Mac 可使用普通节点、AI API 与外部 ComfyUI；暂不提供 Intel Mac 自动本地模型环境。原有外部 SDK / 硬件节点的依赖条件仍适用。
