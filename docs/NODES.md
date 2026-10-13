# 节点手册

本版提供 **99 个可在浏览器画布中使用的内置节点**：50 TOP、24 CHOP、11 SOP、8 DAT、5 AI 和 1 OUT。另有 1 个仅在 Python API 运行的 `python_scale` 插件示例，不计入画布节点数。

每个内置节点都有对应的浏览器执行实现或真实服务调用入口；AI / MCP 结果需要配置自己的服务后手动运行。这里的节点遵循 TD Open 自己的端口和数据模型，并非 TouchDesigner 同名算子的完整兼容实现。

## 先理解端口

- **TOP** 传递图像；一般连接到 `output` 作为预览和导出的最终画面。
- **CHOP** 传递单个数值（音频输入另带浏览器频谱）；可接到数值运算或画面节点的 `mod` 端口。
- **SOP** 传递几何与场景组描述；通过 `render` 转为图像。
- **DAT** 传递文本，包括 JSON / CSV 文本；通过 `text` 转成画面，或通过 `dat_to_chop` 转成数值。

只有相同类型的端口可以直接相连。单个输入端口接受一条连线，输出可以连接多个目标。`feedback` 在节点内部保存上一帧，图中的一般循环仍会被拒绝。

节点库支持中文名称、英文名称和类型 ID。类型 ID 同时用于项目 JSON、AI 图命令与 MCP。例如「添加随机信号」「add Noise CHOP」和「add noise_chop」都会添加 `noise_chop`。参数类型、默认值和可调范围以编辑器参数面板或 `GET /api/catalog` 为准。

## 可以直接搭建的工作流

1. **几何图案**：`checkerboard → kaleidoscope → feedback → output`。万花筒改变扇区数；反馈改变历史保留比例和每帧旋转角，得到持续拖影。
2. **控制信号**：`beat → counter → range`，把 `range` 接到支持调制的图像节点。计数器在上升沿计数；范围映射把计数转成适合视觉参数的数值。
3. **两件三维物体**：`box → transform_sop` 与 `sphere → transform_sop` 两路接到 `merge_sop`，然后 `render → output`。两个变换节点分别调整位置，合并后保留各自的变换。
4. **表格驱动画面**：`table_dat` 的输出模式选 `cell`，接到 `dat_to_chop → range`，再接画面调制端口。行列从 0 开始；CSV 包含表头时第 1 行才是第一条数据。
5. **处理 AI 文本**：`ai_text → replace_text → text → output`。生成后可以替换内容再绘制成图像；重新生成仍需手动运行 AI 节点。

可直接导入示例：[万花筒与反馈](../examples/kaleidoscope.tdopen.json)、[双物体空间](../examples/geometry-lab.tdopen.json)、[CSV 驱动画面](../examples/data-driven.tdopen.json)。前两个示例打开后播放即可观察；第三个示例修改 CSV 的数值单元格会改变图像角度。运行 `node scripts/export-examples.mjs` 可从源码重新生成全部 8 份示例，节点 ID 保持稳定。

## 运行时和历史状态

浏览器每帧执行图像、几何和信号网络。`lag`、`speed`、`counter`、`trigger`、`derivative`、`hold` 保存各自的历史状态；修改参数或播放时间回退会重置历史。状态以浏览器内存保存，不会在项目 JSON 中序列化。反馈图像也属于运行时帧缓存。

Python `POST /api/evaluate` 支持无状态数值和文本节点、已保存的 AI 文本以及本地 Python 插件。它没有浏览器帧上下文，因此会在 `skipped` 与 `skip_reasons` 中明确列出有状态节点、图像/几何节点和依赖这些节点的下游，而不是伪造计算结果。非法 JSON、未闭合 CSV 引号、零量化步长、零宽度输入范围会报告节点错误，独立分支可以继续计算。

以下「服务端」指可通过 `POST /api/evaluate` 计算；「浏览器」指在实时编辑器执行；「服务」指需要 AI/MCP 服务。`text` 在服务端仅返回输入文本，不绘制图像。

## TOP（50 个）

