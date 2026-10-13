# 节点手册

本版提供 **205 个可在浏览器画布中使用的内置节点**：97 TOP、46 CHOP、30 SOP、26 DAT、5 AI 和 1 OUT。另有 1 个仅在 Python API 运行的 `python_scale` 插件示例，不计入画布节点数。

每个内置节点都有对应的浏览器执行实现或真实服务调用入口；AI / MCP 结果需要配置自己的服务后手动运行。这里的节点遵循 TD Open 自己的端口和数据模型，并非 TouchDesigner 同名算子的完整兼容实现。

## 先理解端口

- **TOP** 传递图像；一般连接到 `output` 作为预览和导出的最终画面。
- **CHOP** 传递单个数值（音频输入另带浏览器频谱）；可接到数值运算或画面节点的 `mod` 端口。
- **SOP** 传递几何与场景组描述；通过 `render` 转为图像。
- **DAT** 传递文本，包括 JSON / CSV 文本；通过 `text` 转成画面，或通过 `dat_to_chop` 转成数值。

只有相同类型的端口可以直接相连。单个输入端口接受一条连线，输出可以连接多个目标。`feedback` 在节点内部保存上一帧，图中的一般循环仍会被拒绝。

节点库支持中文名称、英文名称和类型 ID。类型 ID 同时用于项目 JSON、AI 图命令与 MCP。例如「添加随机信号」「add Noise CHOP」和「add noise_chop」都会添加 `noise_chop`。下表列出参数默认值；类型、可调范围与说明以编辑器参数面板或 `GET /api/catalog` 为准。

## 可以直接搭建的工作流

1. **几何图案**：`checkerboard → kaleidoscope → feedback → output`。万花筒改变扇区数；反馈改变历史保留比例和每帧旋转角，得到持续拖影。
2. **控制信号**：`beat → counter → range`，把 `range` 接到支持调制的图像节点。计数器在上升沿计数；范围映射把计数转成适合视觉参数的数值。
3. **两件三维物体**：`box → transform_sop` 与 `sphere → transform_sop` 两路接到 `merge_sop`，然后 `render → output`。两个变换节点分别调整位置，合并后保留各自的变换。
4. **表格驱动画面**：`table_dat` 的输出模式选 `cell`，接到 `dat_to_chop → range`，再接画面调制端口。行列从 0 开始；CSV 包含表头时第 1 行才是第一条数据。
5. **处理 AI 文本**：`ai_text → replace_text → text → output`。生成后可以替换内容再绘制成图像；重新生成仍需手动运行 AI 节点。

可直接导入示例：[万花筒与反馈](../examples/kaleidoscope.tdopen.json)、[双物体空间](../examples/geometry-lab.tdopen.json)、[CSV 驱动画面](../examples/data-driven.tdopen.json)。前两个示例打开后播放即可观察；第三个示例修改 CSV 的数值单元格会改变图像角度。运行 `node scripts/export-examples.mjs` 可从源码重新生成全部 63 份工程（62 个案例 + 1 个空白），节点 ID 保持稳定。

## 运行时和历史状态

浏览器每帧执行图像、几何和信号网络。`lag`、`speed`、`counter`、`trigger`、`derivative`、`hold`、`spring`、`adsr`、`delay_chop`、窗口统计、迟滞与触发信号保存各自的历史状态；修改参数或播放时间回退会重置历史。状态以浏览器内存保存，不会在项目 JSON 中序列化。反馈图像也属于运行时帧缓存。

Python `POST /api/evaluate` 支持无状态数值和文本节点、已保存的 AI 文本以及本地 Python 插件。它没有浏览器帧上下文，因此会在 `skipped` 与 `skip_reasons` 中明确列出有状态节点、图像/几何节点和依赖这些节点的下游，而不是伪造计算结果。非法 JSON、未闭合 CSV 引号、零量化步长、零宽度输入范围会报告节点错误，独立分支可以继续计算。

以下「服务端」指可通过 `POST /api/evaluate` 计算；「浏览器」指在实时编辑器执行；「服务」指需要 AI/MCP 服务。`text` 在服务端仅返回输入文本，不绘制图像。

完整案例见 [案例索引](EXAMPLES.md)。程序纹理、光学效果和大几何网络的执行边界见 [功能矩阵](FEATURE_MATRIX.md)。

## TOP（97 个）

