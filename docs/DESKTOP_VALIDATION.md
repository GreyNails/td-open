# 桌面安装版验证记录

验证源代码：`35b943b31a970ec64cb39acb3936c0d7e7009bf5`。原生构建与安装记录：[GitHub Actions](https://github.com/GreyNails/td-open/actions/runs/38689198114)。最终安装包的报告、工作台截图与 SHA-256 随 [0.6.0 桌面发布](https://github.com/GreyNails/td-open/releases/tag/desktop-v0.6.0) 提供。

| 检查 | Windows x64 | Apple Silicon Mac | Intel Mac |
| --- | --- | --- | --- |
| 实际安装 | EXE 静默安装后运行 | DMG 挂载、复制后运行 | DMG 挂载、复制后运行 |
| 安装路径与用户目录包含中文、空格 | 通过 | 通过 | 通过 |
| 后端原生回归检查 | 32 通过、1 个 POSIX 串口测试跳过 | 33 通过 | 33 通过 |
| 节点入口 / 案例 | 752（含 Python 插件）/ 97（含空白） | 同左 | 同左 |
| 案例另存、上传、Python 计算 | 通过 | 通过 | 通过 |
| 内置 Chromium 实际网页截图 | 通过 | 通过 | 通过 |
| 音频采样 | 峰值 1 | 峰值 1 | 峰值 1 |
| WebGL 2 | SwiftShader 渲染通过 | 默认图形后端通过 | SwiftShader 渲染通过 |
| stdio MCP 初始化、列工具、读取项目 | 通过 | 通过 | 通过 |
| 退出后 Python 后端清理 | 通过 | 通过 | 通过 |
| Mac 应用签名完整性检查 | 不适用 | 临时签名验证通过 | 临时签名验证通过 |

Intel Mac 构建机的默认 Metal / EGL 初始化不可用。为验证无硬件加速环境，安装包补齐了 Chromium 软件渲染所需的 Vulkan 加载库，然后实际创建 WebGL 2 上下文并渲染工作台。软件渲染开关只在验证模式中使用，正常启动仍使用平台默认图形后端。相关上游问题见 [CEF #4230](https://github.com/chromiumembedded/cef/issues/4230)。

没有在 Windows / Mac 重新运行全部大型 AI 模型推理；现有模型推理记录仍来自 [Linux / NVIDIA 验证](LOCAL_AI_VALIDATION.md)。离线音频采样通过不代表人工试听通过，协议回环通过不代表已连接实体 MIDI、串口或专业硬件。Windows 安装包未购买商业代码签名，Mac 安装包尚未经过 Apple 公证；首次打开方法见 [安装说明](DESKTOP.md)。