| 名称 / 类型 ID | 输入 → 输出 | 运行位置 | 用途 |
| --- | --- | --- | --- |
| 流动噪声 / `noise` | mod:CHOP → out:TOP | 浏览器 | 生成有机流动的纹理。调节尺度改变纹理大小，速度控制流动。 |
| 渐变 / `ramp` | — → out:TOP | 浏览器 | 用两种颜色生成平滑渐变，是很多视觉效果的起点。 |
| 形状 / `shape` | — → out:TOP | 浏览器 | 生成圆形或方形，用于制作图案和遮罩。 |
| 图片 / 视频 / `media` | — → out:TOP | 浏览器 | 从本地导入素材，或使用可访问的素材地址。 |
| 色彩调整 / `color` | in:TOP → out:TOP | 浏览器 | 调整输入画面的色相、饱和度和亮度。 |
| 柔光 / `blur` | in:TOP → out:TOP | 浏览器 | 为输入画面增加模糊和柔和的光晕。 |
| 变换 / `transform` | in:TOP、mod:CHOP → out:TOP | 浏览器 | 旋转、缩放、移动输入画面。调制信号会影响旋转。 |
| 画面合成 / `composite` | in:TOP、in2:TOP → out:TOP | 浏览器 | 把两个输入画面以指定方式混合。 |
| 文字画面 / `text` | in:DAT → out:TOP | 浏览器 | 将文字绘制成画面，可与纹理和视频合成。 |
| 频谱画面 / `spectrum` | in:CHOP → out:TOP | 浏览器 | 将音频信号绘制成可视化频谱。 |
| 粒子星环 / `particles` | mod:CHOP → out:TOP | 浏览器 | 生成旋转的空间粒子环。输入音频或波形可驱动环的起伏。 |
| 3D 渲染 / `render` | in:SOP、mod:CHOP → out:TOP | 浏览器 | 用 WebGL 渲染几何体。支持线框、灯光和自动旋转。 |
| 纯色画面 / `solid` | — → out:TOP | 浏览器 | 生成一整张纯色画面，也可调节透明度用于叠加。 |
| 棋盘格 / `checkerboard` | — → out:TOP | 浏览器 | 交替排列两种颜色，常用于检查位移、缩放和纹理映射。 |
| 网格线 / `grid` | — → out:TOP | 浏览器 | 生成可旋转的规则网格，适合背景和透视参考。 |
| 流动条纹 / `stripes` | mod:CHOP → out:TOP | 浏览器 | 生成可旋转的平行条纹；速度和调制信号控制条纹位移。 |
| 圆与椭圆 / `circle` | — → out:TOP | 浏览器 | 生成椭圆，可分别调整宽高、位置和描边宽度；描边为 0 时填充。 |
| 圆角矩形 / `rectangle` | — → out:TOP | 浏览器 | 生成带可调圆角的矩形，可作为卡片、边框和遮罩。 |
| 正多边形 / `polygon` | mod:CHOP → out:TOP | 浏览器 | 生成三角形、六边形等正多边形，调制信号控制旋转。 |
| 星形 / `star` | mod:CHOP → out:TOP | 浏览器 | 交替连接内外顶点生成星形；内半径控制尖角深度。 |
| 径向渐变 / `radial_ramp` | — → out:TOP | 浏览器 | 从中心向外渐变，可制作聚光灯、圆形遮罩和柔和背景。 |
| 扩散圆环 / `rings` | mod:CHOP → out:TOP | 浏览器 | 生成连续扩散的同心圆环，调制信号改变圆环相位。 |
| 波浪线 / `wave` | mod:CHOP → out:TOP | 浏览器 | 绘制随时间流动的正弦曲线，振幅与频率分别控制起伏和密度。 |
| 暗角 / `vignette` | in:TOP → out:TOP | 浏览器 | 逐渐压暗画面边缘，突出中心区域。 |
| 颜色反相 / `invert` | in:TOP → out:TOP | 浏览器 | 把亮色变暗、暗色变亮，可混合原图得到不同强度的负片效果。 |
| 黑白 / `grayscale` | in:TOP → out:TOP | 浏览器 | 按感知亮度转换为黑白画面；比例为 0 时保留原色。 |
| 黑白阈值 / `threshold` | in:TOP → out:TOP | 浏览器 | 按亮度分成黑白两色，柔和度可保留阈值附近的渐变。 |
| 色阶分段 / `posterize` | in:TOP → out:TOP | 浏览器 | 减少每个颜色通道的等级，制作版画和复古图像。 |
| 伽马校正 / `gamma` | in:TOP → out:TOP | 浏览器 | 改变中间亮度且保留黑白端点；大于 1 提亮阴影。 |
| 对比度 / `contrast` | in:TOP → out:TOP | 浏览器 | 以可调中点拉开或压缩明暗差异。 |
| 黑白场 / `levels` | in:TOP → out:TOP | 浏览器 | 设置输入黑白场再映射输出范围，修复灰雾或制作遮罩。 |
| 锐化 / `sharpen` | in:TOP → out:TOP | 浏览器 | 增强像素与四周的差异，提高边缘清晰度。 |
| 边缘检测 / `edge` | in:TOP → out:TOP | 浏览器 | 使用 Sobel 梯度寻找轮廓，输出白色边缘和黑色背景。 |
| 浮雕 / `emboss` | in:TOP → out:TOP | 浏览器 | 按斜向亮度差生成灰底浮雕，角度决定光照方向。 |
| 像素化 / `pixelate` | in:TOP → out:TOP | 浏览器 | 把输入缩成小图再以硬边放大，得到马赛克方块。 |
| 镜像对称 / `mirror` | in:TOP → out:TOP | 浏览器 | 取画面的一半翻折成对称图案，可选择左右、上下或四向。 |
| 万花筒 / `kaleidoscope` | in:TOP、mod:CHOP → out:TOP | 浏览器 | 把输入画面切成扇形并重复镜像，角度可随信号变化。 |
| 重复平铺 / `tile` | in:TOP → out:TOP | 浏览器 | 横向和纵向重复输入画面，可移动平铺起点。 |
| 裁剪放大 / `crop` | in:TOP → out:TOP | 浏览器 | 选择输入的一个矩形区域并铺满输出；X/Y 是裁剪区域左上角。 |
| 适配画幅 / `fit` | in:TOP → out:TOP | 浏览器 | 把输入放进指定宽高比的画框，可完整显示、填满裁切或拉伸。 |
| 翻转 / `flip` | in:TOP → out:TOP | 浏览器 | 翻转整张输入画面；与对称镜像不同，它保留整幅画面内容。 |
| 连续旋转 / `rotate` | in:TOP、mod:CHOP → out:TOP | 浏览器 | 围绕可调中心旋转输入，速度控制自动旋转，调制信号增加角度。 |
| 纹理位移 / `displace` | in:TOP、in2:TOP → out:TOP | 浏览器 | 第二画面的红绿通道控制横纵位移，灰色不偏移；缺少第二画面时保持原图。 |
| 色度抠像 / `chroma_key` | in:TOP → out:TOP | 浏览器 | 把接近目标颜色的区域变为透明，支持绿幕和其他纯色背景。 |
| 亮度遮罩 / `mask` | in:TOP、in2:TOP → out:TOP | 浏览器 | 用第二画面的亮度乘以透明度裁出第一画面；白色显示，黑色隐藏。 |
| 反馈拖影 / `feedback` | in:TOP → out:TOP | 浏览器 | 保留本节点上一帧并叠加当前画面，生成拖影；无需连接循环线路。强度为 0 时清除历史。 |
| 画面切换 / `switch_top` | in:TOP、in2:TOP、mod:CHOP → out:TOP | 浏览器 | 索引 0 显示第一画面，1 显示第二画面，介于其间平滑混合。调制信号叠加到索引。 |
| 画面中转 / `null_top` | in:TOP → out:TOP | 浏览器 | 原样传递画面，用于整理连线并为一个处理阶段命名。 |
| 色差分离 / `rgb_split` | in:TOP → out:TOP | 浏览器 | 把红、蓝通道向相反方向偏移，制作色散和故障视觉。 |
| 画面差值 / `difference` | in:TOP、in2:TOP → out:TOP | 浏览器 | 逐通道比较两张画面的差异，相同的区域变黑，可用于运动检测。 |