| 名称 / 类型 ID | 输入 → 输出 | 运行位置 | 用途与默认参数 |
| --- | --- | --- | --- |
| 流动噪声 / `noise` | mod:CHOP → out:TOP | 浏览器 | 生成有机流动的纹理。调节尺度改变纹理大小，速度控制流动。<br>`scale=3`；`speed=0.25`；`detail=4`；`seed=1` |
| 渐变 / `ramp` | — → out:TOP | 浏览器 | 用两种颜色生成平滑渐变，是很多视觉效果的起点。<br>`color1=#9c6dff`；`color2=#ff9055`；`angle=45` |
| 形状 / `shape` | — → out:TOP | 浏览器 | 生成圆形或方形，用于制作图案和遮罩。<br>`shape=circle`；`size=0.35`；`color=#b696ff` |
| 图片 / 视频 / `media` | — → out:TOP | 浏览器 | 从本地导入素材，或使用可访问的素材地址。<br>`url=`；`fit=cover` |
| 色彩调整 / `color` | in:TOP → out:TOP | 浏览器 | 调整输入画面的色相、饱和度和亮度。<br>`hue=0`；`saturation=1.2`；`brightness=1.1` |
| 柔光 / `blur` | in:TOP → out:TOP | 浏览器 | 为输入画面增加模糊和柔和的光晕。<br>`radius=8`；`glow=0.5` |
| 变换 / `transform` | in:TOP、mod:CHOP → out:TOP | 浏览器 | 旋转、缩放、移动输入画面。调制信号会影响旋转。<br>`rotate=0`；`scale=1`；`x=0`；`y=0` |
| 画面合成 / `composite` | in:TOP、in2:TOP → out:TOP | 浏览器 | 把两个输入画面以指定方式混合。<br>`mode=screen`；`opacity=0.7` |
| 文字画面 / `text` | in:DAT → out:TOP | 浏览器 / 服务端 | 将文字绘制成画面，可与纹理和视频合成。<br>`text=HELLO, FLOW`；`size=64`；`color=#ffffff` |
| 频谱画面 / `spectrum` | in:CHOP → out:TOP | 浏览器 | 将音频信号绘制成可视化频谱。<br>`bars=64` |
| 粒子星环 / `particles` | mod:CHOP → out:TOP | 浏览器 | 生成旋转的空间粒子环。输入音频或波形可驱动环的起伏。<br>`count=1600`；`speed=0.3`；`size=2`；`color=#c1a2ff`；`spread=1` |
| 3D 渲染 / `render` | in:SOP、mod:CHOP → out:TOP | 浏览器 | 用 WebGL 渲染几何体。支持线框、灯光和自动旋转。<br>`color=#a888ff`；`wireframe=True`；`speed=0.3` |
| 纯色画面 / `solid` | — → out:TOP | 浏览器 | 生成一整张纯色画面，也可调节透明度用于叠加。<br>`color=#b99aff`；`alpha=1` |
| 棋盘格 / `checkerboard` | — → out:TOP | 浏览器 | 交替排列两种颜色，常用于检查位移、缩放和纹理映射。<br>`columns=12`；`rows=7`；`color=#b99aff`；`background=#11121c` |
| 网格线 / `grid` | — → out:TOP | 浏览器 | 生成可旋转的规则网格，适合背景和透视参考。<br>`spacing=40`；`thickness=1`；`angle=0`；`color=#b99aff`；`background=#11121c` |
| 流动条纹 / `stripes` | mod:CHOP → out:TOP | 浏览器 | 生成可旋转的平行条纹；速度和调制信号控制条纹位移。<br>`count=12`；`duty=0.5`；`angle=0`；`speed=0.1`；`color=#b99aff`；`background=#11121c` |
| 圆与椭圆 / `circle` | — → out:TOP | 浏览器 | 生成椭圆，可分别调整宽高、位置和描边宽度；描边为 0 时填充。<br>`width=0.4`；`height=0.7`；`stroke=0`；`x=0.5`；`y=0.5`；`color=#b99aff`；`background=#11121c` |
| 圆角矩形 / `rectangle` | — → out:TOP | 浏览器 | 生成带可调圆角的矩形，可作为卡片、边框和遮罩。<br>`width=0.6`；`height=0.6`；`radius=24`；`stroke=0`；`x=0.5`；`y=0.5`；`color=#b99aff`；`background=#11121c` |
| 正多边形 / `polygon` | mod:CHOP → out:TOP | 浏览器 | 生成三角形、六边形等正多边形，调制信号控制旋转。<br>`sides=6`；`radius=0.38`；`angle=0`；`x=0.5`；`y=0.5`；`color=#b99aff`；`background=#11121c` |
| 星形 / `star` | mod:CHOP → out:TOP | 浏览器 | 交替连接内外顶点生成星形；内半径控制尖角深度。<br>`points=5`；`radius=0.4`；`inner=0.45`；`angle=0`；`x=0.5`；`y=0.5`；`color=#b99aff`；`background=#11121c` |
| 径向渐变 / `radial_ramp` | — → out:TOP | 浏览器 | 从中心向外渐变，可制作聚光灯、圆形遮罩和柔和背景。<br>`color=#fbd6ff`；`background=#201632`；`radius=0.7`；`x=0.5`；`y=0.5` |
| 扩散圆环 / `rings` | mod:CHOP → out:TOP | 浏览器 | 生成连续扩散的同心圆环，调制信号改变圆环相位。<br>`spacing=32`；`thickness=3`；`speed=0.25`；`x=0.5`；`y=0.5`；`color=#b99aff`；`background=#11121c` |
| 波浪线 / `wave` | mod:CHOP → out:TOP | 浏览器 | 绘制随时间流动的正弦曲线，振幅与频率分别控制起伏和密度。<br>`amplitude=0.18`；`frequency=2`；`count=8`；`thickness=2`；`speed=0.25`；`color=#b99aff`；`background=#11121c` |
| 暗角 / `vignette` | in:TOP → out:TOP | 浏览器 | 逐渐压暗画面边缘，突出中心区域。<br>`amount=0.7`；`radius=0.3`；`x=0.5`；`y=0.5` |
| 颜色反相 / `invert` | in:TOP → out:TOP | 浏览器 | 把亮色变暗、暗色变亮，可混合原图得到不同强度的负片效果。<br>`amount=1` |
| 黑白 / `grayscale` | in:TOP → out:TOP | 浏览器 | 按感知亮度转换为黑白画面；比例为 0 时保留原色。<br>`amount=1` |
| 黑白阈值 / `threshold` | in:TOP → out:TOP | 浏览器 | 按亮度分成黑白两色，柔和度可保留阈值附近的渐变。<br>`threshold=0.5`；`softness=0.02` |
| 色阶分段 / `posterize` | in:TOP → out:TOP | 浏览器 | 减少每个颜色通道的等级，制作版画和复古图像。<br>`steps=5` |
| 伽马校正 / `gamma` | in:TOP → out:TOP | 浏览器 | 改变中间亮度且保留黑白端点；大于 1 提亮阴影。<br>`gamma=1.6` |
| 对比度 / `contrast` | in:TOP → out:TOP | 浏览器 | 以可调中点拉开或压缩明暗差异。<br>`amount=1.4`；`pivot=0.5` |
| 黑白场 / `levels` | in:TOP → out:TOP | 浏览器 | 设置输入黑白场再映射输出范围，修复灰雾或制作遮罩。<br>`black=0.05`；`white=0.95`；`gamma=1`；`out_black=0`；`out_white=1` |
| 锐化 / `sharpen` | in:TOP → out:TOP | 浏览器 | 增强像素与四周的差异，提高边缘清晰度。<br>`amount=1` |
| 边缘检测 / `edge` | in:TOP → out:TOP | 浏览器 | 使用 Sobel 梯度寻找轮廓，输出白色边缘和黑色背景。<br>`amount=1`；`threshold=0.05` |
| 浮雕 / `emboss` | in:TOP → out:TOP | 浏览器 | 按斜向亮度差生成灰底浮雕，角度决定光照方向。<br>`amount=1.5`；`angle=0` |
| 像素化 / `pixelate` | in:TOP → out:TOP | 浏览器 | 把输入缩成小图再以硬边放大，得到马赛克方块。<br>`size=12` |
| 镜像对称 / `mirror` | in:TOP → out:TOP | 浏览器 | 取画面的一半翻折成对称图案，可选择左右、上下或四向。<br>`axis=horizontal` |
| 万花筒 / `kaleidoscope` | in:TOP、mod:CHOP → out:TOP | 浏览器 | 把输入画面切成扇形并重复镜像，角度可随信号变化。<br>`segments=8`；`angle=0`；`zoom=1` |
| 重复平铺 / `tile` | in:TOP → out:TOP | 浏览器 | 横向和纵向重复输入画面，可移动平铺起点。<br>`columns=3`；`rows=3`；`x=0`；`y=0` |
| 裁剪放大 / `crop` | in:TOP → out:TOP | 浏览器 | 选择输入的一个矩形区域并铺满输出；X/Y 是裁剪区域左上角。<br>`x=0.2`；`y=0.2`；`width=0.6`；`height=0.6` |
| 适配画幅 / `fit` | in:TOP → out:TOP | 浏览器 | 把输入放进指定宽高比的画框，可完整显示、填满裁切或拉伸。<br>`aspect=1`；`mode=contain`；`background=#11121c` |
| 翻转 / `flip` | in:TOP → out:TOP | 浏览器 | 翻转整张输入画面；与对称镜像不同，它保留整幅画面内容。<br>`axis=horizontal` |
| 连续旋转 / `rotate` | in:TOP、mod:CHOP → out:TOP | 浏览器 | 围绕可调中心旋转输入；速度控制自动旋转，调制信号每增加 1 对应 180°。<br>`angle=0`；`speed=0.05`；`scale=1`；`x=0.5`；`y=0.5` |
| 纹理位移 / `displace` | in:TOP、in2:TOP → out:TOP | 浏览器 | 第二画面的红绿通道控制横纵位移，灰色不偏移；缺少第二画面时保持原图。<br>`x=0.1`；`y=0.1`；`wrap=repeat` |
| 色度抠像 / `chroma_key` | in:TOP → out:TOP | 浏览器 | 把接近目标颜色的区域变为透明，支持绿幕和其他纯色背景。<br>`color=#00ff00`；`tolerance=0.2`；`softness=0.1` |
| 亮度遮罩 / `mask` | in:TOP、in2:TOP → out:TOP | 浏览器 | 用第二画面的亮度乘以透明度裁出第一画面；白色显示，黑色隐藏。<br>`mode=luma`；`invert=0` |
| 反馈拖影 / `feedback` | in:TOP → out:TOP | 浏览器 | 保留本节点上一帧并叠加当前画面，生成拖影；无需连接循环线路。强度为 0 时清除历史。<br>`decay=0.92`；`zoom=1.005`；`angle=0.25`；`input_gain=0.3` |
| 画面切换 / `switch_top` | in:TOP、in2:TOP、mod:CHOP → out:TOP | 浏览器 | 索引 0 显示第一画面，1 显示第二画面，介于其间平滑混合。调制信号叠加到索引。<br>`index=0` |
| 画面中转 / `null_top` | in:TOP → out:TOP | 浏览器 | 原样传递画面，用于整理连线并为一个处理阶段命名。 |
| 色差分离 / `rgb_split` | in:TOP → out:TOP | 浏览器 | 把红、蓝通道向相反方向偏移，制作色散和故障视觉。<br>`distance=8`；`angle=0` |
| 画面差值 / `difference` | in:TOP、in2:TOP → out:TOP | 浏览器 | 逐通道比较两张画面的差异，相同的区域变黑，可用于运动检测。<br>`gain=1` |
| 细胞纹理 / `cellular` | mod:CHOP → out:TOP | 浏览器 | 按最近随机种子点生成细胞距离纹理，可用于水面、石材和分区遮罩。<br>`scale=7`；`seed=3`；`speed=0.15`；`color=#c8a4ff`；`background=#10263e` |
| 分形云噪声 / `fbm_noise` | mod:CHOP → out:TOP | 浏览器 | 叠加多层平滑值噪声，生成连续流动的云雾和地形高度场。<br>`scale=4`；`octaves=4`；`roughness=0.5`；`seed=8`；`speed=0.15`；`color=#c8a4ff`；`background=#10263e` |
| 曼德勃罗分形 / `mandelbrot` | mod:CHOP → out:TOP | 浏览器 | 计算复平面迭代逃逸次数，可平移、缩放和改变迭代精度。<br>`zoom=1`；`x=-0.5`；`y=0`；`iterations=60`；`speed=0.05`；`color=#c8a4ff`；`background=#10263e` |
| 茱莉亚分形 / `julia` | mod:CHOP → out:TOP | 浏览器 | 调整复数常量，探索不同的分形连通结构。<br>`real=-0.7`；`imaginary=0.27`；`zoom=1`；`iterations=60`；`speed=0.05`；`color=#c8a4ff`；`background=#10263e` |
| 摩尔干涉纹 / `moire` | mod:CHOP → out:TOP | 浏览器 | 叠加两个略微旋转的波场，生成干涉拍频图案。<br>`frequency=24`；`angle=12`；`offset=0.15`；`speed=0.15`；`color=#c8a4ff`；`background=#10263e` |
| 螺旋纹理 / `spiral` | mod:CHOP → out:TOP | 浏览器 | 把极角与半径组合成连续螺旋，可控制臂数、扭转和运动。<br>`arms=5`；`twist=8`；`x=0.5`；`y=0.5`；`speed=0.15`；`color=#c8a4ff`；`background=#10263e` |
| 蜂窝网格 / `hex_grid` | mod:CHOP → out:TOP | 浏览器 | 生成等距六边形蜂窝，独立调节网格大小、边线厚度和旋转。<br>`scale=10`；`thickness=0.12`；`angle=0`；`speed=0.05`；`color=#c8a4ff`；`background=#10263e` |
| 融合液滴 / `metaballs` | mod:CHOP → out:TOP | 浏览器 | 多个运动点的势场相互融合，生成具有柔和边缘的液态图形。<br>`count=6`；`size=0.07`；`softness=0.25`；`speed=0.25`；`color=#c8a4ff`；`background=#10263e` |
| 角向渐变 / `conic_gradient` | mod:CHOP → out:TOP | 浏览器 | 围绕中心按极角渐变，可制作旋转色带和角度遮罩。<br>`x=0.5`；`y=0.5`；`angle=0`；`cycles=1`；`speed=0.1`；`color=#c8a4ff`；`background=#10263e` |
| 线性渐变 / `linear_gradient` | mod:CHOP → out:TOP | 浏览器 | 沿任意角度生成可移动的重复线性渐变。<br>`angle=25`；`cycles=1`；`offset=0`；`speed=0.1`；`color=#c8a4ff`；`background=#10263e` |
| 等离子场 / `plasma` | mod:CHOP → out:TOP | 浏览器 | 混合横向、纵向、径向与对角波场，生成流动的有机色块。<br>`scale=4`；`complexity=0.65`；`speed=0.3`；`color=#c8a4ff`；`background=#10263e` |
| 色相旋转 / `hue_shift` | in:TOP → out:TOP | 浏览器 | 在 HSV 空间旋转色相，保留饱和度、明度和透明度。<br>`angle=90` |
| 色彩饱和度 / `saturation` | in:TOP → out:TOP | 浏览器 | 以感知亮度为中心增加或减少颜色饱和度。<br>`amount=1.5` |
| 亮度偏移 / `brightness` | in:TOP → out:TOP | 浏览器 | 给 RGB 通道添加一致亮度偏移。<br>`amount=0.15` |
| 曝光 / `exposure` | in:TOP → out:TOP | 浏览器 | 以摄影曝光档数调整颜色增益，每增加一档亮度翻倍。<br>`stops=1` |
| 复古棕调 / `sepia` | in:TOP → out:TOP | 浏览器 | 以经典棕褐色矩阵处理画面，可混合原始颜色。<br>`amount=0.85` |
| 双色映射 / `duotone` | in:TOP → out:TOP | 浏览器 | 按感知亮度在暗部和亮部两种颜色之间映射。<br>`color=#c8a4ff`；`background=#10263e`；`gamma=1` |
| 日晒负片 / `solarize` | in:TOP → out:TOP | 浏览器 | 把超过阈值的通道反相，形成模拟胶片日晒效果。<br>`threshold=0.5`；`amount=1` |
| 通道色彩平衡 / `color_balance` | in:TOP → out:TOP | 浏览器 | 分别调整红、绿、蓝通道增益，用于校色或风格化。<br>`red=1.2`；`green=1`；`blue=0.8` |
| 通道提取 / `channel_extract` | in:TOP → out:TOP | 浏览器 | 把单个颜色通道、透明度或亮度转换为灰度画面。<br>`channel=red` |
| 通道重排 / `channel_shuffle` | in:TOP → out:TOP | 浏览器 | 交换 RGB 通道位置，可独立选择每一个输出通道的来源。<br>`red=blue`；`green=red`；`blue=green` |
| 亮度抠像 / `luma_key` | in:TOP → out:TOP | 浏览器 | 按亮度生成透明度，可保留亮部或暗部，并控制过渡范围。<br>`threshold=0.45`；`softness=0.15`；`keep=bright` |
| 三点色调曲线 / `color_curve` | in:TOP → out:TOP | 浏览器 | 用暗部、中间调、亮部三个控制点构建连续的颜色映射曲线。<br>`shadows=0.1`；`midtones=0.6`；`highlights=0.95` |
| 色板量化 / `color_quantize` | in:TOP → out:TOP | 浏览器 | 把每个像素映射到色板中距离最近的颜色，用于像素艺术。<br>`palette=neon`；`amount=1` |
| 桶形畸变 / `barrel` | in:TOP → out:TOP | 浏览器 | 按半径改变采样位置，模拟广角镜头桶形或枕形畸变。<br>`amount=0.35`；`x=0.5`；`y=0.5` |
| 漩涡扭曲 / `swirl` | in:TOP → out:TOP | 浏览器 | 围绕中心旋转像素，旋转角度随距离逐渐衰减。<br>`amount=0.7`；`radius=0.75`；`x=0.5`；`y=0.5` |
| 极坐标变换 / `polar` | in:TOP → out:TOP | 浏览器 | 在直角纹理和环形极坐标纹理之间转换。<br>`direction=to_polar`；`angle=0`；`radius=1` |
| 球面凸起 / `bulge` | in:TOP → out:TOP | 浏览器 | 在指定半径内对像素进行球面挤压或膨胀。<br>`amount=0.55`；`radius=0.65`；`x=0.5`；`y=0.5` |
| 正弦波扭曲 / `sine_warp` | in:TOP、mod:CHOP → out:TOP | 浏览器 | 使用互相垂直的正弦波偏移画面，形成可动画的水波扭曲。<br>`amplitude=0.05`；`frequency=5`；`speed=0.3` |
| 数字故障 / `glitch` | in:TOP、mod:CHOP → out:TOP | 浏览器 | 对水平条带进行确定性的随机偏移，并分离红蓝通道。<br>`amount=0.2`；`bands=24`；`seed=2`；`speed=0.4` |
| 扫描线 / `scanlines` | in:TOP、mod:CHOP → out:TOP | 浏览器 | 模拟屏幕扫描条纹，可调节间距、强度和滚动速度。<br>`spacing=4`；`amount=0.55`；`speed=0.1` |
| 半调网点 / `halftone` | in:TOP → out:TOP | 浏览器 | 按局部亮度绘制大小不同的圆形印刷网点。<br>`size=9`；`color=#f4d6ff`；`background=#151529` |
| 有序抖色 / `bayer_dither` | in:TOP → out:TOP | 浏览器 | 使用 4×4 Bayer 阈值矩阵将画面转换为有限灰阶。<br>`levels=2`；`scale=2` |
| 方向模糊 / `directional_blur` | in:TOP → out:TOP | 浏览器 | 沿选定角度平均多个采样，模拟单方向运动拖影。<br>`distance=22`；`angle=30`；`samples=12` |
| 旋转模糊 / `radial_blur` | in:TOP → out:TOP | 浏览器 | 围绕画面中心平均不同旋转角度的采样。<br>`angle=18`；`samples=12`；`x=0.5`；`y=0.5` |
| 径向拉伸模糊 / `zoom_blur` | in:TOP → out:TOP | 浏览器 | 围绕中心叠加多个缩放画面，形成向外扩散的速度感。<br>`amount=0.25`；`samples=12`；`x=0.5`；`y=0.5` |
| 中值去噪 / `median_filter` | in:TOP → out:TOP | 浏览器 | 以邻域中值替换 RGB，去除孤立亮点并保留边缘；在半分辨率执行。<br>`radius=1` |
| 亮部膨胀 / `dilate` | in:TOP → out:TOP | 浏览器 | 取邻域各通道最大值，让亮部区域向外扩张；在半分辨率执行。<br>`radius=2` |
| 亮部侵蚀 / `erode` | in:TOP → out:TOP | 浏览器 | 取邻域各通道最小值，让亮部区域收缩；在半分辨率执行。<br>`radius=2` |
| 透明叠加 / `composite_over` | in:TOP、in2:TOP → out:TOP | 浏览器 | 依据第二画面的透明度叠加到第一画面上。<br>`opacity=0.7` |
| 加色合成 / `composite_add` | in:TOP、in2:TOP → out:TOP | 浏览器 | 相加两个画面的颜色，适合光线与粒子叠加。<br>`opacity=0.7` |
| 正片叠底 / `composite_multiply` | in:TOP、in2:TOP → out:TOP | 浏览器 | 逐通道相乘两个画面，适合阴影和纹理着色。<br>`opacity=0.7` |
| 滤色合成 / `composite_screen` | in:TOP、in2:TOP → out:TOP | 浏览器 | 相乘两个画面的反色，得到柔和的增亮效果。<br>`opacity=0.7` |
| 叠加合成 / `composite_overlay` | in:TOP、in2:TOP → out:TOP | 浏览器 | 根据底图亮度切换正片叠底与滤色，增强局部对比。<br>`opacity=0.7` |
| 变亮合成 / `composite_lighten` | in:TOP、in2:TOP → out:TOP | 浏览器 | 逐通道保留两张图中更亮的颜色。<br>`opacity=0.7` |
| 变暗合成 / `composite_darken` | in:TOP、in2:TOP → out:TOP | 浏览器 | 逐通道保留两张图中更暗的颜色。<br>`opacity=0.7` |
| 透明异或 / `composite_xor` | in:TOP、in2:TOP → out:TOP | 浏览器 | 仅保留两个画面不透明区域不重叠的部分。<br>`opacity=0.7` |

