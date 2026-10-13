# 0.1 Alpha 验收记录

日期：2026-10-13。环境：Linux、Python 3.11、项目内 Node 22.21.1、Chromium 无头浏览器（软件 WebGL）。所有测试文件、隔离项目、缓存及导出均位于本项目内。没有连接用户的真实麦克风，没有向付费 AI 服务发请求。

## 已通过的检查

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| Python 后端、供应商与 MCP | **76 项通过** | `data/artifacts/pytest-results.xml` |
| 前端节点图单元测试 | **4 项通过** | `data/artifacts/frontend-tests.json` |
| 浏览器主流程 | **14 项通过**，无 JavaScript 异常 | `data/artifacts/browser-e2e-results.json` |
| 浏览器媒体流程 | **7 项通过**，无 JavaScript 异常 | `data/artifacts/media-qa-results.json` |
| TypeScript 检查 + Vite 生产构建 | 通过 | `data/artifacts/frontend-build.log` |
| npm 依赖审计 | 当次审计 **0 个已知漏洞** | `data/artifacts/npm-audit-final.json` |
| Python 依赖一致性 | `pip check` 通过 | 本机执行结果 |

测试原始产物位于被 Git 忽略的 `data/artifacts`；源码仓库保留测试脚本与本记录。不能把这些结果推断为所有系统、显卡或供应商均已兼容。

## 浏览器实际操作

主流程验证了：

1. 修改节点参数后，Canvas 像素实际改变。
2. 保存、重新加载恢复参数。
3. 本地对话指令预览、应用以及撤销。
4. 复制节点以及撤销。
5. PNG 导出实际保存到服务器目录。
6. 在没有未保存本地修改时，同步外部 API / MCP 保存的项目。
7. 三维示例产生实际几何画面并保存。
8. 粒子音画示例在未授权麦克风时也可浏览。
9. 服务配置更新保留已有密钥；列表不返回明文密钥。
10. 图片生成通过本机模拟服务实际走 HTTP；base64 被写成素材文件，返回可读取的本地 URL。
11. 本地图片上传并进入预览。
12. 390px 窄屏没有页面横向溢出。
13. 最小 JSON 图导入时补齐节点默认字段、参数和端口。
14. 全过程未捕获浏览器 JavaScript 异常。

媒体流程另外验证了：

- 352,844 字节测试 WAV 的 UI 上传、资源 URL 持久化、重载及手动播放。
- 暂停时媒体时钟在容差内不前进，AudioContext 暂停；恢复后继续前进。
- Canvas 录制产生 44,893 字节 WebM，文件头及落盘位置正确。
- 上述 WebM 重新导入后可以解码、播放并暂停。
- 简单 GLB 产生 26,989 个有色渲染像素；参数调整中只加载一次资源。
- 没有请求真实麦克风，也没有出现浏览器脚本错误。

Python 测试包含真实本机 MCP stdio 握手和 Streamable HTTP 初始化、鉴权、工具发现、调用、错误处理及会话关闭，另外覆盖图循环/类型、原子写入、路径限制、非法参数、密钥脱敏、生成媒体落盘与失败清理。

## 复现

在项目根目录运行：

```bash
export PATH="$PWD/.tools/node-v22.21.1-linux-x64/bin:$PATH"
.venv/bin/python -m pytest
cd frontend
npm test
npm run build
```

浏览器主流程先在另一个终端启动隔离服务：

```bash
TD_DATA_DIR=.cache/browser-data ./scripts/start.sh
```

再运行：

```bash
cd frontend
# 不设 TD_CHROMIUM 时，使用 Playwright 已安装的默认 Chromium。
TD_CHROMIUM=/path/to/chromium node browser-e2e.mjs
```

媒体脚本 `frontend/browser-media-check.mjs` 使用独立的 8770 端口与 `.cache/media-qa`，其配置方式请查看脚本。测试会创建作品、素材、导出和本机测试供应商配置，不应使用私人生产数据目录。

## 已知限制

- 未验证真实付费音乐/3D/图片/语言服务；供应商响应差异可能需要适配。异步任务尚无通用自动轮询。
- 未验证真实硬件音频输入、多显卡和全部操作系统。当前为本地单人应用。
- 图像管线固定 640×360，噪声 WebGL 源为 320×180 后上采样；WebM 录像不包含音轨。
- 浏览器中下载的远程资源是否可以渲染和导出，仍取决于资源格式与跨域响应头。
- Vite 提示 Three.js 单个压缩前模块超过 500 kB；它已独立分包，不影响构建通过。后续可进一步按需加载。
- 测试出现一条上游 Starlette TestClient 对 `httpx` 的弃用提示，不影响上述验收结果。
- 这不是完整 TouchDesigner 功能兼容测试。未实现部分逐项记录在 [功能矩阵](FEATURE_MATRIX.md)。