## CHOP（24 个）

| 名称 / 类型 ID | 输入 → 输出 | 运行位置 | 用途 |
| --- | --- | --- | --- |
| 波形信号 / `lfo` | — → out:CHOP | 浏览器 + 服务端 | 生成周期变化的数值。连接到调制端口，让画面随时间变化。 |
| 常量 / `constant` | — → out:CHOP | 浏览器 + 服务端 | 输出一个固定数值，用于参数控制。 |
| 数值运算 / `math` | in:CHOP → out:CHOP | 浏览器 + 服务端 | 对输入信号执行加法、乘法或范围限制。 |
| 音频输入 / `audio` | — → out:CHOP | 浏览器 | 读取麦克风音量与频谱。点击工具栏麦克风按钮授权后生效。 |
| 时间 / `time` | — → out:CHOP | 浏览器 + 服务端 | 输出播放时间，速度和偏移适合驱动持续运动。 |
| 节拍脉冲 / `beat` | — → out:CHOP | 浏览器 + 服务端 | 按 BPM 输出 0 / 1 脉冲，可连接计数器或触发器。 |
| 锯齿波 / `saw` | — → out:CHOP | 浏览器 + 服务端 | 周期性地从负振幅线性增长至正振幅。 |
| 方波 / `square` | — → out:CHOP | 浏览器 + 服务端 | 在正负振幅之间切换，脉宽控制高电平持续比例。 |
| 三角波 / `triangle` | — → out:CHOP | 浏览器 + 服务端 | 线性往返变化的信号，适合匀速往复运动。 |
| 随机信号 / `noise_chop` | — → out:CHOP | 浏览器 + 服务端 | 有固定种子的平滑随机数；同一时间始终得到同一数值。 |
| 范围映射 / `range` | in:CHOP → out:CHOP | 浏览器 + 服务端 | 把输入范围转换成目标范围，例如把音量 0–1 映射为角度 0–360。 |
| 数值限幅 / `limit` | in:CHOP → out:CHOP | 浏览器 + 服务端 | 限制、循环或镜像折返输入数值。 |
| 信号平滑 / `lag` | in:CHOP → out:CHOP | 浏览器 | 指数平滑输入跳变。上升和下降可设置不同响应时间。 |
| 数值积分 / `speed` | in:CHOP → out:CHOP | 浏览器 | 将速度随时间积分成位置，回到较早播放时间会重置。 |
| 脉冲计数 / `counter` | in:CHOP → out:CHOP | 浏览器 | 输入向上越过阈值时计数一次，可循环到初值。 |
| 逻辑比较 / `logic` | in:CHOP、in2:CHOP → out:CHOP | 浏览器 + 服务端 | 对输入进行阈值、区间或两路逻辑比较，输出 0 / 1。 |
| 触发包络 / `trigger` | in:CHOP → out:CHOP | 浏览器 | 输入上升穿过阈值时，产生渐入、保持、渐出的包络；再次触发会重新开始。 |
| 信号切换 / `switch_chop` | in:CHOP、in2:CHOP、mod:CHOP → out:CHOP | 浏览器 + 服务端 | 选择第一或第二路信号，调制输入可直接控制选择。 |
| 信号中转 / `null_chop` | in:CHOP → out:CHOP | 浏览器 + 服务端 | 原样传递数值，为复杂网络提供清晰的命名出口。 |
| 正弦运算 / `sine` | in:CHOP → out:CHOP | 浏览器 + 服务端 | 对输入数值取正弦，支持角度或弧度。生成波形可使用 LFO。 |
| 绝对值 / `abs` | in:CHOP → out:CHOP | 浏览器 + 服务端 | 把负数转换成正数，可用于信号整流。 |
| 步进量化 / `quantize` | in:CHOP → out:CHOP | 浏览器 + 服务端 | 把连续数值吸附到固定步长，形成阶梯信号。 |
| 变化速度 / `derivative` | in:CHOP → out:CHOP | 浏览器 | 按实际帧间隔计算输入的变化速度；暂停时保持结果。 |
| 采样保持 / `hold` | in:CHOP、in2:CHOP → out:CHOP | 浏览器 | 触发输入向上越过阈值时记录当前数值，直到下一次触发。 |

