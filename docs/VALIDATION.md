# 0.2 Alpha 验收记录

日期：2026-10-13。环境：Linux、Python 3.11、项目内 Node 22.21.1、Chromium 无头浏览器（软件 WebGL）。测试作品、缓存、报告和导出均保存在项目目录内。没有向付费 AI 服务发请求，也没有使用真实麦克风。

## 检查结果

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| Python 后端、供应商与 MCP | **103 项通过** | `data/artifacts/pytest-results.xml` |
| 前端节点、几何、引擎及布局 | **60 项通过** | `data/artifacts/frontend-tests.json` |
| 浏览器主流程回归 | **14 项通过**，无 JavaScript 异常 | `data/artifacts/browser-e2e-results.json` |
| 浏览器媒体回归 | **7 项通过**，无 JavaScript 异常 | `data/artifacts/media-qa-results.json` |
| 自由工作台与新增示例 | **21 项通过**，无 JavaScript 异常 | `data/artifacts/workspace-qa-results.json` |
| 新增 TOP 实际像素检查 | **38 个节点通过**，含参数、调制、缺省输入和异常值 | `data/artifacts/visual-node-check.json` |
| 共享目录与示例 | 99 个内置节点目录一致；8 份示例通过后端校验 | `scripts/sync-catalog.mjs --check`、示例校验 |
| TypeScript 与生产构建 | 通过 | `data/artifacts/frontend-build.log` |
| Python wheel 打包 | 通过，包含 99 节点共享目录与执行模块 | `data/artifacts/python-wheel-build.log` |

后端还有一个独立的 `python_scale` 插件，因此 API 注册数为 100；前端可直接使用的内置节点数为 99。测试原始产物不随 Git 提交，源码保留可复现脚本。本次没有新增第三方依赖；此前 0.1 的依赖审计记录仍保留，不能据此视为本次重新完成实时安全审计。

## 实际操作范围

工作台测试覆盖五个面板分别拖动、缩放、保存和刷新恢复；最大化与 Esc 还原；隐藏和恢复；画布优先布局保留浮动预览；快捷搜索、收藏、自动类型匹配连线；多选复制及内部连线与撤销；取消最后一个选择；右键添加；键盘关闭搜索不误添加节点；870px 与 390px 下完整纵向滚动且无横向溢出。

三个新增示例均在浏览器产生真实像素。CSV 示例另外验证多行编辑通过 DAT → CHOP → TOP 改变实际画面。新增 TOP 检查逐项验证所有参数能够影响输出，反馈节点积累历史且在时间回退时清空。输出总览为 `data/artifacts/visual-node-contact-sheet.png`。

引擎测试覆盖 DAT 到原有文字输出、信号扇出每帧只执行一次、有状态运算的时间推进和重置、错误恢复、嵌套几何变换/合并、场景缓存，以及 GLB 共享资源仅在最后移除时释放。Python 与前端另有 55 组无状态执行一致性检查。

原有主流程检查参数像素变化、自动保存、对话修改预览/应用/撤销、PNG 导出、外部 API/MCP 修改同步、AI 图片模拟 HTTP 生成落盘、素材上传和最小 JSON 导入。媒体回归检查实际 WAV 上传/播放/暂停、WebM 录制与重新导入，以及 GLB 渲染和缓存；具体字节数及像素数见报告。

## 复现

在项目根目录执行：

```bash
export PATH="$PWD/.tools/node-v22.21.1-linux-x64/bin:$PATH"
.venv/bin/python -m pytest
npm --prefix frontend test
npm --prefix frontend run build
node scripts/sync-catalog.mjs --check
```

浏览器测试使用隔离服务；以下端口可自行修改：

```bash
TD_PORT=8766 TD_DATA_DIR=.cache/browser-qa ./scripts/start.sh
# 另一个终端在项目根目录执行：
export PATH="$PWD/.tools/node-v22.21.1-linux-x64/bin:$PATH"
export TD_BASE_URL=http://127.0.0.1:8766
export TD_CHROMIUM=/path/to/chromium
node frontend/browser-workspace-check.mjs
node frontend/browser-e2e.mjs
node frontend/browser-visual-check.mjs
```

主流程与工作台脚本不要同时连接同一个测试数据目录，以免自动保存互相干扰。视觉节点脚本自行启动并关闭临时 Vite。媒体脚本 `frontend/browser-media-check.mjs` 需要 8770 端口的独立服务；使用 `.cache/media-qa` 作为数据目录。测试会创建作品、素材、导出和本机模拟供应商配置，不应连接私人生产数据目录。

## 已知边界

- 不等同于 TouchDesigner 全功能兼容验证；未实现部分列在 [功能矩阵](FEATURE_MATRIX.md)。
- 图像管线固定 640×360；噪声源为 320×180 后上采样。复杂 CPU 像素滤镜可能降低帧率。
- 信号是逐帧标量，没有完整多通道采样模型；Python 不模拟浏览器有状态节点。
- 未验证真实付费服务、真实硬件音频、多显卡或全部操作系统。WebM 不包含音轨，远程媒体取决于格式与跨域许可。
- 异步 AI 生成尚无通用自动轮询。当前应用面向本地单人使用。
- Vite 对 Three.js 的大模块提示仍存在，生产构建成功；Python 测试存在一条上游 Starlette/httpx 弃用提示。
