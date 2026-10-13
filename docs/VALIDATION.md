# 0.3 Alpha 验收记录

日期：2026-10-13。环境：Linux、Python 3.11、项目内 Node 22.21.1、Chromium 无头浏览器（软件 WebGL）。测试作品、缓存、报告和导出均保存在项目目录内。没有调用付费 AI 服务或真实麦克风；外部生成 API 使用本地模拟 HTTP 服务验证。

## 检查结果

| 检查 | 结果 | 本地产物 |
| --- | --- | --- |
| Python 后端、AI/MCP、跨语言运行与所有公开示例 | **178 项通过** | `data/artifacts/pytest-results.xml` |
| 前端节点、真实几何、引擎和布局 | **112 项通过** | `data/artifacts/frontend-tests.json` |
| 浏览器主流程回归 | **14 项通过**，无 JavaScript 异常 | `data/artifacts/browser-e2e-results.json` |
| 共享分区与拖动合并 | **11 项通过**，无 JavaScript 异常 | `data/artifacts/dock-workspace-results.json` |
| 案例库搜索、分类、打开和实际渲染 | **5 项通过**，无 JavaScript 异常 | `data/artifacts/gallery-browser-results.json` |
| WAV、WebM、GLB 媒体回归 | **7 项通过**，无 JavaScript 异常 | `data/artifacts/media-qa-results.json` |
| 新增 TOP 像素与参数响应 | **47 个节点通过**，含所有参数、缺失输入、异常值、调制和透明度 | `data/artifacts/advanced-visual-report.json` |
| 全部案例的真实引擎执行 | **62 个通过**，AI/MCP 流程仅验证未配置服务时的状态 | `data/artifacts/examples-render-report.json` |
| 节点目录与示例合同 | 205 个内置节点；63 份工程（62 案例 + 空白）校验通过 | 共享清单与 `tests/test_examples.py` |
| TypeScript / 生产构建 / Python wheel | 通过 | `data/artifacts/frontend-build.log`、`python-wheel-build.log` |

API 另注册一个 Python 插件示例 `python_scale`，因此 API 目录数为 206，浏览器内置节点数为 205。公开源代码包含可复现脚本，原始验证报告和私人运行数据不随 Git 提交。构建有 Three.js 分块体积提示，Python 测试有 Starlette/httpx 弃用提示，两者均未导致失败。

## 重点操作与回归

工作台覆盖左右/上下共享分隔线联动、键盘调整、拖入中央合并、四边拆分、活动标签切换、空分组收缩、隐藏恢复、最大化、保存重载与390px窄屏。布局调整保留 Canvas DOM，避免重新创建图形上下文。旧 v1 浮窗状态迁移到 v2 平铺预设，保留隐藏状态。

案例检查验证每条连线类型正确、所有节点均到达唯一输出、参数存在且枚举/范围有效，并在实际 StudioEngine 中运行。生成 62 张图库素材和真实效果总览；AI/MCP 图卡明确写明需要连接服务，未伪造生成图片或模型。音频案例没有声源时不制造假频谱。

引擎检查覆盖：上游失败传播与独立分支继续执行、错误恢复、非有限运算拦截、LFO波形/相位、双输入数学运算、历史节点推进与时间回退、几何变形和阵列、GLB缓存与共享资源释放。几何在序列化前检查展开复杂度，避免嵌套复制先于分配保护造成指数展开。Python和浏览器对高级无状态节点进行了53组交叉对照。

媒体检查实际上传并播放WAV、暂停/恢复音频时钟、录制WebM、重新导入解码/播放/暂停、渲染真实GLB并验证缓存。软件渲染环境中，固定等待1.8秒曾只录到两帧、约0.017秒的视频；测试已改为等待至少3个实际捕获帧且媒体时间跨度达到0.8秒。通过的录像为12帧、4.592秒，不再把固定等待时间当作录制时长证据。

## 复现

在项目根目录使用 Node 22：

```bash
.venv/bin/python -m pytest
npm --prefix frontend test
npm --prefix frontend run build
node scripts/sync-catalog.mjs --check
node scripts/export-examples.mjs
.venv/bin/python scripts/export-node-docs.py
```

在独立终端启动隔离服务：

```bash
TD_PORT=8766 TD_DATA_DIR=.cache/browser-qa ./scripts/start.sh
```

再执行浏览器检查（需要安装 Chromium）：

```bash
export TD_BASE_URL=http://127.0.0.1:8766
export TD_CHROMIUM=/path/to/chromium
node frontend/browser-dock-check.mjs
node frontend/browser-gallery-check.mjs
node frontend/browser-e2e.mjs
TD_MEDIA_QA_DATA_DIR=.cache/browser-qa node frontend/browser-media-check.mjs
node frontend/browser-advanced-visual-check.mjs
node frontend/render-examples.mjs
```

其中后两项自动启停自己的 Vite 服务。`render-examples.mjs` 同时重建公开缩略图和总览。浏览器脚本会创建测试作品、素材和模拟连接，应只对隔离目录运行。

## 尚未验证的范围

未完成每个真实 AI 供应商的计费生成、真实麦克风设备、跨操作系统浏览器、现场装置、4K/60fps或长时间演出稳定性测试。当前节点数量不代表 TouchDesigner 行为兼容率；实际边界见[功能矩阵](FEATURE_MATRIX.md)。