## SOP（11 个）

| 名称 / 类型 ID | 输入 → 输出 | 运行位置 | 用途 |
| --- | --- | --- | --- |
| 几何体 / `geometry` | — → out:SOP | 浏览器 | 创建真正的三维网格。连接到 3D 渲染节点得到画面。 |
| 立方体 / `box` | — → out:SOP | 浏览器 | 创建具有独立宽、高、深和网格细分的立方体。 |
| 球体 / `sphere` | — → out:SOP | 浏览器 | 创建可调半径和细分精度的球面网格。 |
| 圆环 / `torus` | — → out:SOP | 浏览器 | 创建圆环，可分别控制主半径与管道半径。 |
| 圆锥 / `cone` | — → out:SOP | 浏览器 | 创建可调底面半径、高度和细分的圆锥。 |
| 圆柱 / `cylinder` | — → out:SOP | 浏览器 | 创建圆柱或截锥，顶部和底部半径可分别调整。 |
| 网格平面 / `plane` | — → out:SOP | 浏览器 | 创建 XY 平面网格，双面渲染便于自由旋转观察。 |
| 圆面 / `circle_sop` | — → out:SOP | 浏览器 | 创建 XY 平面的圆面，细分较低时形成规则多边形。 |
| 空间线段 / `line_sop` | — → out:SOP | 浏览器 | 连接两个三维坐标点，线宽以场景单位设置。 |
| 几何变换 / `transform_sop` | in:SOP、mod:CHOP → out:SOP | 浏览器 | 移动、旋转、缩放输入几何体；可串联变换后再合并。调制输入增加 Y 旋转。 |
| 合并几何体 / `merge_sop` | in:SOP、in2:SOP → out:SOP | 浏览器 | 把两路几何体合并为同一场景组，保留各自的变换。 |

