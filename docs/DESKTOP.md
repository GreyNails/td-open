# Windows 与 macOS 桌面版

桌面版使用与网页版相同的 React 工作台、751 个节点入口、96 个案例、Python 后端、AI API / MCP 接入和工程格式。网页版的启动方式继续保留。现有节点的支持范围仍以[功能矩阵](FEATURE_MATRIX.md)为准，安装包不意味着 TouchDesigner 全功能兼容。

## 下载与安装

安装包发布在 [GitHub Releases](https://github.com/GreyNails/td-open/releases)。选择与你的电脑对应的文件：

| 电脑 | 文件 | 安装方式 |
| --- | --- | --- |
| Windows 10 / 11，Intel 或 AMD 64 位 | `TD-Open-0.6.0-win-x64.exe` | 双击安装；桌面和开始菜单会出现 TD Open |
| Apple Silicon Mac（M1 / M2 / M3 / M4 等） | `TD-Open-0.6.0-mac-arm64.dmg` | 打开磁盘映像，将 TD Open 拖到 Applications，再从应用程序启动 |
| Intel Mac | `TD-Open-0.6.0-mac-x64.dmg` | 同上，选择 x64 版本 |

macOS 要求 13 或更高。Windows ARM 暂未单独构建。Mac 另提供 ZIP，用于手动解压和分发。

本次发布没有商业代码签名证书：Windows 可能显示未知发布者，macOS 安装包使用临时签名，未经 Apple 公证。确认下载来自本仓库并核对发布页的 SHA-256 后，按系统的应用放行提示操作。Mac 首次打开被阻止时，可在“系统设置 → 隐私与安全性”使用“仍要打开”；不需要全局关闭 Gatekeeper。参见 [Apple 官方说明](https://support.apple.com/zh-cn/102445)。

安装包内置 Python、Node.js、Chromium 和 FFmpeg，无需单独安装这些运行环境。启动应用后会自动启动本地引擎，关闭应用时停止它。界面加载前有启动提示；错误日志可从“文件 → 打开运行日志”查看。

## 功能与 AI 模型

- 节点画布、停靠与拖动布局、框选、案例保护、工程自动保存、图像 / 点云 / 音频处理、创作助手和 `@节点` 操作直接使用同一套网页版实现。
- API 密钥在各自电脑的设置里填写。安装包不带开发者的密钥、用户项目或本地模型权重。接入方法见 [AI API 文档](AI_API.md)。
- 大型生成模型需要在“本地模型中心”首次下载；联网、磁盘空间、模型许可和显卡要求与网页版相同，安装桌面应用不等于预装所有权重。
- Windows 的自动环境安装面向 NVIDIA CUDA 显卡。驱动由用户安装，推荐在 24 GB 显存预算内使用已验证的配置。
- Apple Silicon 提供 PyTorch MPS 环境安装路径。但现有七组模型的工作界面推理记录来自 **Linux / NVIDIA**，不是 Mac 验证记录。FP8 权重、自定义 CUDA 算子以及部分模型可能不支持 MPS，不能保证现有全部模型在 Mac 原样推理。
- Intel Mac 可以使用普通节点、AI API 和外部 ComfyUI；当前自动安装器不提供 Intel Mac 本地生成环境。Mac 也可连接局域网中已有的 NVIDIA ComfyUI 服务，在相同节点图中运行生成任务。
- MIDI、摄像头、串口、NDI、专业硬件等仍需要对应系统权限、驱动或外部适配器。桌面打包不会消除原有外部 SDK 限制。

详细模型说明见 [本地 AI 安装与接入](LOCAL_AI.md) 和 [实际验证记录](LOCAL_AI_VALIDATION.md)。

## 数据、迁移与升级

安装程序与用户作品分开保存。菜单“文件 → 打开作品与模型目录”可直接打开数据位置：

| 系统 | 默认工作目录 |
| --- | --- |
| Windows | `%APPDATA%\TD Open\workspace` |
| macOS | `~/Library/Application Support/TD Open/workspace` |

其中 `data/projects` 是项目，`data/assets` 是上传资源，`data/exports` 是导出结果，`data/local-ai` 是模型环境和权重，`logs` 是日志。配置中可能包含私人 API 密钥，请勿公开整个目录。系统安装位置不同不影响作品路径；Windows 卸载器默认保留作品。

从网页版迁移时，关闭两边应用后备份并复制所需的 `data` 文件。工程 JSON 可直接导入；其中引用的上传素材需要一并复制。已下载的权重文件可复用，**Linux / Windows / Mac 的 Python 虚拟环境不能互相复制使用**，应在目标系统重新安装环境。网页浏览器中的布局偏好不自动迁移。

## 开发与原生构建

目录 `desktop/` 是 Electron 外壳，`backend/desktop.py` 管理本地引擎；核心功能继续在 `frontend/` 和 `backend/` 里开发。资源只读路径和用户可写路径由 `backend/paths.py` 区分，普通网页启动默认仍使用项目根目录。

在目标操作系统上安装 Python 3.11 和 Node.js 22.12+ 后，在仓库根目录运行：

```bash
python -m pip install -r requirements.lock -r desktop/requirements-build.txt -r desktop/requirements-runtime.txt
npm --prefix frontend ci
npm --prefix frontend run build
npm --prefix desktop ci
python scripts/build-desktop-runtime.py
npm --prefix desktop test
```

然后选择对应打包命令：

```bash
# Windows x64
npm --prefix desktop run package -- --win --x64
# Apple Silicon Mac
npm --prefix desktop run package -- --mac --arm64
# Intel Mac
npm --prefix desktop run package -- --mac --x64
```

产物位于 `dist/desktop`。运行 `python scripts/smoke-desktop.py` 验证实际打包后的应用。GitHub Actions 的 [Build desktop installers](../.github/workflows/desktop.yml) 在三个原生系统上执行相同流程。不要把 Linux 下载的 Python / Chromium 复制进 Windows 或 Mac 包中。

开发时先完成运行时准备，再执行 `npm --prefix desktop start`。临时数据目录可通过 `TD_DESKTOP_USER_DATA` 指定；`TD_DESKTOP_RESOURCES` 可指定测试用的运行时资源目录。这两个选项面向开发者，普通用户无需设置。

## 验证范围

构建流程同时检查：桌面实际启动、共享前端节点显示、751+ 节点目录、案例另存为项目、中文路径与 Python 回调、内置 Chromium 网页截图、资源上传、WebGL 2、离线音频采样以及退出后无残留后端进程。报告和真实桌面截图保存在构建产物中。

这些检查不等价于人工试听、摄像头 / MIDI / 串口硬件实测，也不等价于在三种系统上重新运行全部大型生成模型。公开报告会保留这个范围，不把构建成功写成所有模型跨平台验证成功。