## CHOP（46 个）

| 名称 / 类型 ID | 输入 → 输出 | 运行位置 | 用途与默认参数 |
| --- | --- | --- | --- |
| 波形信号 / `lfo` | — → out:CHOP | 浏览器 / 服务端 | 生成周期变化的数值。连接到调制端口，让画面随时间变化。<br>`wave=sine`；`phase=0`；`frequency=0.3`；`amplitude=1`；`offset=0` |
| 常量 / `constant` | — → out:CHOP | 浏览器 / 服务端 | 输出一个固定数值，用于参数控制。<br>`value=1` |
| 数值运算 / `math` | in:CHOP、in2:CHOP → out:CHOP | 浏览器 / 服务端 | 两路信号执行四则运算、极值或范围限制；第二路未连接时使用运算值。<br>`operation=multiply`；`value=1` |
| 音频输入 / `audio` | — → out:CHOP | 浏览器 | 读取麦克风音量与频谱。点击工具栏麦克风按钮授权后生效。<br>`gain=1`；`url=` |
| 时间 / `time` | — → out:CHOP | 浏览器 / 服务端 | 输出播放时间，速度和偏移适合驱动持续运动。<br>`speed=1`；`offset=0` |
| 节拍脉冲 / `beat` | — → out:CHOP | 浏览器 / 服务端 | 按 BPM 输出 0 / 1 脉冲，可连接计数器或触发器。<br>`bpm=120`；`width=0.1`；`phase=0` |
| 锯齿波 / `saw` | — → out:CHOP | 浏览器 / 服务端 | 周期性地从负振幅线性增长至正振幅。<br>`frequency=1`；`amplitude=1`；`offset=0`；`phase=0` |
| 方波 / `square` | — → out:CHOP | 浏览器 / 服务端 | 在正负振幅之间切换，脉宽控制高电平持续比例。<br>`frequency=1`；`amplitude=1`；`offset=0`；`phase=0`；`width=0.5` |
| 三角波 / `triangle` | — → out:CHOP | 浏览器 / 服务端 | 线性往返变化的信号，适合匀速往复运动。<br>`frequency=1`；`amplitude=1`；`offset=0`；`phase=0` |
| 随机信号 / `noise_chop` | — → out:CHOP | 浏览器 / 服务端 | 有固定种子的平滑随机数；同一时间始终得到同一数值。<br>`frequency=1`；`amplitude=1`；`offset=0`；`seed=1` |
| 范围映射 / `range` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 把输入范围转换成目标范围，例如把音量 0–1 映射为角度 0–360。<br>`in_min=0`；`in_max=1`；`out_min=0`；`out_max=360`；`clamp=True` |
| 数值限幅 / `limit` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 限制、循环或镜像折返输入数值。<br>`min=0`；`max=1`；`mode=clamp` |
| 信号平滑 / `lag` | in:CHOP → out:CHOP | 浏览器 | 指数平滑输入跳变。上升和下降可设置不同响应时间。<br>`rise=0.2`；`fall=0.5` |
| 数值积分 / `speed` | in:CHOP → out:CHOP | 浏览器 | 将速度随时间积分成位置，回到较早播放时间会重置。<br>`scale=1`；`initial=0` |
| 脉冲计数 / `counter` | in:CHOP → out:CHOP | 浏览器 | 输入向上越过阈值时计数一次，可循环到初值。<br>`threshold=0.5`；`step=1`；`initial=0`；`max=16`；`wrap=False` |
| 逻辑比较 / `logic` | in:CHOP、in2:CHOP → out:CHOP | 浏览器 / 服务端 | 对输入进行阈值、区间或两路逻辑比较，输出 0 / 1。<br>`operation=greater`；`value=0.5`；`high=1` |
| 触发包络 / `trigger` | in:CHOP → out:CHOP | 浏览器 | 输入上升穿过阈值时，产生渐入、保持、渐出的包络；再次触发会重新开始。<br>`threshold=0.5`；`attack=0.05`；`hold=0.1`；`release=0.5`；`amplitude=1` |
| 信号切换 / `switch_chop` | in:CHOP、in2:CHOP、mod:CHOP → out:CHOP | 浏览器 / 服务端 | 选择第一或第二路信号，调制输入可直接控制选择。<br>`index=0` |
| 信号中转 / `null_chop` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 原样传递数值，为复杂网络提供清晰的命名出口。 |
| 正弦运算 / `sine` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 对输入数值取正弦，支持角度或弧度。生成波形可使用 LFO。<br>`unit=radians`；`amplitude=1` |
| 绝对值 / `abs` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 把负数转换成正数，可用于信号整流。 |
| 步进量化 / `quantize` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 把连续数值吸附到固定步长，形成阶梯信号。<br>`step=0.25`；`mode=round` |
| 变化速度 / `derivative` | in:CHOP → out:CHOP | 浏览器 | 按实际帧间隔计算输入的变化速度；暂停时保持结果。<br>`scale=1` |
| 采样保持 / `hold` | in:CHOP、in2:CHOP → out:CHOP | 浏览器 | 触发输入向上越过阈值时记录当前数值，直到下一次触发。<br>`threshold=0.5`；`initial=0` |
| 加权求和 / `weighted_sum` | in:CHOP、in2:CHOP、in3:CHOP → out:CHOP | 浏览器 / 服务端 | 对三路数值分配不同权重，再加入偏移；适合组合多个调制来源。<br>`weight1=1`；`weight2=0.5`；`weight3=0.25`；`offset=0` |
| 数值函数 / `function_chop` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 平方根、幂、对数、反三角和双曲正切等非线性运算，错误定义域会明确报错。<br>`function=power`；`exponent=2` |
| 方向角 / `atan2` | in:CHOP、in2:CHOP → out:CHOP | 浏览器 / 服务端 | 根据 X 和 Y 两路数值计算完整四象限方向角。<br>`unit=degrees` |
| 信号混合 / `mix_chop` | in:CHOP、in2:CHOP、mod:CHOP → out:CHOP | 浏览器 / 服务端 | 在两路信号之间线性插值，调制输入可连续控制混合比例。<br>`mix=0.5`；`clamp=True` |
| 缓动曲线 / `ease_chop` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 将 0–1 进度转为动画缓动，支持二次、三次、正弦和弹跳。<br>`curve=sine`；`direction=in_out` |
| 平滑阶跃 / `smoothstep` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 在两条阈值间生成端点斜率为零的平滑过渡。<br>`edge0=0`；`edge1=1`；`smoother=False` |
| 角度循环 / `angle_wrap` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 把角度循环到指定起点与周期内，支持负数。<br>`start=-180`；`period=360` |
| 最短角距离 / `angle_distance` | in:CHOP、in2:CHOP → out:CHOP | 浏览器 / 服务端 | 计算从第一路角度到第二路角度的最短有符号旋转距离。<br>`period=360` |
| 数值步进器 / `sequence_chop` | — → out:CHOP | 浏览器 / 服务端 | 按播放时间依次输出逗号分隔的数值序列，可选择阶梯或线性插值。<br>`values=0,1,0.25,0.75`；`rate=2`；`mode=step` |
| 高斯曲线 / `gaussian_chop` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 按输入与中心的距离输出钟形衰减，适合柔和的空间与时间权重。<br>`center=0`；`sigma=1`；`amplitude=1` |
| 指数衰减 / `exponential_chop` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 对输入时间进行指数衰减，可用于闪光和衰落。<br>`decay=2`；`amplitude=1` |
| 衰减振荡 / `damped_wave` | — → out:CHOP | 浏览器 / 服务端 | 按时间生成带指数衰减的正弦波，可周期重启。<br>`frequency=3`；`decay=1`；`amplitude=1`；`repeat=3` |
| 弹簧跟随 / `spring` | in:CHOP → out:CHOP | 浏览器 | 使用阻尼弹簧连续追随输入目标，会产生可控的惯性与回弹。<br>`frequency=2`；`damping=0.45` |
| 信号延迟 / `delay_chop` | in:CHOP → out:CHOP | 浏览器 | 保存有限时间的历史信号并线性采样过去时刻，最多保留 4096 帧。<br>`delay=0.5`；`initial=0` |
| 移动平均 / `moving_average` | in:CHOP → out:CHOP | 浏览器 | 对最近时间窗口内的样本求平均，平滑抖动信号。<br>`window=1` |
| 峰值追踪 / `peak_chop` | in:CHOP → out:CHOP | 浏览器 | 保留窗口内绝对值最大的样本，适合音量峰值检测。<br>`window=1` |
| 均方根 / `rms_chop` | in:CHOP → out:CHOP | 浏览器 | 计算窗口内信号的均方根能量。<br>`window=1` |
| ADSR 包络 / `adsr` | in:CHOP → out:CHOP | 浏览器 | 门控信号按下时经过起音、衰减与持续阶段，松开时从当前音量释放。<br>`threshold=0.5`；`attack=0.1`；`decay=0.2`；`sustain=0.6`；`release=0.4` |
| 迟滞开关 / `hysteresis` | in:CHOP → out:CHOP | 浏览器 | 分别设置打开与关闭阈值，避免阈值附近的抖动反复触发。<br>`low=0.3`；`high=0.7` |
| 触发随机 / `random_hold` | in:CHOP → out:CHOP | 浏览器 | 每次输入上升穿过阈值时生成一个固定种子的随机值，并保持到下次触发。<br>`threshold=0.5`；`seed=1`；`min=0`；`max=1` |
| 触发计时 / `timer_chop` | in:CHOP → out:CHOP | 浏览器 | 输入上升沿启动计时，输出秒数或 0–1 进度，支持循环。<br>`threshold=0.5`；`duration=2`；`loop=False`；`output=progress` |
| 变化速率限制 / `slew_chop` | in:CHOP → out:CHOP | 浏览器 | 分别限制每秒上升和下降的最大幅度。<br>`rise=1`；`fall=1` |