## DAT（8 个）

| 名称 / 类型 ID | 输入 → 输出 | 运行位置 | 用途 |
| --- | --- | --- | --- |
| 文本数据 / `text_dat` | — → out:DAT | 浏览器 + 服务端 | 提供文本、JSON 或提示词，可接到文字画面及文本处理节点。 |
| 拼接文本 / `concatenate` | in:DAT、in2:DAT → out:DAT | 浏览器 + 服务端 | 把两路文本用分隔符连接，未连接时使用备用文本。 |
| 文本替换 / `replace_text` | in:DAT → out:DAT | 浏览器 + 服务端 | 按字面内容替换全部匹配文字；不执行脚本或正则表达式。 |
| 文本格式 / `case_text` | in:DAT → out:DAT | 浏览器 + 服务端 | 转换大小写、去除两端空格，或反转文本字符。 |
| 文本拆分 / `split_text` | in:DAT → out:DAT | 浏览器 + 服务端 | 按分隔符拆分文本，输出 JSON 数组，供 JSON 取值节点读取。 |
| JSON 取值 / `json_select` | in:DAT → out:DAT | 浏览器 + 服务端 | 按点分路径读取 JSON，例如 items.0.name；缺失路径返回备用文本。 |
| CSV 表格 / `table_dat` | in:DAT → out:DAT | 浏览器 + 服务端 | 存储 CSV 文本，也可按零起始行列索引选取单元格；支持引号和单元格内换行。 |
| 文本转数值 / `dat_to_chop` | in:DAT → out:CHOP | 浏览器 + 服务端 | 把文本解析为有限数值，解析失败时使用备用数值。 |

## AI（5 个）

| 名称 / 类型 ID | 输入 → 输出 | 运行位置 | 用途 |
| --- | --- | --- | --- |
| AI 图片 / `ai_image` | — → out:TOP | 服务 | 选择已配置的服务，填写提示词后点击运行。请求只在手动运行时发出。 |
| AI 音乐 / `ai_music` | — → out:CHOP | 服务 | 选择已配置的服务，填写提示词后点击运行。请求只在手动运行时发出。 |
| AI 三维 / `ai_3d` | — → out:SOP | 服务 | 选择已配置的服务，填写提示词后点击运行。请求只在手动运行时发出。 |
| AI 文本 / `ai_text` | — → out:DAT | 服务 | 选择已配置的服务，填写提示词后点击运行。请求只在手动运行时发出。 |
| MCP 工具 / `mcp_tool` | — → out:DAT | 服务 | 调用已连接 MCP 服务器提供的工具。执行前请确认工具用途。 |

## OUT（1 个）

| 名称 / 类型 ID | 输入 → 输出 | 运行位置 | 用途 |
| --- | --- | --- | --- |
| 画面输出 / `output` | in:TOP → — | 浏览器 | 最终画面输出。实时预览和导出使用此节点的结果。 |

## 开发者如何加节点

1. 在 `frontend/src/nodes/visualCatalog.ts` 或 `dataCatalog.ts` 中定义稳定的类型 ID、参数、默认值和端口；领域明显不同时，可以新建目录模块并从 `catalog.ts` 导入。
2. 在 `visual.ts` 或 `dataRuntime.ts` 中实现真实输出。需要 GPU、设备或资源生命周期的节点应通过 `engine.ts` 集成并释放资源。
3. 无状态标量/文本节点如需服务端执行，在 `backend/data_runtime.py` 添加执行逻辑和 `STATELESS_TYPES` 条目。依赖帧历史的节点保持浏览器运行，并明确标记服务端跳过原因。
4. 运行 `node scripts/sync-catalog.mjs` 生成 `backend/operator_catalog.json`，不要重复手写 Python 参数定义。前端构建会自动执行同步；Python 启动不依赖 Node。
5. 验证对应行为和保存/读取，运行目录合同检查；修改服务端与浏览器共有运算时，扩展跨运行时一致性用例。更新这份清单与 [功能矩阵](FEATURE_MATRIX.md)。

本地 Python 插件接口与设备/服务扩展分工见 [架构说明](ARCHITECTURE.md)。参数表达式、命名多通道、子网络、原生设备协议以及完整 GPU 算子体系仍需继续建设。
