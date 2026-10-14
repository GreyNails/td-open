# 第三方依赖说明

TD Open 自行编写的代码使用 [MIT](LICENSE) 许可证。下列第三方软件保留其各自许可与版权，TD Open 的 MIT 许可不替代它们。

清单于 2026-10-14 从本项目已安装 Python distribution 的 `METADATA` / 许可文件，以及前端包的 `package.json` / 许可文件核对。版本为本次安装的实际版本；完整解析结果见 [requirements.lock](requirements.lock) 和 [frontend/package-lock.json](frontend/package-lock.json)。这份清单列出直接运行、开发及构建依赖，不是所有传递依赖的完整许可证汇编。

## Python 直接依赖

| 软件 | 核对版本 | 元数据许可 | 用途 |
| --- | --- | --- | --- |
| [FastAPI](https://github.com/fastapi/fastapi) | 0.143.0 | MIT | HTTP API |
| [Pydantic](https://github.com/pydantic/pydantic) | 2.14.1 | MIT | 数据模型与校验 |
| [Uvicorn](https://github.com/Kludex/uvicorn) | 0.54.0 | BSD-3-Clause | ASGI 服务 |
| [websockets](https://github.com/python-websockets/websockets) | 15.0.1 | BSD-3-Clause | WebSocket 传输 |
| [HTTPX](https://github.com/encode/httpx) | 0.28.1 | BSD-3-Clause | HTTP 客户端 |
| [python-multipart](https://github.com/Kludex/python-multipart) | 0.0.32 | Apache-2.0 | 文件上传解析 |
| [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk) | 1.30.0 | MIT | MCP 客户端与服务端 |
| [pytest](https://github.com/pytest-dev/pytest) | 9.1.1 | MIT | 开发测试 |

构建系统另外声明 [setuptools](https://github.com/pypa/setuptools) `>=68`，使用 MIT 许可。它由 Python 隔离构建环境解析，构建环境版本没有固定在运行依赖锁中；基础虚拟环境中另可见 65.5.0，其元数据与附带 LICENSE 同样标为 MIT，不能把该版本当成隔离构建实际使用的版本。

Python 安装包的许可原文保存在其 `*.dist-info/licenses/` 或 `*.dist-info/` 中，实际位置以对应 distribution 的 `RECORD` 与 `License-File` 元数据为准。

## 前端直接运行依赖

| 软件 | 核对版本 | 元数据许可 |
| --- | --- | --- |
| [@xyflow/react](https://github.com/xyflow/xyflow) | 12.12.0 | MIT |
| [lucide-react](https://github.com/lucide-icons/lucide) | 0.468.0 | ISC |
| [React](https://github.com/react/react) | 19.3.0 | MIT |
| [React DOM](https://github.com/react/react) | 19.3.0 | MIT |
| [react-markdown](https://github.com/remarkjs/react-markdown) | 10.1.0 | MIT |
| [remark-gfm](https://github.com/remarkjs/remark-gfm) | 4.0.1 | MIT |
| [cannon-es](https://github.com/pmndrs/cannon-es) | 0.20.0 | MIT |
| [Three.js](https://github.com/mrdoob/three.js) | 0.180.0 | MIT |

Lucide 的附带 LICENSE 还说明部分图标来源于 Cole Bemis 的 Feather（MIT），其余版权属于 Lucide Contributors；分发时应保留该完整声明。

## 前端直接开发依赖

| 软件 | 核对版本 | 元数据许可 |
| --- | --- | --- |
| [@playwright/test](https://github.com/microsoft/playwright) | 1.64.0 | Apache-2.0 |
| [@types/react](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/react) | 19.3.0 | MIT |
| [@types/react-dom](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/react-dom) | 19.3.0 | MIT |
| [@types/three](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/three) | 0.180.0 | MIT |
| [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | 5.2.0 | MIT |
| [Prettier](https://github.com/prettier/prettier) | 3.9.10 | MIT |
| [TypeScript](https://github.com/microsoft/TypeScript) | 5.9.3 | Apache-2.0 |
| [Vite](https://github.com/vitejs/vite) | 7.3.7 | MIT |
| [Vitest](https://github.com/vitest-dev/vitest) | 5.0.4 | MIT |

对应许可原文位于 `frontend/node_modules/<包名>/LICENSE*`。Playwright 的 `NOTICE` 包含 Microsoft 版权及其 Puppeteer 衍生代码说明；TypeScript 的 `ThirdPartyNoticeText.txt` 和 Prettier 的 `THIRD-PARTY-NOTICES.md` 另列其内部第三方内容。打包时应保留这些文件中适用的声明。

## 分发范围

桌面安装包另外包含 Electron 44.7.2（MIT 与 Chromium 第三方许可）、CPython 3.11.14（PSF）、Node.js 24.22.0（MIT 与各组件许可）、Chromium、imageio-ffmpeg 0.6.0（Python 包 BSD-2-Clause；其中 FFmpeg 二进制保留其 LGPL/GPL 许可）、psutil 7.2.2（BSD-3-Clause）与 pyserial 3.5（BSD-3-Clause）。构建器收集前端与桌面依赖的完整 LICENSE / NOTICE 到 `td-runtime/licenses`；Python distribution 元数据、Node LICENSE 与浏览器声明随运行时保留。模型权重不包含在桌面安装包中。

锁文件中的传递依赖、安装用 Node.js、Python、测试浏览器，以及使用者接入的模型与素材各自适用其许可。`.tools/`、`.venv/`、`node_modules/`、测试数据和构建产物默认不纳入源码仓库。若后续分发包含这些内容的安装包或前端构建包，应按实际打包内容收集并保留完整许可与 NOTICE；本索引不替代该步骤。

TouchDesigner / Derivative 仅用于描述参照领域；本仓库不因功能对照而取得或授予其商标、程序或素材的权利。

内置三维文字使用 Three.js 示例 Helvetiker 字体，保留 [字体声明](frontend/public/licenses/helvetiker.txt)。cannon-es、react-markdown 和 remark-gfm 声明随前端分发保存在 [public/licenses](frontend/public/licenses/)。这些许可也随 Vite 构建复制。

## 可选本地模型运行环境

本地模型使用独立进程与独立 Python 环境；环境源码、权重和运行缓存不包含在公开 Git 仓库中。安装器克隆固定 revision，保留第三方仓库自己的 LICENSE；模型文件及许可链接列在 [模型清单](backend/local_ai/manifest.json)。这些项目的许可不被 TD Open 的 MIT 许可覆盖。

| 项目 | 许可 / 来源 | 用途 |
| --- | --- | --- |
| [ComfyUI](https://github.com/Comfy-Org/ComfyUI) | GPL-3.0；安装的源码仓库保留完整许可 | 原生工作流执行引擎 |
| [ComfyUI-MelBandRoFormer](https://github.com/kijai/ComfyUI-MelBandRoFormer) | 插件 MIT；权重许可另见原发布页 | 双轨音乐分离 |
| [Demucs](https://github.com/facebookresearch/demucs) | MIT | 四轨音乐分离 |
| [PyTorch](https://github.com/pytorch/pytorch) | BSD-3-Clause；CUDA 组件保留 NVIDIA 条款 | 推理运行环境 |
| [FLUX.2 Klein 4B](https://github.com/black-forest-labs/flux2) | Apache-2.0（4B）；不代表其他 FLUX 型号相同 | 图像生成与编辑 |
| [Z-Image](https://github.com/Tongyi-MAI/Z-Image) | Apache-2.0 | 图像生成与重绘 |
| [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5) | MIT / Apache-2.0，按对应权重仓库许可 | 音乐生成 |
| [Hunyuan3D 2.1](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1) | Hunyuan 社区许可，含使用条件和地域条款 | 三维几何生成 |
| [Wan 2.2](https://github.com/Wan-Video/Wan2.2) | Apache-2.0 | 视频生成 |

复现依赖版本见 [本地环境约束](backend/local_ai/requirements.lock)；完整实际安装清单生成在 `data/local-ai/envs/comfy/requirements.installed.txt`。分发预装环境或权重时需要另行遵守相应许可，不能只附 TD Open 的 MIT 文件。