## SOP（30 个）

| 名称 / 类型 ID | 输入 → 输出 | 运行位置 | 用途与默认参数 |
| --- | --- | --- | --- |
| 几何体 / `geometry` | — → out:SOP | 浏览器 | 创建真正的三维网格。连接到 3D 渲染节点得到画面。<br>`shape=torus`；`detail=32` |
| 立方体 / `box` | — → out:SOP | 浏览器 | 创建具有独立宽、高、深和网格细分的立方体。<br>`width=1.6`；`height=1.6`；`depth=1.6`；`detail=1` |
| 球体 / `sphere` | — → out:SOP | 浏览器 | 创建可调半径和细分精度的球面网格。<br>`radius=1.2`；`detail=32` |
| 圆环 / `torus` | — → out:SOP | 浏览器 | 创建圆环，可分别控制主半径与管道半径。<br>`radius=1`；`tube=0.3`；`detail=32` |
| 圆锥 / `cone` | — → out:SOP | 浏览器 | 创建可调底面半径、高度和细分的圆锥。<br>`radius=1`；`height=2`；`detail=32` |
| 圆柱 / `cylinder` | — → out:SOP | 浏览器 | 创建圆柱或截锥，顶部和底部半径可分别调整。<br>`radius=0.8`；`radius_top=0.8`；`height=2`；`detail=32` |
| 网格平面 / `plane` | — → out:SOP | 浏览器 | 创建 XY 平面网格，双面渲染便于自由旋转观察。<br>`width=2`；`height=2`；`detail=12` |
| 圆面 / `circle_sop` | — → out:SOP | 浏览器 | 创建 XY 平面的圆面，细分较低时形成规则多边形。<br>`radius=1.2`；`detail=32` |
| 空间线段 / `line_sop` | — → out:SOP | 浏览器 | 连接两个三维坐标点，线宽以场景单位设置。<br>`x1=-1`；`y1=0`；`z1=0`；`x2=1`；`y2=0`；`z2=0`；`width=0.025` |
| 几何变换 / `transform_sop` | in:SOP、mod:CHOP → out:SOP | 浏览器 | 移动、旋转、缩放输入几何体；可串联变换后再合并。调制输入增加 Y 旋转。<br>`x=0`；`y=0`；`z=0`；`rx=0`；`ry=0`；`rz=0`；`sx=1`；`sy=1`；`sz=1` |
| 合并几何体 / `merge_sop` | in:SOP、in2:SOP → out:SOP | 浏览器 | 把两路几何体合并为同一场景组，保留各自的变换。 |
| 柏拉图立体 / `platonic_sop` | — → out:SOP | 浏览器 | 生成四面体、八面体、十二面体或二十面体，可进行球面细分。<br>`solid=icosahedron`；`radius=1`；`subdivision=0` |
| 胶囊体 / `capsule` | — → out:SOP | 浏览器 | 生成带半球端部的胶囊网格。<br>`radius=0.5`；`height=1`；`detail=48` |
| 圆环平面 / `ring_sop` | — → out:SOP | 浏览器 | 生成具有内外半径的平面圆环。<br>`inner=0.5`；`outer=1`；`detail=48` |
| 路径管道 / `tube_sop` | — → out:SOP | 浏览器 | 沿 JSON 三维点列表的平滑曲线生成管道。<br>`points=[[-1,-1,0],[0,1,0],[1,-1,0]]`；`tube=0.12`；`detail=48`；`segments=12`；`closed=False` |
| 旋转曲面 / `lathe_sop` | — → out:SOP | 浏览器 | 将 JSON 二维剖面（半径,高度）围绕 Y 轴旋转成曲面。<br>`points=[[0,-1],[0.7,-0.8],[0.35,0],[0.8,0.8],[0.6,1]]`；`detail=48`；`angle=360` |
| 轮廓挤出 / `extrude_sop` | — → out:SOP | 浏览器 | 将二维 JSON 多边形轮廓沿 Z 轴挤出，可添加倒角。<br>`points=[[-1,-0.7],[1,-0.7],[0,1]]`；`depth=0.4`；`bevel=0.05` |
| 螺旋管 / `helix_sop` | — → out:SOP | 浏览器 | 沿空间螺旋曲线生成管状网格。<br>`radius=1`；`height=3`；`turns=3`；`tube=0.08`；`detail=48`；`segments=12` |
| 环面纽结 / `torus_knot` | — → out:SOP | 浏览器 | 使用 P/Q 绕数生成环面纽结，适合复杂线框展示。<br>`radius=1`；`tube=0.18`；`p=2`；`q=3`；`detail=48`；`segments=12` |
| 空间网格 / `grid_sop` | — → out:SOP | 浏览器 | 生成 XZ 地面网格的实体细线，独立控制行列与间距。<br>`rows=8`；`columns=8`；`spacing=0.35`；`width=0.015` |
| 线性阵列 / `copy_sop` | in:SOP → out:SOP | 浏览器 | 沿三维偏移排列多个输入副本，每个副本可以递增旋转和缩放。<br>`count=5`；`x=0.6`；`y=0`；`z=0`；`rotation=20`；`scale=0.9` |
| 环形阵列 / `radial_copy` | in:SOP → out:SOP | 浏览器 | 将输入几何体沿 XZ 平面的圆周排列。<br>`count=12`；`radius=2`；`angle=360`；`orient=True` |
| 随机散布 / `scatter_sop` | in:SOP → out:SOP | 浏览器 | 使用固定种子在三维盒内散布输入副本，附带随机尺寸与旋转。<br>`count=30`；`seed=1`；`width=4`；`height=4`；`depth=4`；`scale_min=0.15`；`scale_max=0.5` |
| 扭曲几何 / `twist_sop` | in:SOP、mod:CHOP → out:SOP | 浏览器 | 按顶点 Y 坐标绕纵轴扭转，细分越高越平滑。<br>`amount=90` |
| 锥化几何 / `taper_sop` | in:SOP、mod:CHOP → out:SOP | 浏览器 | 按顶点 Y 坐标线性改变横向尺寸。<br>`amount=0.4` |
| 波浪变形 / `wave_sop` | in:SOP、mod:CHOP → out:SOP | 浏览器 | 沿 X 轴传播的正弦波改变顶点 Y 坐标，播放时会连续运动。<br>`amplitude=0.25`；`frequency=2`；`speed=1` |
| 几何噪声 / `noise_sop` | in:SOP → out:SOP | 浏览器 | 以连续的三维三角噪声扰动顶点，种子控制不同形态。<br>`amplitude=0.2`；`frequency=2`；`seed=1` |
| 镜像几何 / `mirror_sop` | in:SOP → out:SOP | 浏览器 | 沿一个轴镜像输入，并可保留原始几何体。<br>`axis=x`；`keep=True` |
| 几何边线 / `wireframe_sop` | in:SOP → out:SOP | 浏览器 | 将输入网格转换为真实线段边线，可选择保留三角网格或仅保留硬边。<br>`mode=edges`；`threshold=20` |
| 包围盒 / `bounds_sop` | in:SOP → out:SOP | 浏览器 | 计算输入整体变换后的轴对齐包围盒，输出线框或实体盒。<br>`wireframe=True` |

## AI（5 个）

| 名称 / 类型 ID | 输入 → 输出 | 运行位置 | 用途与默认参数 |
| --- | --- | --- | --- |
| AI 图片 / `ai_image` | — → out:TOP | 服务 | 选择已配置的服务，填写提示词后点击运行。请求只在手动运行时发出。<br>`prompt=`；`provider_id=`；`result_url=`；`result_text=` |
| AI 音乐 / `ai_music` | — → out:CHOP | 服务 | 选择已配置的服务，填写提示词后点击运行。请求只在手动运行时发出。<br>`prompt=`；`provider_id=`；`result_url=`；`result_text=` |
| AI 三维 / `ai_3d` | — → out:SOP | 服务 | 选择已配置的服务，填写提示词后点击运行。请求只在手动运行时发出。<br>`prompt=`；`provider_id=`；`result_url=`；`result_text=` |
| AI 文本 / `ai_text` | — → out:DAT | 服务 | 选择已配置的服务，填写提示词后点击运行。请求只在手动运行时发出。<br>`prompt=`；`provider_id=`；`result_url=`；`result_text=` |
| MCP 工具 / `mcp_tool` | — → out:DAT | 服务 | 调用已连接 MCP 服务器提供的工具。执行前请确认工具用途。<br>`server_id=`；`tool=`；`arguments={}` |

## OUT（1 个）

| 名称 / 类型 ID | 输入 → 输出 | 运行位置 | 用途与默认参数 |
| --- | --- | --- | --- |
| 画面输出 / `output` | in:TOP → — | 浏览器 | 最终画面输出。实时预览和导出使用此节点的结果。 |

## DAT（26 个）

| 名称 / 类型 ID | 输入 → 输出 | 运行位置 | 用途与默认参数 |
| --- | --- | --- | --- |
| 文本数据 / `text_dat` | — → out:DAT | 浏览器 / 服务端 | 提供文本、JSON 或提示词，可接到文字画面及文本处理节点。<br>`text=Hello, TD Open` |
| 拼接文本 / `concatenate` | in:DAT、in2:DAT → out:DAT | 浏览器 / 服务端 | 把两路文本用分隔符连接，未连接时使用备用文本。<br>`text=Hello`；`text2=world`；`separator= ` |
| 文本替换 / `replace_text` | in:DAT → out:DAT | 浏览器 / 服务端 | 按字面内容替换全部匹配文字；不执行脚本或正则表达式。<br>`find=Hello`；`replace=你好` |
| 文本格式 / `case_text` | in:DAT → out:DAT | 浏览器 / 服务端 | 转换大小写、去除两端空格，或反转文本字符。<br>`mode=upper` |
| 文本拆分 / `split_text` | in:DAT → out:DAT | 浏览器 / 服务端 | 按分隔符拆分文本，输出 JSON 数组，供 JSON 取值节点读取。<br>`separator=,`；`trim=True` |
| JSON 取值 / `json_select` | in:DAT → out:DAT | 浏览器 / 服务端 | 按点分路径读取 JSON，例如 items.0.name；缺失路径返回备用文本。<br>`path=name`；`fallback=` |
| CSV 表格 / `table_dat` | in:DAT → out:DAT | 浏览器 / 服务端 | 存储 CSV 文本，也可按零起始行列索引选取单元格；支持引号和单元格内换行。<br>`csv=name,value ↵ alpha,1 ↵ beta,2`；`mode=csv`；`row=1`；`column=1` |
| 文本转数值 / `dat_to_chop` | in:DAT → out:CHOP | 浏览器 / 服务端 | 把文本解析为有限数值，解析失败时使用备用数值。<br>`fallback=0` |
| 文本长度 / `text_length` | in:DAT → out:CHOP | 浏览器 / 服务端 | 按 Unicode 字符、行数或单词数统计文本，输出可用于信号计算。<br>`mode=characters` |
| 文本切片 / `substring_dat` | in:DAT → out:DAT | 浏览器 / 服务端 | 以 Unicode 字符为单位截取文本，负起点从结尾计算。<br>`start=0`；`length=10` |
| 文本补齐 / `pad_dat` | in:DAT → out:DAT | 浏览器 / 服务端 | 向文本左侧或右侧重复补齐指定字符。<br>`length=8`；`fill=0`；`side=left` |
| 文本模板 / `format_dat` | in:DAT、in2:DAT → out:DAT | 浏览器 / 服务端 | 模板中的 {in} 与 {in2} 会替换为对应输入；不会执行代码。<br>`template=第一路：{in} ↵ 第二路：{in2}` |
| 文本编码 / `encode_dat` | in:DAT → out:DAT | 浏览器 / 服务端 | 在 UTF-8 文本与 Base64、URL 编码之间转换。<br>`mode=base64_encode` |
| 文本排序 / `sort_dat` | in:DAT → out:DAT | 浏览器 / 服务端 | 按行或 JSON 数组排序，可启用数值排序和倒序。<br>`format=lines`；`numeric=False`；`descending=False` |
| 文本去重 / `unique_dat` | in:DAT → out:DAT | 浏览器 / 服务端 | 按首次出现顺序去除重复行或 JSON 数组值。<br>`format=lines` |
| 文本筛选 / `filter_dat` | in:DAT → out:DAT | 浏览器 / 服务端 | 保留包含指定文字、指定前缀或后缀的行，支持反选。<br>`query=a`；`mode=contains`；`invert=False` |
| 数组连接 / `join_dat` | in:DAT → out:DAT | 浏览器 / 服务端 | 将 JSON 数组转成带分隔符的文本，对象元素以 JSON 显示。<br>`separator=, ` |
| JSON 合并 / `json_merge` | in:DAT、in2:DAT → out:DAT | 浏览器 / 服务端 | 合并两个 JSON 对象；同名键采用第二路的值。 |
| JSON 写入 / `json_set` | in:DAT → out:DAT | 浏览器 / 服务端 | 通过点分路径更新 JSON 对象的嵌套值，支持数组索引。<br>`path=settings.amount`；`value=1` |
| JSON 键值 / `json_keys` | in:DAT → out:DAT | 浏览器 / 服务端 | 提取对象的键、值或键值对，输出 JSON 数组。<br>`mode=keys` |
| 表格转置 / `table_transpose` | in:DAT → out:DAT | 浏览器 / 服务端 | 交换 CSV 表格的行和列，缺失单元格补为空文本。 |
| 表格选择 / `table_select` | in:DAT → out:DAT | 浏览器 / 服务端 | 按行范围和列索引提取 CSV 子表。<br>`start=0`；`count=10`；`columns=` |
| 表格排序 / `table_sort` | in:DAT → out:DAT | 浏览器 / 服务端 | 按指定 CSV 列稳定排序，可保留表头。<br>`column=1`；`header=True`；`numeric=True`；`descending=False` |
| 表格拼接 / `table_merge` | in:DAT、in2:DAT → out:DAT | 浏览器 / 服务端 | 纵向追加行或横向拼接列，正确保留 CSV 引号和换行。<br>`axis=rows`；`skip_header=True` |
| 表格转对象 / `table_to_json` | in:DAT → out:DAT | 浏览器 / 服务端 | 将 CSV 表头映射成每行对象的键，并可把数字单元格转换为数值。<br>`numeric=True` |
| 数值转文本 / `chop_to_dat` | in:CHOP → out:DAT | 浏览器 / 服务端 | 把数值信号格式化为指定小数位的文本，便于字幕或数据导出。<br>`digits=2`；`prefix=`；`suffix=` |
