# 节点手册

当前目录含 749 个节点入口：18 AI、128 DAT、205 TOP、213 CHOP、131 SOP、1 OUT、40 COMP、13 MAT。其中 92 个入口需要外部 SDK/设备适配器，不计为内置原生功能。完整逐项映射见 [参考能力清单](reference-capabilities.json)。

浏览器执行实际图像、采样、表格、几何与场景运算；Python 服务提供无状态数据求值、脚本与协议。节点使用同名创作概念，但不是 TouchDesigner 参数/数值/API 兼容声明。脚本必须手动运行，设备与音频权限必须显式启用。下表给出默认参数，范围与说明以界面或共享 JSON 目录为准。

完整案例见 [案例索引](EXAMPLES.md)，实现边界见 [功能矩阵](FEATURE_MATRIX.md)，协议与外部驱动见 [I/O 指南](IO_PROTOCOLS.md)。

## AI（18 个）

| 名称 / 类型 ID | 输入 → 输出 | 运行位置 | 用途与默认参数 |
| --- | --- | --- | --- |
| 本地图片生成 / `local_image` | — → out:TOP | 手动本地 ComfyUI / 模型环境 | 使用本地 FLUX.2 Klein / Z-Image 权重生成图片，手动执行，不需要 API Key。<br>`model_id=flux-klein-4b`；`prompt=A small ceramic robot, white background, studio lighting`；`width=512`；`height=512`；`steps=4`；`cfg=1`；`seed=42`；`result_url=`；`result_text=`；`job_id=`；`outputs_json=`；`result_kind=`；`job_status=` |
| 本地参考图编辑 / `local_image_edit` | image:TOP、image2:TOP → out:TOP | 手动本地 ComfyUI / 模型环境 | FLUX.2 Klein 根据描述编辑一张或两张参考图，支持文生与参考图联合条件。<br>`prompt=A small ceramic robot, white background, studio lighting`；`input_url=`；`reference_url=`；`width=512`；`height=512`；`steps=4`；`seed=42`；`result_url=`；`result_text=`；`job_id=`；`outputs_json=`；`result_kind=`；`job_status=` |
| 本地图像重绘 / `local_image_to_image` | image:TOP → out:TOP | 手动本地 ComfyUI / 模型环境 | Z-Image 对输入图像进行扩散重绘，降噪强度控制改动程度。<br>`prompt=A small ceramic robot, white background, studio lighting`；`input_url=`；`width=512`；`height=512`；`denoise=0.65`；`steps=9`；`seed=42`；`result_url=`；`result_text=`；`job_id=`；`outputs_json=`；`result_kind=`；`job_status=` |
| 本地遮罩修复 / `local_inpaint` | image:TOP、mask:TOP → out:TOP | 手动本地 ComfyUI / 模型环境 | 白色遮罩区域参与重绘，黑色区域保留原图。输入原图和独立灰度遮罩。<br>`prompt=A small ceramic robot, white background, studio lighting`；`input_url=`；`mask_url=`；`width=512`；`height=512`；`denoise=0.8`；`steps=9`；`seed=42`；`result_url=`；`result_text=`；`job_id=`；`outputs_json=`；`result_kind=`；`job_status=` |
| 本地音乐生成 / `local_music` | audio:CHOP → out:CHOP | 手动本地 ComfyUI / 模型环境 | ACE-Step 1.5 Turbo 通过风格描述与歌词生成真实音频；可提供参考音色。<br>`prompt=Warm instrumental electronic music, soft piano, mellow synth bass, steady drums, 120 BPM`；`lyrics=[Instrumental]`；`duration=10`；`bpm=120`；`language=en`；`keyscale=C major`；`generate_audio_codes=False`；`steps=8`；`input_url=`；`seed=42`；`result_url=`；`result_text=`；`job_id=`；`outputs_json=`；`result_kind=`；`job_status=` |
| 本地三维模型生成 / `local_3d` | image:TOP → out:SOP | 手动本地 ComfyUI / 模型环境 | Hunyuan3D 2.1 从参考图生成 GLB 几何网格；该预设不包含纹理绘制。<br>`input_url=`；`steps=30`；`cfg=5`；`resolution=128`；`mesh_threshold=0.6`；`clean_mesh=True`；`seed=42`；`result_url=`；`result_text=`；`job_id=`；`outputs_json=`；`result_kind=`；`job_status=` |
| 本地音乐分轨 / `local_stems` | audio:CHOP → out:CHOP | 手动本地 ComfyUI / 模型环境 | Demucs 四轨（人声/鼓/贝斯/其他）或 MelBand RoFormer 人声/伴奏双轨；所有分轨可下载或单独播放。<br>`model_id=demucs-4`；`input_url=`；`segment=4`；`result_url=`；`result_text=`；`job_id=`；`outputs_json=`；`result_kind=`；`job_status=` |
| 本地视频生成 / `local_video` | image:TOP → out:TOP | 手动本地 ComfyUI / 模型环境 | Wan 2.2 TI2V 5B 支持文生视频和图生视频，使用低显存分块解码。<br>`prompt=A small ceramic robot, white background, studio lighting`；`input_url=`；`width=512`；`height=320`；`frames=17`；`fps=16`；`steps=20`；`cfg=5`；`seed=42`；`result_url=`；`result_text=`；`job_id=`；`outputs_json=`；`result_kind=`；`job_status=` |
| ComfyUI 工作流 / `comfy_workflow` | — → out:any | 手动本地 ComfyUI / 模型环境 | 导入 API 格式工作流，运行当前本地 ComfyUI 中安装的节点，返回全部图片、音频、视频与模型资源。<br>`workflow_json={}`；`output_kind=image`；`result_url=`；`result_text=`；`job_id=`；`outputs_json=`；`result_kind=`；`job_status=` |
| Comfy · 保存图片并返回工作台 / `comfy_save_image` | images:TOP → out:TOP | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI SaveImage；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。<br>`filename_prefix=td_open/image`；`result_url=`；`result_text=`；`job_id=`；`outputs_json=`；`result_kind=`；`job_status=` |
| Comfy · 保存音频并返回工作台 / `comfy_save_audio` | audio:AUDIO → out:CHOP | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI TDOpenSaveWAV；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。<br>`filename_prefix=td_open/audio`；`result_url=`；`result_text=`；`job_id=`；`outputs_json=`；`result_kind=`；`job_status=` |
| Comfy · 保存视频并返回工作台 / `comfy_save_video` | video:VIDEO → out:TOP | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI SaveVideo；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。<br>`filename_prefix=td_open/video`；`format=mp4`；`codec=h264`；`result_url=`；`result_text=`；`job_id=`；`outputs_json=`；`result_kind=`；`job_status=` |
| Comfy · 保存网格并返回工作台 / `comfy_save_mesh` | mesh:MESH → out:SOP | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI SaveGLB；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。<br>`filename_prefix=td_open/mesh`；`result_url=`；`result_text=`；`job_id=`；`outputs_json=`；`result_kind=`；`job_status=` |
| AI 图片 / `ai_image` | — → out:TOP | 服务 | 选择已配置的服务，填写提示词后点击运行。请求只在手动运行时发出。<br>`prompt=`；`provider_id=`；`result_url=`；`result_text=` |
| AI 音乐 / `ai_music` | — → out:CHOP | 服务 | 选择已配置的服务，填写提示词后点击运行。请求只在手动运行时发出。<br>`prompt=`；`provider_id=`；`result_url=`；`result_text=` |
| AI 三维 / `ai_3d` | — → out:SOP | 服务 | 选择已配置的服务，填写提示词后点击运行。请求只在手动运行时发出。<br>`prompt=`；`provider_id=`；`result_url=`；`result_text=` |
| AI 文本 / `ai_text` | — → out:DAT | 服务 | 选择已配置的服务，填写提示词后点击运行。请求只在手动运行时发出。<br>`prompt=`；`provider_id=`；`result_url=`；`result_text=` |
| MCP 工具 / `mcp_tool` | — → out:DAT | 服务 | 调用已连接 MCP 服务器提供的工具。执行前请确认工具用途。<br>`server_id=`；`tool=`；`arguments={}` |

## DAT（128 个）

| 名称 / 类型 ID | 输入 → 输出 | 运行位置 | 用途与默认参数 |
| --- | --- | --- | --- |
| Comfy · 加载检查点 / `comfy_checkpoint` | — → model:MODEL、clip:CLIP、vae:VAE | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI CheckpointLoaderSimple；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。<br>`ckpt_name=` |
| Comfy · 加载扩散模型 / `comfy_unet` | — → model:MODEL | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI UNETLoader；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。<br>`unet_name=`；`weight_dtype=default` |
| Comfy · 加载文本编码器 / `comfy_clip` | — → clip:CLIP | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI CLIPLoader；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。<br>`clip_name=`；`type=lumina2`；`device=cpu` |
| Comfy · 加载双文本编码器 / `comfy_dual_clip` | — → clip:CLIP | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI DualCLIPLoader；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。<br>`clip_name1=`；`clip_name2=`；`type=ace`；`device=cpu` |
| Comfy · 加载 VAE / `comfy_vae_loader` | — → vae:VAE | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI VAELoader；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。<br>`vae_name=` |
| Comfy · LoRA 风格叠加 / `comfy_lora` | model:MODEL、clip:CLIP → model:MODEL、clip:CLIP | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI LoraLoader；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。<br>`lora_name=`；`strength_model=1`；`strength_clip=1` |
| Comfy · 提示词编码 / `comfy_text` | clip:CLIP → conditioning:CONDITIONING | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI CLIPTextEncode；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。<br>`text=` |
| Comfy · 清空负向条件 / `comfy_zero_condition` | conditioning:CONDITIONING → conditioning:CONDITIONING | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI ConditioningZeroOut；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。 |
| Comfy · 空白潜空间（16通道） / `comfy_latent` | — → samples:LATENT | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI EmptySD3LatentImage；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。<br>`width=512`；`height=512`；`batch_size=1` |
| Comfy · 空白潜空间（4通道） / `comfy_sd_latent` | — → samples:LATENT | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI EmptyLatentImage；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。<br>`width=512`；`height=512`；`batch_size=1` |
| Comfy · 扩散采样 / `comfy_sampler` | model:MODEL、positive:CONDITIONING、negative:CONDITIONING、latent_image:LATENT → samples:LATENT | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI KSampler；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。<br>`seed=42`；`steps=20`；`cfg=7`；`sampler_name=euler`；`scheduler=normal`；`denoise=1` |
| Comfy · Flow 模型采样配置 / `comfy_flow_sampling` | model:MODEL → model:MODEL | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI ModelSamplingAuraFlow；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。<br>`shift=3` |
| Comfy · SD3 / Wan 采样配置 / `comfy_sd3_sampling` | model:MODEL → model:MODEL | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI ModelSamplingSD3；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。<br>`shift=8` |
| Comfy · 图像编码 / `comfy_vae_encode` | pixels:TOP、vae:VAE → samples:LATENT | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI VAEEncode；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。 |
| Comfy · 图像解码 / `comfy_vae_decode` | samples:LATENT、vae:VAE → image:TOP | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI VAEDecode；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。 |
| Comfy · 分块解码 / `comfy_vae_decode_tiled` | samples:LATENT、vae:VAE → image:TOP | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI VAEDecodeTiled；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。<br>`tile_size=512`；`overlap=64`；`temporal_size=16`；`temporal_overlap=4` |
| Comfy · 读取工作台图片 / `comfy_image` | — → image:TOP、mask:MASK | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI LoadImage；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。<br>`input_url=` |
| Comfy · 图像转遮罩 / `comfy_mask` | image:TOP → mask:MASK | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI ImageToMask；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。<br>`channel=red` |
| Comfy · 遮罩重绘编码 / `comfy_inpaint_encode` | pixels:TOP、vae:VAE、mask:MASK → samples:LATENT | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI VAEEncodeForInpaint；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。<br>`grow_mask_by=8` |
| Comfy · 潜空间降噪遮罩 / `comfy_latent_mask` | samples:LATENT、mask:MASK → samples:LATENT | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI SetLatentNoiseMask；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。 |
| Comfy · 加载 ControlNet / `comfy_controlnet_loader` | — → control_net:CONTROL_NET | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI ControlNetLoader；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。<br>`control_net_name=` |
| Comfy · 应用 ControlNet / `comfy_controlnet` | positive:CONDITIONING、negative:CONDITIONING、control_net:CONTROL_NET、image:TOP、vae:VAE → positive:CONDITIONING、negative:CONDITIONING | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI ControlNetApplyAdvanced；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。<br>`strength=1`；`start_percent=0`；`end_percent=1` |
| Comfy · 边缘控制图 / `comfy_canny` | image:TOP → image:TOP | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI Canny；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。<br>`low_threshold=0.1`；`high_threshold=0.4` |
| Comfy · 图像缩放 / `comfy_resize` | image:TOP → image:TOP | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI ImageScale；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。<br>`upscale_method=lanczos`；`width=512`；`height=512`；`crop=disabled` |
| Comfy · 加载放大模型 / `comfy_upscale_loader` | — → upscale_model:UPSCALE_MODEL | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI UpscaleModelLoader；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。<br>`model_name=` |
| Comfy · 模型放大图像 / `comfy_upscale` | upscale_model:UPSCALE_MODEL、image:TOP → image:TOP | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI ImageUpscaleWithModel；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。 |
| Comfy · 参考图潜空间条件 / `comfy_reference` | conditioning:CONDITIONING、latent:LATENT → conditioning:CONDITIONING | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI ReferenceLatent；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。 |
| Comfy · 读取工作台音频 / `comfy_audio` | — → audio:AUDIO | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI LoadAudio；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。<br>`input_url=` |
| Comfy · 音频编码 / `comfy_audio_encode` | audio:AUDIO、vae:VAE → samples:LATENT | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI VAEEncodeAudio；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。 |
| Comfy · 音频解码 / `comfy_audio_decode` | samples:LATENT、vae:VAE → audio:AUDIO | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI VAEDecodeAudio；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。 |
| Comfy · 图像帧序列转视频 / `comfy_create_video` | images:TOP、audio:AUDIO → video:VIDEO | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI CreateVideo；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。<br>`fps=24` |
| Comfy · 其他已安装 Comfy 节点 / `comfy_custom` | in:any、in2:any、in3:any、in4:any → out:any、out2:any、out3:any、out4:any | 手动本地 ComfyUI / 模型环境 | 本地 ComfyUI __custom__；连接组成工作流，在保存节点手动运行。模型文件可在本地模型中心查看。<br>`class_type=`；`inputs_json={}`；`input_names=`；`output_index=0`；`is_output=False` |
| DAT 组件输入 / `network_in_dat` | — → out:DAT | 浏览器 | 从所属组件的指定编号输入端口读取数据。根网络无输入时返回空值。<br>`index=1` |
| DAT 组件输出 / `network_out_dat` | in:DAT → out:DAT | 浏览器 | 将内部网络结果输出到组件外部的指定端口。<br>`index=1` |
| DAT 路径引用 / `operator_select_dat` | — → out:DAT | 浏览器 | 通过节点 ID 路径读取算子输出。支持 / 根路径、../ 父级路径以及组件内部路径。循环引用会显示运行错误。<br>`path=` |
| 多点触控 / `browser_multi_touch_in` | — → out:DAT | 浏览器 | 真实浏览器输入；未连接设备时返回空通道。Panel 通过 path 读取组件参数。<br>`keys=Space ArrowLeft ArrowRight`；`path=`；`device=0`；`channel=0`；`velocity=100`；`enabled=False` |
| MIDI 事件 / `browser_midi_event` | — → out:DAT | 浏览器 | 使用 Web MIDI API。点击启用 MIDI 后选择设备索引；输出需要开启 enabled。浏览器和系统必须支持 MIDI。<br>`keys=Space ArrowLeft ArrowRight`；`path=`；`device=0`；`channel=0`；`velocity=100`；`enabled=False` |
| 键盘事件表 / `browser_keyboard_dat` | — → out:DAT | 浏览器 | 读取真实浏览器事件或当前屏幕信息；MIDI需要显式启用，Monitors目前报告当前显示器。<br>`mapping={"volume":[176,7],"note":[144,60]}` |
| MIDI 事件表 / `browser_midi_dat` | — → out:DAT | 浏览器 | 读取真实浏览器事件或当前屏幕信息；MIDI需要显式启用，Monitors目前报告当前显示器。<br>`mapping={"volume":[176,7],"note":[144,60]}` |
| 音频设备列表 / `browser_audio_devices` | — → out:DAT | 浏览器 | 列举浏览器可访问的媒体设备。设备名称是否可见取决于浏览器媒体权限。<br>`mapping={"volume":[176,7],"note":[144,60]}` |
| 视频设备列表 / `browser_video_devices` | — → out:DAT | 浏览器 | 列举浏览器可访问的媒体设备。设备名称是否可见取决于浏览器媒体权限。<br>`mapping={"volume":[176,7],"note":[144,60]}` |
| 屏幕信息 / `browser_monitors` | — → out:DAT | 浏览器 | 读取真实浏览器事件或当前屏幕信息；MIDI需要显式启用，Monitors目前报告当前显示器。<br>`mapping={"volume":[176,7],"note":[144,60]}` |
| Python 脚本 DAT / `python_script_dat` | in:DAT → out:DAT | 手动 Python 服务 | 显式点击运行 Python 才会执行 cook(inputs, time)。使用本机账户权限，支持安装的 Python 包；脚本与日志保存在本项目。返回 TD Open 的通道/表格/网格/图像数据，不支持 TouchDesigner op()/scriptOp 对象。<br>`code=def cook(inputs, time): ↵     return {"kind":"table", "rows":[["name","value"],["time",str(time)],["message","Hello Python"]]}` |
| 媒体文件信息 / `media_file_info` | — → out:DAT | 浏览器 | 点击启用读取音频元信息，输出时长、采样率、通道数、样本数和解码状态。<br>`url=` |
| 原生表格 / `native_table` | — → out:DAT | 浏览器 / 服务端 | CSV 编辑内容转成真正二维表格值，保持空单元格和带引号换行。<br>`csv=name,value ↵ alpha,1 ↵ beta,2` |
| 通道转表格 / `channels_to_dat` | in:CHOP → out:DAT | 浏览器 / 服务端 | 每条通道变为一列，保留名称和完整采样序列。<br>`header=True`；`precision=6` |
| 几何转表格 / `sop_to_dat` | in:SOP → out:DAT | 浏览器 | 将世界坐标顶点转换为含索引和 XYZ 列的表格。<br>`maximum=4096` |
| 选择表格区域 / `native_select` | in:DAT → out:DAT | 浏览器 / 服务端 | 按行范围和任意列索引选择原生表格。<br>`start=0`；`length=100`；`columns=` |
| 重排表格 / `native_reorder` | in:DAT → out:DAT | 浏览器 | 按索引重排指定轴，或者反转所有行或列。<br>`mode=rows`；`indices=0,1` |
| 合并表格 / `native_merge` | in:DAT、in2:DAT → out:DAT | 浏览器 / 服务端 | 按行或列连接原生表格，并保留单元格边界。<br>`mode=rows`；`skip_header=False` |
| 表格转置 / `native_transpose` | in:DAT → out:DAT | 浏览器 / 服务端 | 把原生表格的行列互换，缺失单元格补为空字符串。 |
| 表格排序 / `native_sort` | in:DAT → out:DAT | 浏览器 / 服务端 | 按指定列稳定排序，可选择数字比较和保留表头。<br>`column=0`；`numeric=False`；`descending=False`；`header=True` |
| 插入表格 / `native_insert` | in:DAT、in2:DAT → out:DAT | 浏览器 / 服务端 | 在指定行或列位置插入第二张表格的数据。<br>`mode=rows`；`index=1` |
| 表格键值查找 / `lookup_dat` | in:DAT → out:DAT | 浏览器 / 服务端 | 根据键列精确匹配，返回指定值列或完整匹配行。<br>`key=alpha`；`key_column=0`；`value_column=1` |
| 表格格式转换 / `native_convert` | in:DAT → out:DAT | 浏览器 / 服务端 | 在 CSV、TSV、JSON 二维数组和原生表格之间转换。<br>`mode=table`；`input_format=csv` |
| 表格替换 / `native_substitute` | in:DAT → out:DAT | 浏览器 | 对所有单元格执行字面文本替换或受限长度的正则替换。<br>`search=alpha`；`replacement=A`；`regex=False`；`case_sensitive=True` |
| 切换数据 / `dat_switch` | in:DAT、in2:DAT、mod:CHOP → out:DAT | 浏览器 / 服务端 | 根据参数或 CHOP 选择完整表格或文本输入。<br>`index=0` |
| 数据直通 / `dat_null` | in:DAT → out:DAT | 浏览器 / 服务端 | 保留文本或原生表格的类型和所有单元格。 |
| 数据结构信息 / `dat_info` | in:DAT → out:DAT | 浏览器 / 服务端 | 输出行数、最大列数、单元格数和序列化字符数。 |
| 计算表格表达式 / `dat_evaluate` | in:DAT → out:DAT | 浏览器 / 服务端 | 对每个数值单元格执行安全算式，x 为数值，row/col 为索引。<br>`expression=x*2+row`；`header=True` |
| 检查结构 / `dat_examine` | in:DAT → out:DAT | 浏览器 | 将输入值的字段、类型和内容展开为可读表格。 |
| 数据历史队列 / `dat_fifo` | in:DAT → out:DAT | 浏览器 | 输入变化时追加行，并保存指定容量的历史表格。<br>`capacity=100`；`changes_only=True` |
| 数据片段 / `dat_clip` | in:DAT、index:CHOP → out:DAT | 浏览器 | 按播放时间或输入索引从表格读取一行。<br>`rate=1`；`loop=True` |
| 帧执行事件 / `dat_execute` | — → out:DAT | 浏览器 | 每个不同播放时间生成 frame 事件表；下游可读取事件，不运行隐式脚本。<br>`capacity=64` |
| 信号变化事件 / `dat_chop_execute` | in:CHOP → out:DAT | 浏览器 | 输出通道变化、上升沿和下降沿的事件记录。<br>`mode=change`；`threshold=0.5`；`capacity=64` |
| 表格变化事件 / `dat_dat_execute` | in:DAT → out:DAT | 浏览器 | 原生表格变化时产生包含行列和新旧值的事件表。<br>`capacity=64` |
| 节点网络事件 / `dat_op_execute` | — → out:DAT | 浏览器 | 监听项目节点新增、移除、类型变化并输出事件记录。<br>`capacity=64` |
| 参数变化事件 / `dat_parameter_execute` | — → out:DAT | 浏览器 | 监听指定节点参数，并记录变化前后的值。<br>`node_id=`；`parameter=`；`capacity=64` |
| 参数组事件 / `dat_pargroup_execute` | — → out:DAT | 浏览器 | 监听指定节点参数组，一次变动输出完整分组值。<br>`node_id=`；`parameters=x,y,z`；`capacity=64` |
| 查找节点 / `dat_op_find` | — → out:DAT | 浏览器 | 按类型、名称和 ID 通配符查找当前项目节点。<br>`pattern=*`；`type=*` |
| 参数表格 / `dat_parameter` | — → out:DAT | 浏览器 | 将指定节点的所有参数展开成参数名、值和类型表格。<br>`node_id=` |
| 执行统计表 / `dat_perform` | — → out:DAT | 浏览器 | 输出项目节点数、连接数、播放时间和本节点执行次数。 |
| 数据校验报告 / `dat_error` | in:DAT → out:DAT | 浏览器 | 检查重复表头、行宽不一致、空值和非数字单元格，输出问题位置。<br>`numeric=False`；`header=True` |
| 声明式表格脚本 / `dat_script` | in:DAT → out:DAT | 浏览器 | 用 JSON 操作序列进行筛选、投影、排序和安全单元格计算。<br>`program=[{"op":"select","columns":[0,1]},{"op":"sort","column":0}]` |
| XML 数据 / `xml_dat` | in:DAT → out:DAT | 浏览器 | 将 XML 元素、路径、属性和文本展开成表格；DTD 与外部实体被拒绝。<br>`xml=<scene><item name="cube">1</item><item name="sphere">2</item></scene>`；`tag=` |
| JSON 结构表 / `native_json` | in:DAT → out:DAT | 浏览器 | 解析、选择和更新 JSON 路径，并可将对象数组转换为原生表格。<br>`mode=table`；`path=`；`value=0` |
| 文本与表格编辑 / `native_text` | in:DAT → out:DAT | 浏览器 / 服务端 | 提供独立可编辑文本，连接表格时按指定分隔符排版为文本。<br>`text=Hello TD Open`；`separator=	`；`append=False` |
| 面板交互事件 / `dat_panel_execute` | — → out:DAT | 浏览器 | 监听组件路径的面板值变化，输出变化、按下或松开的事件表；下游消费事件，不运行隐式 Python 回调。<br>`path=`；`values=value,select`；`mode=change`；`capacity=64` |
| 三维拾取表格 / `render_pick_dat` | in:COMP → out:DAT | 浏览器 | 复用真实相机射线拾取，将命中对象、坐标、法线和距离写入二维数据表。<br>`x=0`；`y=0`；`columns=hit,object,tx,ty,tz,nx,ny,nz,distance` |
| Art-Net / `ref_dat_art_net` | in:DAT → out:DAT | 浏览器 | 真实 Art-Net ArtDMX 数据报，1–512 通道，数值范围 0–255。<br>`enabled=False`；`interval=100`；`mode=listen`；`host=127.0.0.1`；`port=6454`；`universe=0` |
| CPlusPlus · 外部桥接 / `ref_dat_cplusplus` | — → out:DAT | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Native C++ compiler + SDK/plugin host adapter; exports portable data over the open bridge, not binary ABI compatibility。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=cpp` |
| EtherDream · 外部桥接 / `ref_dat_etherdream` | — → out:DAT | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Supported Ether Dream / Pangolin DAC SDK, scanner and device interlock。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=laser` |
| File In / `ref_dat_file_in` | — → out:DAT | 浏览器 | 在项目 data/io 内读取 UTF-8 / JSON 数据；CHOP 使用完整多通道 JSON 格式。<br>`enabled=False`；`interval=500`；`path=example.json` |
| File Out / `ref_dat_file_out` | in:DAT → out:DAT | 浏览器 | 在项目 data/io 内写入 UTF-8 / JSON 数据；CHOP 使用完整多通道 JSON 格式。<br>`enabled=False`；`interval=500`；`path=example.json`；`append=False` |
| Folder / `ref_dat_folder` | — → out:DAT | 浏览器 | 读取项目 data/io 内的目录、文件大小和修改时间。<br>`enabled=False`；`interval=500`；`path=` |
| MPCDI · 外部桥接 / `ref_dat_mpcdi` | — → out:DAT | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：MPCDI calibration archive parser and calibrated display pipeline。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=mpcdi` |
| MQTT Client / `ref_dat_mqtt_client` | in:DAT → out:DAT | 浏览器 | 真实 MQTT 3.1.1 客户端：订阅，QoS 0 发布，接收 QoS 0/1 与保留消息。<br>`enabled=False`；`interval=100`；`mode=connect`；`host=127.0.0.1`；`port=1883`；`topic=td-open/#`；`publish_topic=td-open/value` |
| NDI · 外部桥接 / `ref_dat_ndi` | — → out:DAT | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：NDI SDK/runtime, licensed SDK adapter and a reachable NDI source。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=ndi` |
| OSC In / `ref_dat_osc_in` | — → out:DAT | 浏览器 | 真实 OSC 1.0 UDP 消息与 bundle 读取，支持数值、文字、布尔和 blob。TUIO 保留原始地址与参数；Sync 使用开放 OSC 消息。<br>`enabled=False`；`interval=100`；`mode=listen`；`host=127.0.0.1`；`port=9000`；`address=/td-open` |
| OSC Out / `ref_dat_osc_out` | in:DAT → out:DAT | 浏览器 | 真实 OSC 1.0 UDP 消息与 bundle 读取，支持数值、文字、布尔和 blob。TUIO 保留原始地址与参数；Sync 使用开放 OSC 消息。<br>`enabled=False`；`interval=100`；`mode=connect`；`host=127.0.0.1`；`port=9000`；`address=/td-open` |
| Serial / `ref_dat_serial` | in:DAT → out:DAT | 浏览器 | 真实 POSIX 串口 8N1 读写（Linux / macOS）；需要设备权限，按接收字节块输出。<br>`enabled=False`；`interval=100`；`device=/dev/ttyUSB0`；`baud=115200` |
| SocketIO · 外部桥接 / `ref_dat_socketio` | — → out:DAT | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Socket.IO/Engine.IO client adapter; raw WebSocket is a different protocol。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=socketio` |
| TCP/IP / `ref_dat_tcp_ip` | in:DAT → out:DAT | 浏览器 | 真实 TCP 连接与监听，支持换行 / 32 位长度 / 原始流消息边界；Pipe 使用开放 TCP，不兼容私有 Pipe 协议。<br>`enabled=False`；`interval=100`；`mode=listen`；`host=127.0.0.1`；`port=9001`；`framing=newline` |
| Touch In / `ref_dat_touch_in` | — → out:DAT | 浏览器 | 通过 TD Open 开放 JSON 桥接协议交换数据，接收 POST /api/io/bridge/{通道}。Touch 私有网络协议未内置。<br>`enabled=False`；`interval=100`；`channel=td-open` |
| Touch Out / `ref_dat_touch_out` | in:DAT → out:DAT | 浏览器 | 通过 TD Open 开放 JSON 桥接协议交换数据，接收 POST /api/io/bridge/{通道}。Touch 私有网络协议未内置。<br>`enabled=False`；`interval=100`；`channel=td-open` |
| TUIO In / `ref_dat_tuio_in` | — → out:DAT | 浏览器 | 真实 OSC 1.0 UDP 消息与 bundle 读取，支持数值、文字、布尔和 blob。TUIO 保留原始地址与参数；Sync 使用开放 OSC 消息。<br>`enabled=False`；`interval=100`；`mode=listen`；`host=127.0.0.1`；`port=9000`；`address=/tuio/2Dcur` |
| UDP In / `ref_dat_udp_in` | — → out:DAT | 浏览器 | 真实 UDP 文本 / JSON 数据报收发。<br>`enabled=False`；`interval=100`；`mode=listen`；`host=127.0.0.1`；`port=9001` |
| UDP Out / `ref_dat_udp_out` | in:DAT → out:DAT | 浏览器 | 真实 UDP 文本 / JSON 数据报收发。<br>`enabled=False`；`interval=100`；`mode=connect`；`host=127.0.0.1`；`port=9001` |
| Web Client / `ref_dat_web_client` | — → out:DAT | 浏览器 | 发出真实 HTTP 请求，输出状态码、响应头与 JSON / 文本响应。启用后按间隔刷新。<br>`enabled=False`；`interval=100`；`url=http://127.0.0.1:8765/api/health`；`method=GET`；`headers={}` |
| Web Server / `ref_dat_web_server` | in:DAT → out:DAT | 浏览器 | 在当前服务 /api/io/web/{名称} 提供 JSON GET / POST 端点；收到 POST 后更新节点，输入可发布到 GET 响应。<br>`enabled=False`；`interval=100`；`channel=example` |
| WebRTC · 外部桥接 / `ref_dat_webrtc` | — → out:DAT | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：External WebRTC signaling + RTP/codec adapter; this bridge transports decoded frames。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=webrtc` |
| WebSocket / `ref_dat_websocket` | in:DAT → out:DAT | 浏览器 | 真实 RFC 6455 WebSocket 收发文本 / JSON / base64 图像。Video Stream 使用开放逐帧 JSON，不包含 RTSP / RTMP 编解码器。<br>`enabled=False`；`interval=100`；`mode=listen`；`host=127.0.0.1`；`port=9001`；`url=ws://127.0.0.1:9001` |
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

## TOP（205 个）

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
| 3D 渲染 / `render` | in:any、mod:CHOP → out:TOP | 浏览器 | 用 WebGL 渲染几何体。支持线框、灯光和自动旋转。<br>`color=#a888ff`；`wireframe=True`；`speed=0.3` |
| 潮汐声景舞台 / `pointcloud_stage_top` | in:SOP → out:TOP | 浏览器 | 为真实点云提供发光粒子、缓慢运镜、光环与声部指示。点击生成整件作品，再启用音频；音频时钟同步驱动画面。<br>`title=潮汐之像`；`subtitle=TIDAL MUSE · WHERE SOUND BECOMES FORM`；`width=1280`；`height=720`；`point_size=3.2`；`glow=2.1`；`warm=#ffd089`；`cool=#4de0cc`；`accent=#aa80ff`；`volume=0.65` |
| TOP 组件输入 / `network_in_top` | — → out:TOP | 浏览器 | 从所属组件的指定编号输入端口读取数据。根网络无输入时返回空值。<br>`index=1` |
| TOP 组件输出 / `network_out_top` | in:TOP → out:TOP | 浏览器 | 将内部网络结果输出到组件外部的指定端口。<br>`index=1` |
| TOP 路径引用 / `operator_select_top` | — → out:TOP | 浏览器 | 通过节点 ID 路径读取算子输出。支持 / 根路径、../ 父级路径以及组件内部路径。循环引用会显示运行错误。<br>`path=` |
| 摄像头 / `browser_video_device_in` | — → out:TOP | 浏览器 | 点击参数面板中的启用采集，按浏览器提示选择设备。可使用 HTTPS 或 localhost；关闭节点后自动释放设备。<br>`keys=Space ArrowLeft ArrowRight`；`path=`；`device=0`；`channel=0`；`velocity=100`；`enabled=False` |
| 屏幕捕获 / `browser_screen_grab` | — → out:TOP | 浏览器 | 点击参数面板中的启用采集，按浏览器提示选择设备。可使用 HTTPS 或 localhost；关闭节点后自动释放设备。<br>`keys=Space ArrowLeft ArrowRight`；`path=`；`device=0`；`channel=0`；`velocity=100`；`enabled=False` |
| Python 脚本 TOP / `python_script_top` | in:TOP → out:TOP | 手动 Python 服务 | 显式点击运行 Python 才会执行 cook(inputs, time)。使用本机账户权限，支持安装的 Python 包；脚本与日志保存在本项目。返回 TD Open 的通道/表格/网格/图像数据，不支持 TouchDesigner op()/scriptOp 对象。<br>`code=def cook(inputs, time): ↵     import base64, math ↵     width, height = 128, 72 ↵     rgba = bytes(v for y in range(height) for x in range(width) for v in (int(255*x/width),int(255*y/height),160,255)) ↵     return {"kind":"image", "width":width, "height":height, "rgba":base64.b64encode(rgba).decode()}` |
| Analyze / `ref_top_analyze` | in:TOP → out:TOP | 浏览器 | 统计所有像素，输出平均/最大/最小/RMS颜色的单色结果。<br>`operation=average` |
| Anti Alias / `ref_top_anti_alias` | in:TOP → out:TOP | 浏览器 | 通过实际3×3边缘自适应滤波缓和锯齿；不是硬件MSAA。<br>`strength=0.7` |
| Blob Track / `ref_top_blob_track` | in:TOP → out:TOP | 浏览器 | 按亮度阈值查找连通像素区域，绘制包围框、重心和编号。<br>`threshold=0.5`；`min_area=12` |
| Bloom / `ref_top_bloom` | in:TOP → out:TOP | 浏览器 | 提取高亮、模糊并叠加辉光。<br>`threshold=0.5`；`radius=10`；`strength=1` |
| Cache / `ref_top_cache` | in:TOP → out:TOP | 浏览器 | 保存有界的真实图像帧历史；连接Cache Select选择过去的帧。<br>`frames=30`；`offset=0`；`freeze=False` |
| Cache Select / `ref_top_cache_select` | in:TOP → out:TOP | 浏览器 | 从连接的Cache/Time Machine缓冲中选择历史帧。<br>`offset=10` |
| Channel Mix / `ref_top_channel_mix` | in:TOP → out:TOP | 浏览器 | 使用4×4颜色矩阵混合RGBA通道。<br>`matrix=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]` |
| Convolve / `ref_top_convolve` | in:TOP → out:TOP | 浏览器 | 对图像执行可编辑的3×3或5×5卷积核。<br>`kernel=[[0,-1,0],[-1,5,-1],[0,-1,0]]`；`divisor=1`；`bias=0` |
| Corner Pin / `ref_top_corner_pin` | in:TOP → out:TOP | 浏览器 | 通过四角控制计算真实投影单应矩阵。坐标归一化为0–1。<br>`corners=[[0.1,0.15],[0.9,0],[1,1],[0,0.9]]` |
| Function / `ref_top_function` | in:TOP → out:TOP | 浏览器 | 逐颜色通道计算数学函数。<br>`operation=sin`；`scale=1`；`offset=0` |
| GLSL / `ref_top_glsl` | in:TOP、mod:CHOP → out:TOP | 浏览器 | 实际编译并执行WebGL2 GLSL ES 3.00片段着色器，暴露uInput0/uInput1/uTime/uResolution/uMod；不是TD完整shader ABI。<br>`code=#version 300 es ↵ precision highp float; ↵ uniform sampler2D uInput0; ↵ uniform sampler2D uInput1; ↵ uniform vec2 uResolution; ↵ uniform float uTime; ↵ uniform float uMod; ↵ in vec2 vUV; ↵ out vec4 fragColor; ↵ void main(){ ↵   vec4 source=texture(uInput0,vUV); ↵   vec3 waves=0.5+0.5*cos(uTime+vUV.xyx*6.283+vec3(0,2,4)); ↵   fragColor=vec4(mix(waves,source.rgb,source.a*0.65),1.0); ↵ }` |
| GLSL Multi / `ref_top_glsl_multi` | in:TOP、in2:TOP、mod:CHOP → out:TOP | 浏览器 | 实际双输入WebGL2着色器；共享GLSL节点uniform约定，可从两张图采样。<br>`code=#version 300 es ↵ precision highp float; ↵ uniform sampler2D uInput0; ↵ uniform sampler2D uInput1; ↵ uniform vec2 uResolution; ↵ uniform float uTime; ↵ uniform float uMod; ↵ in vec2 vUV; ↵ out vec4 fragColor; ↵ void main(){ ↵   vec4 source=texture(uInput0,vUV); ↵   vec3 waves=0.5+0.5*cos(uTime+vUV.xyx*6.283+vec3(0,2,4)); ↵   fragColor=vec4(mix(source.rgb,texture(uInput1,vUV).rgb,0.5),1.0); ↵ }` |
| HSV to RGB / `ref_top_hsv_to_rgb` | in:TOP → out:TOP | 浏览器 | 按H/S/V图像通道转换为RGB。 |
| RGB to HSV / `ref_top_rgb_to_hsv` | in:TOP → out:TOP | 浏览器 | 将RGB图像编码为H/S/V通道。 |
| Layout / `ref_top_layout` | in:TOP、in2:TOP → out:TOP | 浏览器 | 把两张图排列为水平、垂直或画中画。<br>`mode=horizontal`；`gap=8` |
| Limit / `ref_top_limit` | in:TOP → out:TOP | 浏览器 | 对归一化颜色执行Clamp、Wrap或Mirror区间限制。<br>`mode=clamp`；`min=0.15`；`max=0.85` |
| Lookup / `ref_top_lookup` | in:TOP、in2:TOP → out:TOP | 浏览器 | 将源亮度作为第二张图的横坐标，查找渐变颜色。<br>`row=0.5` |
| Luma Blur / `ref_top_luma_blur` | in:TOP、in2:TOP → out:TOP | 浏览器 | 用第二张图亮度控制局部模糊半径，采用积分图计算可变方框滤波。<br>`radius=12` |
| Luma Level / `ref_top_luma_level` | in:TOP → out:TOP | 浏览器 | 只调整亮度并尽量保持色相，支持亮度增益和偏移。<br>`gain=1.5`；`offset=0` |
| Math / `ref_top_math` | in:TOP、in2:TOP → out:TOP | 浏览器 | 对两张图像执行逐RGB通道数学运算，保留源alpha。<br>`operation=add`；`gain=1`；`offset=0` |
| Normal Map / `ref_top_normal_map` | in:TOP → out:TOP | 浏览器 | 从高度图计算有限差分法线并编码为RGB。<br>`strength=5` |
| Optical Flow / `ref_top_optical_flow` | in:TOP → out:TOP | 浏览器 | 从前后真实图像估计局部Lucas–Kanade光流，RG编码方向、B编码幅度；CPU低分辨率子集。<br>`scale=0.1`；`window=2` |
| Pack / `ref_top_pack` | in:TOP、in2:TOP → out:TOP | 浏览器 | 把两图打包为左右、上下或RG/BA通道，保留采样结果。<br>`mode=rgba` |
| Point Transform / `ref_top_point_transform` | in:TOP → out:TOP | 浏览器 | 将RGB作为归一化XYZ点纹理做旋转、缩放和平移；8位纹理子集。<br>`angle=30`；`scale=1`；`x=0`；`y=0`；`z=0` |
| Projection / `ref_top_projection` | in:TOP → out:TOP | 浏览器 | 在平面/球面/柱面投影之间重采样图像。<br>`mode=sphere`；`rotation=0` |
| Remap / `ref_top_remap` | in:TOP、in2:TOP → out:TOP | 浏览器 | 第二张图RG通道提供源图归一化UV坐标，实现任意图像重映射。<br>`wrap=False` |
| Resolution / `ref_top_resolution` | in:TOP → out:TOP | 浏览器 | 实际创建指定像素尺寸的输出画布，可选最近邻或平滑重采样。<br>`width=320`；`height=180`；`smooth=True` |
| Slope / `ref_top_slope` | in:TOP → out:TOP | 浏览器 | 计算图像亮度的空间X/Y差分或梯度幅度。<br>`mode=magnitude`；`strength=3` |
| Spectrum / `ref_top_spectrum` | in:TOP → out:TOP | 浏览器 | 对图像亮度执行二维FFT（不是音频频谱）。输出幅度/相位，可连接反变换恢复图像。<br>`mode=magnitude`；`size=64`；`gain=0.18` |
| SSAO / `ref_top_ssao` | in:TOP → out:TOP | 浏览器 | 对深度灰度图执行屏幕空间邻域遮蔽估计；输入必须是线性深度，非完整场景G-buffer管线。<br>`radius=5`；`strength=2`；`bias=0.02` |
| Subtract / `ref_top_subtract` | in:TOP、in2:TOP → out:TOP | 浏览器 | 逐RGB通道减去第二张图，保留源alpha。<br>`gain=1` |
| Texture 3D / `ref_top_texture_3d` | in:TOP → out:TOP | 浏览器 | 缓存多个图像切片并以Z轴线性采样组成体纹理的切片视图；CPU切片容器，不是GPU sampler3D。<br>`slices=16`；`z=0.5` |
| Time Machine / `ref_top_time_machine` | in:TOP、in2:TOP → out:TOP | 浏览器 | 按第二张图亮度逐像素选择历史帧，形成时间位移。<br>`frames=30`；`amount=1` |
| Under / `ref_top_under` | in:TOP、in2:TOP → out:TOP | 浏览器 | 将第一张图放在第二张图下方，使用真实alpha合成。 |
| Outside / `ref_top_outside` | in:TOP、in2:TOP → out:TOP | 浏览器 | 保留第一张图位于第二张图alpha以外的部分。 |
| Depth / `ref_top_depth` | in:TOP → out:TOP | 浏览器 | 把输入亮度视作深度样本，按near/far线性化并显示；不伪造三维场景深度。<br>`near=0.1`；`far=100` |
| PreFilter Map / `ref_top_prefilter_map` | in:TOP → out:TOP | 浏览器 | 为环境图生成一排不同粗糙度的模糊预过滤层；CPU近似环境预滤波，不是GGX重要性采样。<br>`levels=6`；`radius=20` |
| Cube Map / `ref_top_cube_map` | in:TOP → out:TOP | 浏览器 | 将经纬度环境图重采样为六面立方体横向图集；2D图集，不冒充GPU cubemap对象。<br>`rotation=0` |
| Point File In / `ref_top_point_file_in` | in:DAT → out:TOP | 浏览器 | 解析CSV/空格XYZ点列表并编码为RGB点纹理；文本参数可从文件DAT上游接入扩展。<br>`points=0.1,0.2,0.3 ↵ 0.5,0.8,0.4 ↵ 0.9,0.3,0.7` |
| Point File Select / `ref_top_point_file_select` | in:TOP → out:TOP | 浏览器 | 从点纹理中按起始索引和数量抽取点。<br>`start=0`；`count=16` |
| CHOP to / `ref_top_chop_to` | in:CHOP → out:TOP | 浏览器 | 把多通道样本写入实际图像像素：每一行对应一个通道、列对应样本。<br>`min=0`；`max=1` |
| Render Pass / `ref_top_render_pass` | in:TOP → out:TOP | 浏览器 | 复用已渲染场景和相机，实际重新渲染颜色/深度/法线pass；当前不支持原软件共享FBO中新几何叠加。<br>`pass=color` |
| Render Select / `ref_top_render_select` | in:TOP → out:TOP | 浏览器 | 读取已渲染场景的颜色/深度/法线附件；当前单相机，不包含多视角或深度剥离层。<br>`pass=depth` |
| Import Select / `ref_top_import_select` | — → out:TOP | 浏览器 | 读取已经导入三维模型的真实材质贴图。模型格式由导入器决定，不是普通节点引用。<br>`parent=`；`texture=map` |
| OP Viewer / `ref_top_op_viewer` | — → out:TOP | 浏览器 | 把指定节点的实际图像、通道曲线或表格文本绘制到TOP。三维预览需要渲染器提供viewer。<br>`source=`；`font_size=14` |
| RGB 范围抠像 / `compat_rgb_key` | in:TOP → out:TOP | 浏览器 | 独立 RGB 上下限及六个柔化宽度，三通道交集生成 Alpha；输出 RGB/Alpha 可分别选择。柔化采用区间外 smoothstep。 当前为 CPU RGBA8 二维图像子集。<br>`red_min=0`；`red_max=1`；`red_soft_low=0`；`red_soft_high=0`；`green_min=0`；`green_max=1`；`green_soft_low=0`；`green_soft_high=0`；`blue_min=0`；`blue_max=1`；`blue_soft_low=0`；`blue_soft_high=0`；`invert=False`；`rgb_output=source`；`alpha_output=multiply_source` |
| 镜头畸变 / `compat_lens_distort` | in:TOP → out:TOP | 浏览器 | Brown–Conrady K1/K2/K3/P1/P2 与主点、焦距。undistort 直接反向采样，distort 用数值求逆；无法收敛的采样透明。不含自动裁切/相机标定/3D 纹理。 当前为 CPU RGBA8 二维图像子集。<br>`k1=0`；`k2=0`；`k3=0`；`p1=0`；`p2=0`；`cx=0.5`；`cy=0.5`；`fx=1`；`fy=1`；`direction=undistort`；`filter=bilinear`；`boundary=clamp` |
| 综合色阶 / `compat_level` | in:TOP → out:TOP | 浏览器 | 单次查找表：输入黑白点 → Gamma → 亮度偏移 → 围绕中心的对比度；Alpha 乘不透明度。不含 TD 多级阶梯与逐通道页。 当前为 CPU RGBA8 二维图像子集。<br>`black=0`；`white=1`；`gamma=1`；`brightness=0`；`contrast=1`；`pivot=0.5`；`opacity=1` |
| RGBA 通道重排 / `compat_reorder` | in:TOP → out:TOP | 浏览器 | RGBA 每个输出通道可选择任一输入通道或常数 0/1；单输入二维图像子集。 当前为 CPU RGBA8 二维图像子集。<br>`r=R`；`g=G`；`b=B`；`a=A` |
| HSV 调色 / `compat_hsv_adjust` | in:TOP → out:TOP | 浏览器 | RGB→HSV→调整→RGB；色相循环，S/V 可选预先 clamp。最终 RGBA8 始终裁切到 0–255；无浮点 HDR 输出。 当前为 CPU RGBA8 二维图像子集。<br>`hue=0`；`saturation=1`；`saturation_offset=0`；`value=1`；`value_offset=0`；`clamp=True` |
| 遮罩合成 / `compat_matte` | in:TOP、in2:TOP、in3:TOP → out:TOP | 浏览器 | 输入 2 遮罩混合输入 1 前景与可选输入 3 背景；支持 Alpha、亮度和独立颜色通道以及反转。直通 Alpha 图像按预乘颜色加权再还原；接口顺序与 TD 不同。 当前为 CPU RGBA8 二维图像子集。<br>`channel=alpha`；`invert=False` |
| 遮罩内部 / `compat_inside` | in:TOP、in2:TOP → out:TOP | 浏览器 | 输入 1 的 RGBA 乘输入 2 所选遮罩；alpha 模式只改变透明度，适合浏览器直通 Alpha。支持反转与亮度遮罩。 当前为 CPU RGBA8 二维图像子集。<br>`channel=alpha`；`invert=False`；`affect=rgba` |
| 可控模糊 / `compat_blur` | in:TOP → out:TOP | 浏览器 | 归一化 Gaussian/Box 可分离卷积及自定义非负奇数核；边界 clamp/mirror/wrap/transparent，透明边界不重归一化。不含运动向量与深度模糊。 当前为 CPU RGBA8 二维图像子集。<br>`method=gaussian`；`radius=3`；`sigma=1.5`；`kernel=[[1,2,1],[2,4,2],[1,2,1]]`；`boundary=clamp`；`premultiply=True` |
| 网页渲染 / `web_render_top` | — → out:TOP | 服务 | 使用独立 Chromium 真正加载网页或 HTML，显式点击捕获截图。支持 CSS 选择器 click/fill/scroll 操作列表；不共享浏览器登录状态。需安装 Node.js、Playwright Chromium。<br>`url=https://example.com`；`html=`；`actions=[]`；`width=640`；`height=360` |
| 视频文件输出 / `movie_file_out_top` | in:TOP → out:TOP | 浏览器 | 通过 MediaRecorder 录制输入画面为 WebM，停止录制后自动保存到本项目 data/exports。支持浏览器的 VP8/VP9，不包含专业硬件视频编解码器。<br>`fps=30` |
| CPlusPlus · 外部桥接 / `ref_top_cplusplus` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Native C++ compiler + SDK/plugin host adapter; exports portable data over the open bridge, not binary ABI compatibility。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=cpp` |
| DirectX In · 外部桥接 / `ref_top_directx_in` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Windows Direct3D shared texture adapter。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=directx` |
| DirectX Out · 外部桥接 / `ref_top_directx_out` | in:TOP → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Windows Direct3D shared texture adapter。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=directx` |
| Kinect · 外部桥接 / `ref_top_kinect` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Microsoft Kinect SDK / libfreenect; a connected Kinect camera。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=kinect` |
| Kinect Azure · 外部桥接 / `ref_top_kinect_azure` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Azure Kinect Sensor SDK + camera; joint data also needs Body Tracking SDK。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=kinect_azure` |
| Kinect Azure Select · 外部桥接 / `ref_top_kinect_azure_select` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Azure Kinect Sensor SDK + camera; joint data also needs Body Tracking SDK。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=kinect_azure` |
| Leap Motion · 外部桥接 / `ref_top_leap_motion` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Ultraleap Tracking SDK + Leap Motion controller。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=leap_motion` |
| MoSys · 外部桥接 / `ref_top_mosys` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Mo-Sys camera tracking protocol/SDK + tracking system。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=mosys` |
| MPCDI · 外部桥接 / `ref_top_mpcdi` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：MPCDI calibration archive parser and calibrated display pipeline。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=mpcdi` |
| Ncam · 外部桥接 / `ref_top_ncam` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Ncam SDK/protocol + licensed tracking system。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=ncam` |
| NDI In · 外部桥接 / `ref_top_ndi_in` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：NDI SDK/runtime, licensed SDK adapter and a reachable NDI source。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=ndi` |
| NDI Out · 外部桥接 / `ref_top_ndi_out` | in:TOP → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：NDI SDK/runtime, licensed SDK adapter and a reachable NDI source。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=ndi` |
| Notch · 外部桥接 / `ref_top_notch` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Notch playback runtime, licensed block and native host adapter。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=notch` |
| Nvidia Background · 外部桥接 / `ref_top_nvidia_background` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：NVIDIA Video Effects/Broadcast/NGX SDK + compatible GPU and native adapter。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=nvidia_rtx` |
| Nvidia Denoise · 外部桥接 / `ref_top_nvidia_denoise` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：NVIDIA Video Effects/Broadcast/NGX SDK + compatible GPU and native adapter。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=nvidia_rtx` |
| Nvidia Flex · 外部桥接 / `ref_top_nvidia_flex` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：NVIDIA FleX SDK + compatible NVIDIA GPU + native solver adapter。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=nvidia_flex` |
| Nvidia Flow · 外部桥接 / `ref_top_nvidia_flow` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：NVIDIA Flow SDK + compatible NVIDIA GPU + native simulation adapter。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=nvidia_flow` |
| Nvidia Upscaler · 外部桥接 / `ref_top_nvidia_upscaler` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：NVIDIA Video Effects/Broadcast/NGX SDK + compatible GPU and native adapter。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=nvidia_rtx` |
| OAK Select · 外部桥接 / `ref_top_oak_select` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Luxonis DepthAI + connected OAK camera。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=oak` |
| Oculus Rift · 外部桥接 / `ref_top_oculus_rift` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Meta/Oculus SDK + supported headset and native runtime。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=oculus` |
| OpenColorIO · 外部桥接 / `ref_top_opencolorio` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：OpenColorIO native runtime + OCIO configuration and GPU transform bridge。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=opencolorio` |
| OpenVR · 外部桥接 / `ref_top_openvr` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：OpenVR/SteamVR runtime + supported headset/controllers。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=openvr` |
| Orbbec · 外部桥接 / `ref_top_orbbec` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Orbbec SDK + connected supported depth camera。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=orbbec` |
| Orbbec Select · 外部桥接 / `ref_top_orbbec_select` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Orbbec SDK + connected supported depth camera。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=orbbec` |
| Ouster · 外部桥接 / `ref_top_ouster` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Ouster SDK + reachable supported LiDAR。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=ouster` |
| Ouster Select · 外部桥接 / `ref_top_ouster_select` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Ouster SDK + reachable supported LiDAR。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=ouster` |
| Photoshop In · 外部桥接 / `ref_top_photoshop_in` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Adobe Photoshop application + UXP/native texture exporter。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=photoshop` |
| RealSense · 外部桥接 / `ref_top_realsense` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Intel librealsense SDK + connected RealSense camera。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=realsense` |
| RenderStream In · 外部桥接 / `ref_top_renderstream_in` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Disguise RenderStream SDK and licensed host。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=renderstream` |
| RenderStream Out · 外部桥接 / `ref_top_renderstream_out` | in:TOP → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Disguise RenderStream SDK and licensed host。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=renderstream` |
| Scalable Display · 外部桥接 / `ref_top_scalable_display` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Scalable Display SDK + licensed calibration data。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=scalable` |
| Shared Mem In / `ref_top_shared_mem_in` | — → out:TOP | 浏览器 | 通过项目 data/io/sharedmem 中的 mmap 文件交换 JSON / 图像。开放格式，不兼容 TouchDesigner 专有共享内存 ABI。<br>`enabled=False`；`interval=100`；`channel=td-open` |
| Shared Mem Out / `ref_top_shared_mem_out` | in:TOP → out:TOP | 浏览器 | 通过项目 data/io/sharedmem 中的 mmap 文件交换 JSON / 图像。开放格式，不兼容 TouchDesigner 专有共享内存 ABI。<br>`enabled=False`；`interval=100`；`channel=td-open` |
| STICK · 外部桥接 / `ref_top_stick` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：STICK sensor/controller protocol and connected device adapter。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=stick` |
| Stype · 外部桥接 / `ref_top_stype` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：stYpe tracking protocol/SDK + tracking system。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=stype` |
| Substance · 外部桥接 / `ref_top_substance` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Adobe Substance Automation Toolkit/Engine + licensed .sbsar material。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=substance` |
| Substance Select · 外部桥接 / `ref_top_substance_select` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Adobe Substance Automation Toolkit/Engine + licensed .sbsar material。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=substance` |
| Syphon Spout In · 外部桥接 / `ref_top_syphon_spout_in` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Windows Spout2 or macOS Syphon native texture sharing adapter。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=spout_syphon` |
| Syphon Spout Out · 外部桥接 / `ref_top_syphon_spout_out` | in:TOP → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Windows Spout2 or macOS Syphon native texture sharing adapter。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=spout_syphon` |
| Touch In / `ref_top_touch_in` | — → out:TOP | 浏览器 | 通过 TD Open 开放 JSON 桥接协议交换数据，接收 POST /api/io/bridge/{通道}。Touch 私有网络协议未内置。<br>`enabled=False`；`interval=100`；`channel=td-open` |
| Touch Out / `ref_top_touch_out` | in:TOP → out:TOP | 浏览器 | 通过 TD Open 开放 JSON 桥接协议交换数据，接收 POST /api/io/bridge/{通道}。Touch 私有网络协议未内置。<br>`enabled=False`；`interval=100`；`channel=td-open` |
| Video Device Out · 外部桥接 / `ref_top_video_device_out` | in:TOP → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Native video output SDK (DeckLink/AJA/V4L2) and connected output device。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=video_output` |
| Video Stream In / `ref_top_video_stream_in` | — → out:TOP | 浏览器 | 真实 RFC 6455 WebSocket 收发文本 / JSON / base64 图像。Video Stream 使用开放逐帧 JSON，不包含 RTSP / RTMP 编解码器。<br>`enabled=False`；`interval=100`；`mode=listen`；`host=127.0.0.1`；`port=9001`；`url=ws://127.0.0.1:9001` |
| Video Stream Out / `ref_top_video_stream_out` | in:TOP → out:TOP | 浏览器 | 真实 RFC 6455 WebSocket 收发文本 / JSON / base64 图像。Video Stream 使用开放逐帧 JSON，不包含 RTSP / RTMP 编解码器。<br>`enabled=False`；`interval=100`；`mode=connect`；`host=127.0.0.1`；`port=9001`；`url=ws://127.0.0.1:9001` |
| Vioso · 外部桥接 / `ref_top_vioso` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：VIOSO SDK + licensed calibration data。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=vioso` |
| ZED · 外部桥接 / `ref_top_zed` | — → out:TOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Stereolabs ZED SDK + CUDA + connected ZED camera。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=zed` |
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

## CHOP（213 个）

| 名称 / 类型 ID | 输入 → 输出 | 运行位置 | 用途与默认参数 |
| --- | --- | --- | --- |
| 波形信号 / `lfo` | — → out:CHOP | 浏览器 / 服务端 | 生成周期变化的数值。连接到调制端口，让画面随时间变化。<br>`wave=sine`；`phase=0`；`frequency=0.3`；`amplitude=1`；`offset=0` |
| 常量 / `constant` | — → out:CHOP | 浏览器 / 服务端 | 输出一个固定数值，用于参数控制。<br>`value=1` |
| 数值运算 / `math` | in:CHOP、in2:CHOP → out:CHOP | 浏览器 / 服务端 | 两路信号执行四则运算、极值或范围限制；第二路未连接时使用运算值。<br>`operation=multiply`；`value=1` |
| 音频输入 / `audio` | — → out:CHOP | 浏览器 | 读取麦克风音量与频谱。点击工具栏麦克风按钮授权后生效。<br>`gain=1`；`url=` |
| 读取独立分轨 / `stem_track_chop` | in:CHOP → out:CHOP | 浏览器 | 从上游本地分轨任务中解析指定声部，使用完整 WAV 的真实 PCM；在声景舞台一次启用所有轨道。<br>`track=vocals`；`samples=2048` |
| 音乐能量与瞬态 / `audio_envelope_chop` | in:CHOP → out:CHOP | 浏览器 | 从真实声部 PCM 计算 RMS 与瞬态；按该声部的整体能量自适应归一化，并使用攻击 / 释放平滑。静音输出零。<br>`gain=1`；`attack=0.035`；`release=0.25` |
| CHOP 组件输入 / `network_in_chop` | — → out:CHOP | 浏览器 | 从所属组件的指定编号输入端口读取数据。根网络无输入时返回空值。<br>`index=1` |
| CHOP 组件输出 / `network_out_chop` | in:CHOP → out:CHOP | 浏览器 | 将内部网络结果输出到组件外部的指定端口。<br>`index=1` |
| CHOP 路径引用 / `operator_select_chop` | — → out:CHOP | 浏览器 | 通过节点 ID 路径读取算子输出。支持 / 根路径、../ 父级路径以及组件内部路径。循环引用会显示运行错误。<br>`path=` |
| 副本编号 / `replica_index_chop` | — → out:CHOP | 浏览器 | 读取所属Replicator实例的编号，从0开始，可连接GLSL的mod输入。 |
| 键盘输入 / `browser_keyboard_in` | — → out:CHOP | 浏览器 | 真实浏览器输入；未连接设备时返回空通道。Panel 通过 path 读取组件参数。<br>`keys=Space ArrowLeft ArrowRight`；`path=`；`device=0`；`channel=0`；`velocity=100`；`enabled=False` |
| 鼠标输入 / `browser_mouse_in` | — → out:CHOP | 浏览器 | 真实浏览器输入；未连接设备时返回空通道。Panel 通过 path 读取组件参数。<br>`keys=Space ArrowLeft ArrowRight`；`path=`；`device=0`；`channel=0`；`velocity=100`；`enabled=False` |
| 游戏手柄 / `browser_joystick` | — → out:CHOP | 浏览器 | 真实浏览器输入；未连接设备时返回空通道。Panel 通过 path 读取组件参数。<br>`keys=Space ArrowLeft ArrowRight`；`path=`；`device=0`；`channel=0`；`velocity=100`；`enabled=False` |
| MIDI 输入 / `browser_midi_in` | — → out:CHOP | 浏览器 | 使用 Web MIDI API。点击启用 MIDI 后选择设备索引；输出需要开启 enabled。浏览器和系统必须支持 MIDI。<br>`keys=Space ArrowLeft ArrowRight`；`path=`；`device=0`；`channel=0`；`velocity=100`；`enabled=False` |
| MIDI 输出 / `browser_midi_out` | in:CHOP → out:CHOP | 浏览器 | 使用 Web MIDI API。点击启用 MIDI 后选择设备索引；输出需要开启 enabled。浏览器和系统必须支持 MIDI。<br>`keys=Space ArrowLeft ArrowRight`；`path=`；`device=0`；`channel=0`；`velocity=100`；`enabled=False` |
| 面板值 / `browser_panel` | — → out:CHOP | 浏览器 | 真实浏览器输入；未连接设备时返回空通道。Panel 通过 path 读取组件参数。<br>`keys=Space ArrowLeft ArrowRight`；`path=`；`device=0`；`channel=0`；`velocity=100`；`enabled=False` |
| 麦克风采样 / `browser_audio_device_in` | — → out:CHOP | 浏览器 | 真实浏览器输入；未连接设备时返回空通道。Panel 通过 path 读取组件参数。<br>`keys=Space ArrowLeft ArrowRight`；`path=`；`device=0`；`channel=0`；`velocity=100`；`enabled=False` |
| MIDI 映射 / `browser_midi_map` | — → out:CHOP | 浏览器 | 读取真实浏览器事件或当前屏幕信息；MIDI需要显式启用，Monitors目前报告当前显示器。<br>`mapping={"volume":[176,7],"note":[144,60]}` |
| 数位笔输入 / `browser_tablet` | — → out:CHOP | 浏览器 | 使用 PointerEvent 的真实压力、倾角、旋转及坐标；普通鼠标不产生数位笔倾角。<br>`mapping={"volume":[176,7],"note":[144,60]}` |
| Python 脚本 CHOP / `python_script_chop` | in:CHOP → out:CHOP | 手动 Python 服务 | 显式点击运行 Python 才会执行 cook(inputs, time)。使用本机账户权限，支持安装的 Python 包；脚本与日志保存在本项目。返回 TD Open 的通道/表格/网格/图像数据，不支持 TouchDesigner op()/scriptOp 对象。<br>`code=def cook(inputs, time): ↵     import math ↵     return {"kind":"channels", "channels":[{"name":"sine", "samples":[math.sin(i/32*math.tau + time) for i in range(128)]}], "sampleRate":60, "start":0, "timeSlice":False}` |
| 音频文件采样 / `media_audio_file_in` | — → out:CHOP | 浏览器 | 点击启用后解码音频文件为真实 PCM 多通道；根据时间线读出采样块，不自动播放。<br>`url=`；`samples=1024`；`loop=False`；`offset=0`；`speed=1` |
| 导出音频 WAV / `media_audio_file_out` | in:CHOP → out:CHOP | 浏览器 | 点击启用将输入采样段编码为 PCM16 WAV 文件供下载；完整保留通道和采样率。<br>`filename=td-open-audio.wav` |
| 播放音频采样 / `media_audio_play` | in:CHOP → out:CHOP | 浏览器 | 点击启用播放输入 PCM 或音频 URL，支持循环、音量和停止。<br>`url=`；`volume=0.7`；`loop=False`；`speed=1` |
| 音频设备输出 / `media_audio_device_out` | in:CHOP → out:CHOP | 浏览器 | 显式启用后按采样率将输入时间片送至浏览器音频输出设备；支持可用设备 sink ID。<br>`volume=0.7`；`device_id=` |
| 视频音轨采样 / `media_audio_movie` | — → out:CHOP | 浏览器 | 绑定视频节点 ID 或视频 URL，同步读取其播放时钟与立体声音轨 PCM。<br>`movie_node=`；`url=`；`volume=0.7`；`samples=1024`；`loop=False` |
| 音频流输入 / `media_audio_stream_in` | — → out:CHOP | 浏览器 | 显式启用后读取浏览器可播放 HTTP 音频流，或建立 WebRTC 音频接收；不包含 RTSP 解码。<br>`mode=url`；`url=`；`remote_sdp=`；`volume=0.7`；`samples=1024` |
| WebRTC 音频流输出 / `media_audio_stream_out` | in:CHOP → out:CHOP | 浏览器 | 将 PCM 通道编码为 WebRTC 音频轨道；点击启用交换 SDP，连接后连续发送时间片。不提供 RTSP 服务器。<br>`remote_sdp=`；`volume=0.7` |
| 多通道常量 / `channel_constant` | — → out:CHOP | 浏览器 / 服务端 | 按名称定义多个采样通道；JSON 可填标量或等长数组。<br>`values={"x":[0,0.5,1,0.5],"y":[1,0.5,0,0.5]}`；`sample_rate=60` |
| 采样图案 / `pattern_chop` | — → out:CHOP | 浏览器 / 服务端 | 生成整段有采样率的周期波形。<br>`wave=sine`；`samples=256`；`sample_rate=60`；`cycles=2`；`amplitude=1`；`offset=0`；`phase=0`；`name=pattern` |
| 时间波形 / `wave_chop` | — → out:CHOP | 浏览器 / 服务端 | 根据播放时间生成连续波形采样块。<br>`wave=sine`；`samples=256`；`sample_rate=60`；`frequency=1`；`amplitude=1`；`phase=0` |
| 音频振荡器 / `audio_oscillator` | — → out:CHOP | 浏览器 / 服务端 | 生成真实 PCM 采样块，供 DSP 滤波和频谱分析。<br>`wave=sine`；`samples=2048`；`sample_rate=48000`；`frequency=440`；`amplitude=0.5`；`phase=0` |
| 多通道噪声 / `noise_channels` | — → out:CHOP | 浏览器 | 可重复的白噪声、平滑值噪声和随机游走样本。<br>`mode=smooth`；`samples=256`；`sample_rate=60`；`seed=7`；`frequency=4`；`amplitude=1` |
| 合并通道 / `channel_merge` | in:CHOP、in2:CHOP → out:CHOP | 浏览器 / 服务端 | 按名称合并两组通道；重复名称自动编号，短通道末值延展。 |
| 选择通道 / `channel_select` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 用空格分隔的 * 与 ? 通配符选择命名通道。<br>`channels=*` |
| 删除通道 / `channel_delete` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 删除匹配名称的通道，保留其他通道和采样时间。<br>`channels=*` |
| 重命名通道 / `channel_rename` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 按 JSON 名称映射重命名通道，并添加前后缀。<br>`mapping={"chan1":"value"}`；`prefix=`；`suffix=` |
| 重排通道 / `channel_reorder` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 按指定索引、名称排序或反转通道顺序。<br>`mode=indices`；`indices=0,1` |
| 通道样本转置 / `native_channel_shuffle` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 将通道与样本维度互换，或把所有通道串联成一条。<br>`mode=transpose`；`size=16` |
| 拼接采样 / `channel_join` | in:CHOP、in2:CHOP → out:CHOP | 浏览器 / 服务端 | 沿时间轴拼接相同名称的样本，支持交叉淡化。<br>`crossfade=0` |
| 插入采样 / `channel_splice` | in:CHOP、in2:CHOP → out:CHOP | 浏览器 / 服务端 | 在样本索引处插入第二段信号，可替换原有片段。<br>`index=0`；`remove=0` |
| 裁剪采样 / `channel_trim` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 保留指定样本范围，并更新起始样本位置。<br>`start=0`；`length=64` |
| 移动采样 / `channel_shift` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 移动信号索引，边界可循环、夹持或补零。<br>`shift=16`；`mode=wrap` |
| 拉伸采样 / `channel_stretch` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 通过线性或最近邻插值调整信号时长。<br>`factor=2`；`mode=linear` |
| 重采样 / `channel_resample` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 改变采样率并保持信号时长；降低采样率时以窗口均值抑制混叠。<br>`sample_rate=120`；`mode=linear` |
| 延展采样 / `channel_extend` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 在两端添加样本，支持末值、循环、镜像和零填充。<br>`before=16`；`after=16`；`mode=hold` |
| 循环采样 / `channel_cycle` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 重复整个通道片段，可在周期之间反转方向。<br>`cycles=3`；`pingpong=False` |
| 复制通道 / `channel_copy` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 创建带独立名称、幅值步进和时间偏移的多个信号副本。<br>`copies=3`；`gain_step=0.2`；`shift_step=8` |
| 信号排序 / `channel_sort` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 按样本值排序或按平均值重排通道。<br>`mode=samples_ascending` |
| 替换通道 / `channel_replace` | in:CHOP、in2:CHOP → out:CHOP | 浏览器 / 服务端 | 将第二路中同名通道替换到第一路，支持补充新通道。<br>`append=True` |
| 信号查表 / `channel_lookup` | in:CHOP、in2:CHOP → out:CHOP | 浏览器 / 服务端 | 将第一路 0–1 索引映射到第二路采样曲线。<br>`mode=hold` |
| 时间扭曲 / `channel_warp` | in:CHOP、in2:CHOP → out:CHOP | 浏览器 / 服务端 | 用第二路曲线控制第一路信号的时间位置。<br>`mode=hold` |
| 通道统计 / `channel_analyze` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 对每条完整通道统计峰值、平均值、RMS、方差、总和或峰值位置。<br>`mode=rms` |
| 通道数学 / `channel_math` | in:CHOP、in2:CHOP → out:CHOP | 浏览器 / 服务端 | 按同名或索引匹配通道，逐样本运算并应用增益偏移。<br>`mode=add`；`gain=1`；`offset=0` |
| 通道逻辑 / `channel_logic` | in:CHOP、in2:CHOP → out:CHOP | 浏览器 | 逐样本比较、布尔组合和上下沿检测。<br>`mode=above`；`threshold=0.5` |
| 通道限幅 / `channel_limit` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 对全部样本进行裁剪、循环或镜像限幅。<br>`minimum=-1`；`maximum=1`；`mode=clamp` |
| 通道函数 / `channel_function` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 对整组通道应用数学函数和幂变换。<br>`mode=sin` |
| 通道混合 / `channel_blend` | in:CHOP、in2:CHOP、mod:CHOP → out:CHOP | 浏览器 / 服务端 | 根据混合量或第三路调制信号逐样本混合通道。<br>`mix=0.5` |
| 向量叉积 / `channel_cross` | in:CHOP、in2:CHOP → out:CHOP | 浏览器 / 服务端 | 将前三条通道当作 XYZ 向量，计算逐样本叉积。 |
| 向量夹角 / `channel_angle` | in:CHOP、in2:CHOP → out:CHOP | 浏览器 / 服务端 | 计算两组 XYZ 向量的夹角、点积或带方向二维角度。<br>`mode=angle` |
| 通道向量变换 / `channel_transform` | in:CHOP → out:CHOP | 浏览器 | 对 XYZ 通道进行缩放、欧拉旋转和平移。<br>`tx=0`；`ty=0`；`tz=0`；`rx=0`；`ry=0`；`rz=45`；`scale=1` |
| 矩阵变换通道 / `channel_transform_xyz` | in:CHOP → out:CHOP | 浏览器 | 应用自定义 4×4 行优先变换矩阵，输出 XYZ 和齐次除法。<br>`matrix=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]]` |
| 通道属性 / `channel_attribute` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 调整采样率、时间起点与时间片标记，保留原始样本。<br>`sample_rate=60`；`start=0`；`time_slice=False` |
| 采样表达式 / `channel_expression` | in:CHOP、in2:CHOP → out:CHOP | 浏览器 / 服务端 | 安全算式：x/y 为输入、i 为样本、c 为通道、t 为秒；支持 sin、clamp、mix 等。<br>`expression=sin(x*pi)*0.5+y` |
| 关键帧曲线 / `channel_keyframe` | — → out:CHOP | 浏览器 | 从按秒排列的关键帧生成多条插值动画曲线。<br>`keys={"x":[[0,0],[1,1],[2,0]],"y":[[0,1],[1,0],[2,1]]}`；`samples=256`；`sample_rate=60`；`mode=linear`；`loop=True` |
| S 型曲线 / `channel_scurve` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 将信号映射为 smoothstep 或 smootherstep 缓入缓出曲线。<br>`mode=smooth` |
| 三次插值 / `channel_interpolate` | in:CHOP → out:CHOP | 浏览器 | 用 Catmull–Rom 三次曲线将采样段重建到指定长度。<br>`samples=256` |
| 反求曲线 / `channel_inverse_curve` | in:CHOP → out:CHOP | 浏览器 | 把单调曲线的值域映射回原始采样位置；非单调曲线会明确报错。<br>`samples=256` |
| 多通道计数 / `channel_count` | in:CHOP、reset:CHOP → out:CHOP | 浏览器 | 逐样本累计阈值上升沿，支持重置触发和计数上限。<br>`threshold=0.5`；`maximum=0` |
| 采样延迟 / `channel_delay` | in:CHOP → out:CHOP | 浏览器 | 通过每通道独立历史缓冲延迟 PCM 或控制信号。<br>`seconds=0.1` |
| 有限冲激滤波 / `channel_filter` | in:CHOP → out:CHOP | 浏览器 | 按自定义 FIR 系数卷积每条通道，支持跨时间片保存历史。<br>`kernel=[0.125,0.25,0.25,0.25,0.125]` |
| 通道滞后 / `channel_lag` | in:CHOP → out:CHOP | 浏览器 | 逐样本应用独立上升与下降指数平滑时间。<br>`rise=0.1`；`fall=0.3` |
| 信号导数 / `channel_slope` | in:CHOP → out:CHOP | 浏览器 | 按真实采样率计算每条通道的一阶导数。 |
| 信号积分 / `channel_speed` | in:CHOP → out:CHOP | 浏览器 | 按真实采样率积分信号，可设置起始值和泄漏。<br>`initial=0`；`leak=0` |
| 音量包络 / `channel_envelope` | in:CHOP → out:CHOP | 浏览器 | 逐样本绝对值或平方值经过攻击释放平滑，输出峰值/RMS 包络。<br>`mode=peak`；`attack=0.01`；`release=0.1` |
| 通道采样保持 / `channel_hold` | in:CHOP、in2:CHOP → out:CHOP | 浏览器 | 在第二路信号上升沿采样并保持每条通道。<br>`threshold=0.5` |
| 记录通道 / `channel_record` | in:CHOP → out:CHOP | 浏览器 | 开启时累积实时信号；关闭后保留已录制的采样段。<br>`recording=True`；`maximum=4096`；`reset=False` |
| 信号轨迹 / `channel_trail` | in:CHOP → out:CHOP | 浏览器 | 保存每条通道最近一段时间的信号历史。<br>`seconds=2` |
| 通道反馈 / `channel_feedback` | in:CHOP → out:CHOP | 浏览器 | 输出上一轮执行的完整采样缓冲，可连接无环反馈处理链。<br>`gain=1`；`reset=False` |
| 时间片 / `channel_time_slice` | in:CHOP → out:CHOP | 浏览器 | 根据相邻执行时间提取新的采样范围，标记为流式时间片。<br>`max_samples=4096` |
| 事件脉冲 / `channel_event` | in:CHOP → out:CHOP | 浏览器 | 识别上升、下降、变化或阈值区间事件，输出逐样本脉冲。<br>`mode=change`；`threshold=0.5`；`tolerance=0.01` |
| 脉冲整形 / `channel_pulse` | in:CHOP → out:CHOP | 浏览器 | 把阈值上升沿转换成固定秒数的门信号。<br>`seconds=0.1`；`threshold=0.5` |
| 索引展开 / `channel_fan` | in:CHOP → out:CHOP | 浏览器 | 把整数索引展开为多条 one-hot 或线性权重通道。<br>`outputs=4`；`mode=onehot` |
| 步进音序器 / `channel_sequencer` | — → out:CHOP | 浏览器 | 按 BPM、每拍步数和播放时间生成步序值与触发通道。<br>`steps=[0,0.5,1,0.25]`；`bpm=120`；`subdivision=4`；`samples=256`；`sample_rate=60` |
| 片段播放器 / `channel_clip` | in:CHOP → out:CHOP | 浏览器 | 按播放时间、速度和循环方式读取输入采样片段。<br>`speed=1`；`offset=0`；`samples=256`；`loop=True` |
| 片段交叉混合 / `channel_clip_blender` | in:CHOP、in2:CHOP → out:CHOP | 浏览器 | 将不同时长片段对齐至相同相位，并进行等功率交叉淡化。<br>`mix=0.5`；`samples=256` |
| 覆盖通道 / `channel_override` | in:CHOP、in2:CHOP → out:CHOP | 浏览器 / 服务端 | 仅覆盖名称匹配且开关开启的第二路通道。<br>`channels=*`；`enabled=True` |
| 通道直通 / `channel_null` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 传递完整通道缓冲，并可固定输出命名前缀。<br>`prefix=` |
| 通道信息 / `channel_info` | in:CHOP → out:CHOP | 浏览器 / 服务端 | 输出通道数量、采样数、采样率、时长与时间起点。 |
| 时间码 / `channel_timecode` | — → out:CHOP | 浏览器 | 将秒数拆分成时、分、秒、帧与总帧数。<br>`fps=30`；`offset=0` |
| 时钟 / `channel_clock` | — → out:CHOP | 浏览器 | 输出实际 UTC 日期与时间通道，或使用可复现的指定 ISO 时间。<br>`iso=` |
| 时间线 / `channel_timeline` | — → out:CHOP | 浏览器 | 输出播放秒数、帧、片段进度和循环计数。<br>`fps=60`；`duration=10` |
| 执行统计 / `channel_perform` | — → out:CHOP | 浏览器 | 记录相邻执行时间、执行次数和项目节点数量。 |
| 参数通道 / `channel_parameter` | — → out:CHOP | 浏览器 | 按节点 ID 和参数名称读取项目数值参数。<br>`node_id=`；`parameters=value` |
| 表格转通道 / `dat_to_channels` | in:DAT → out:CHOP | 浏览器 / 服务端 | 原生表格或 CSV 的首行作为名称，每一列转成一条采样通道。<br>`sample_rate=60`；`header=True` |
| 图像转通道 / `top_to_channels` | in:TOP → out:CHOP | 浏览器 | 采样图像像素，输出 RGBA 与亮度通道。<br>`width=32`；`height=18` |
| 几何转通道 / `sop_to_channels` | in:SOP → out:CHOP | 浏览器 | 读取几何世界坐标顶点，输出 tx、ty、tz 命名通道。<br>`maximum=4096` |
| 音频频谱数据 / `audio_spectrum_chop` | in:CHOP → out:CHOP | 浏览器 | 快速傅里叶变换输出线性幅度或分贝频谱，支持 Hann 窗。<br>`fft_size=1024`；`mode=magnitude`；`window=True` |
| 音频滤波器 / `audio_filter_chop` | in:CHOP → out:CHOP | 浏览器 | 真实双二阶低通、高通、带通与陷波滤波，保留跨时间片状态。<br>`mode=lowpass`；`frequency=1000`；`q=0.707` |
| 音频频段均衡 / `audio_band_eq` | in:CHOP → out:CHOP | 浏览器 | 低频与高频搁架滤波串联，可独立增减低、高频。<br>`low_frequency=200`；`low_gain=6`；`high_frequency=5000`；`high_gain=-3` |
| 参数均衡器 / `audio_para_eq` | in:CHOP → out:CHOP | 浏览器 | 峰值均衡器以中心频率、Q 值、分贝增益调节指定频段。<br>`frequency=1000`；`q=1`；`gain=6` |
| 音频动态处理 / `audio_dynamics` | in:CHOP → out:CHOP | 浏览器 | 压缩器 / 扩展器 / 限幅器采用攻击释放包络和分贝增益。<br>`mode=compressor`；`threshold=-18`；`ratio=4`；`attack=0.01`；`release=0.1`；`makeup=0` |
| 双耳空间化 / `audio_binaural` | in:CHOP → out:CHOP | 浏览器 | 以耳间时间差和等功率声像将单声道定位到左右耳；不含 HRTF 数据库。<br>`azimuth=30`；`distance=1` |
| 立体声混音 / `audio_render_chop` | in:CHOP、in2:CHOP → out:CHOP | 浏览器 | 将两路音频分别置于可调左右声像后混合成双声道。<br>`pan1=-0.5`；`pan2=0.5`；`gain1=0.5`；`gain2=0.5` |
| 相位效果器 / `audio_phaser_chop` | in:CHOP → out:CHOP | 浏览器 | 四级全通滤波器随低频振荡器扫频，和原音混合形成相位效果。<br>`frequency=700`；`rate=0.5`；`depth=0.6`；`mix=0.5` |
| 采样弹簧 / `channel_spring` | in:CHOP → out:CHOP | 浏览器 | 按采样率积分二阶阻尼系统，让整段信号产生弹性响应。<br>`frequency=2`；`damping=0.5` |
| 采样包络触发 / `channel_trigger` | in:CHOP → out:CHOP | 浏览器 | 每条门信号生成攻击、衰减、维持、释放 ADSR 采样包络。<br>`attack=0.05`；`decay=0.1`；`sustain=0.6`；`release=0.2`；`threshold=0.5` |
| 分段计时器 / `channel_timer` | — → out:CHOP | 浏览器 | 依照 JSON 段时长生成总进度、当前段、段进度和完成状态。<br>`durations=[1,2,1]`；`loop=True`；`offset=0` |
| 声明式信号脚本 / `channel_script` | in:CHOP → out:CHOP | 浏览器 | 以 JSON 操作序列完成采样表达式、选通道、重命名；不执行任意 JavaScript。<br>`program=[{"op":"map","expression":"x*2"},{"op":"rename","prefix":"result_"}]` |
| 节拍时间通道 / `channel_beat` | — → out:CHOP | 浏览器 / 服务端 | 输出节拍编号、拍内进度、小节、重音和脉冲的同步采样通道。<br>`bpm=120`；`beats_per_bar=4`；`samples=256`；`sample_rate=60` |
| 多相低频振荡 / `channel_lfo` | — → out:CHOP | 浏览器 / 服务端 | 生成多条相位均匀错开的低频采样通道，可分别驱动多个对象。<br>`wave=sine`；`channels=3`；`frequency=1`；`amplitude=1`；`offset=0`；`phase=0`；`samples=256`；`sample_rate=60` |
| 信号复合 / `channel_composite` | in:CHOP、in2:CHOP → out:CHOP | 浏览器 | 按采样时间对齐两段信号，以重叠区间进行加法、乘法、最大值或覆盖。<br>`mode=add`；`opacity=1` |
| 多通道切换 / `channel_switch` | in:CHOP、in2:CHOP、mod:CHOP → out:CHOP | 浏览器 / 服务端 | 切换整组命名通道，或根据调制信号逐采样切换两组通道。<br>`index=0` |
| 参数绑定通道 / `channel_bind` | in:CHOP → out:CHOP | 浏览器 | 按 JSON 路径绑定多个节点参数为通道；连接输入可覆盖指定绑定输出。<br>`bindings={"value":"target.value"}`；`input_override=False` |
| 变换控制通道 / `channel_handle` | in:CHOP → out:CHOP | 浏览器 | 编辑平移、旋转与缩放控制通道，可叠加连接的动作信号。<br>`tx=0`；`ty=0`；`tz=0`；`rx=0`；`ry=0`；`rz=0`；`sx=1`；`sy=1`；`sz=1` |
| 导入动作选择 / `channel_import_select` | in:DAT → out:CHOP | 浏览器 | 从导入 JSON 动作集合中选取片段和通道，保留整段采样数据。<br>`clip=walk`；`channels=*`；`sample_rate=60` |
| 双骨骼逆运动学 / `channel_inverse_kin` | in:CHOP → out:CHOP | 浏览器 | 解析求解二维双连杆目标位置，输出肩肘角度、关节位置和可达标记。<br>`length1=1`；`length2=1`；`elbow_flip=False` |
| 场景对象通道 / `channel_object` | in:COMP → out:CHOP | 浏览器 | 读取场景对象、相机或灯光的变换参数，输出命名位置与旋转通道。<br>`mode=object`；`index=0` |
| 图像连通域追踪 / `channel_blob_track` | in:TOP → out:CHOP | 浏览器 | 对亮度阈值图像进行连通域标记，输出稳定 ID、中心、面积和包围框；CPU 实现。<br>`threshold=0.5`；`minimum_area=8`；`maximum=16`；`resolution=128` |
| 刚体状态通道 / `physics_state_chop` | in:COMP → out:CHOP | 浏览器 | 读取场景刚体的位置、旋转与质量为命名多通道样本。 |
| 三维射线拾取 / `render_pick_chop` | in:COMP → out:CHOP | 浏览器 | 按场景相机和归一化屏幕坐标实际投射射线，输出命中、对象索引、位置、法线与距离。<br>`x=0`；`y=0` |
| Ableton Link · 外部桥接 / `ref_chop_ableton_link` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Ableton Link native library and local Link session。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=ableton` |
| Audio NDI · 外部桥接 / `ref_chop_audio_ndi` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：NDI SDK/runtime + audio-capable source and PCM bridge。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=audio_ndi` |
| Audio VST · 外部桥接 / `ref_chop_audio_vst` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Native VST3 host + installed plugin; browser cannot load VST binaries。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=vst` |
| Audio Web Render · 外部桥接 / `ref_chop_audio_web_render` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Browser/tab audio capture or native web-render audio adapter; screenshot rendering does not produce audio。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=audio_web_render` |
| BlackTrax · 外部桥接 / `ref_chop_blacktrax` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：BlackTrax RTTrP source + native receiver adapter。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=blacktrax` |
| Body Track · 外部桥接 / `ref_chop_body_track` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Computer vision tracking model/runtime and explicit coordinate schema。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=tracking` |
| CPlusPlus · 外部桥接 / `ref_chop_cplusplus` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Native C++ compiler + SDK/plugin host adapter; exports portable data over the open bridge, not binary ABI compatibility。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=cpp` |
| DMX In / `ref_chop_dmx_in` | — → out:CHOP | 浏览器 | 真实 Art-Net ArtDMX 数据报，1–512 通道，数值范围 0–255。<br>`enabled=False`；`interval=100`；`mode=listen`；`host=127.0.0.1`；`port=6454`；`universe=0` |
| DMX Out / `ref_chop_dmx_out` | in:CHOP → out:CHOP | 浏览器 | 真实 Art-Net ArtDMX 数据报，1–512 通道，数值范围 0–255。<br>`enabled=False`；`interval=100`；`mode=connect`；`host=127.0.0.1`；`port=6454`；`universe=0` |
| Face Track · 外部桥接 / `ref_chop_face_track` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Computer vision tracking model/runtime and explicit coordinate schema。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=tracking` |
| File In / `ref_chop_file_in` | — → out:CHOP | 浏览器 | 在项目 data/io 内读取 UTF-8 / JSON 数据；CHOP 使用完整多通道 JSON 格式。<br>`enabled=False`；`interval=500`；`path=example.json` |
| File Out / `ref_chop_file_out` | in:CHOP → out:CHOP | 浏览器 | 在项目 data/io 内写入 UTF-8 / JSON 数据；CHOP 使用完整多通道 JSON 格式。<br>`enabled=False`；`interval=500`；`path=example.json`；`append=False` |
| FreeD In · 外部桥接 / `ref_chop_freed_in` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：FreeD D1 UDP camera tracking source/encoder adapter。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=freed` |
| FreeD Out · 外部桥接 / `ref_chop_freed_out` | in:CHOP → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：FreeD D1 UDP camera tracking source/encoder adapter。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=freed` |
| Gesture · 外部桥接 / `ref_chop_gesture` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Computer vision tracking model/runtime and explicit coordinate schema。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=tracking` |
| Hog · 外部桥接 / `ref_chop_hog` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Hog lighting console network protocol adapter。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=hog` |
| Hokuyo · 外部桥接 / `ref_chop_hokuyo` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Hokuyo SCIP protocol + connected laser scanner。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=hokuyo` |
| Kinect · 外部桥接 / `ref_chop_kinect` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Microsoft Kinect SDK / libfreenect; a connected Kinect camera。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=kinect` |
| Kinect Azure · 外部桥接 / `ref_chop_kinect_azure` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Azure Kinect Sensor SDK + camera; joint data also needs Body Tracking SDK。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=kinect_azure` |
| Laser · 外部桥接 / `ref_chop_laser` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Supported Ether Dream / Pangolin DAC SDK, scanner and device interlock。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=laser` |
| Laser Device · 外部桥接 / `ref_chop_laser_device` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Supported Ether Dream / Pangolin DAC SDK, scanner and device interlock。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=laser` |
| Leap Motion · 外部桥接 / `ref_chop_leap_motion` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Ultraleap Tracking SDK + Leap Motion controller。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=leap_motion` |
| Leuze ROD4 · 外部桥接 / `ref_chop_leuze_rod4` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Leuze ROD4 protocol + scanner。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=leuze` |
| LTC In · 外部桥接 / `ref_chop_ltc_in` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：LTC audio encoder/decoder adapter and physical audio routing。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=ltc` |
| LTC Out · 外部桥接 / `ref_chop_ltc_out` | in:CHOP → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：LTC audio encoder/decoder adapter and physical audio routing。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=ltc` |
| MoSys · 外部桥接 / `ref_chop_mosys` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Mo-Sys camera tracking protocol/SDK + tracking system。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=mosys` |
| Mouse Out · 外部桥接 / `ref_chop_mouse_out` | in:CHOP → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Native OS pointer automation adapter with active desktop accessibility/X11/Wayland permissions; browsers cannot move the system pointer。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=mouse_output` |
| Ncam · 外部桥接 / `ref_chop_ncam` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Ncam SDK/protocol + licensed tracking system。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=ncam` |
| OAK Device · 外部桥接 / `ref_chop_oak_device` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Luxonis DepthAI + connected OAK camera。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=oak` |
| OAK Select · 外部桥接 / `ref_chop_oak_select` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Luxonis DepthAI + connected OAK camera。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=oak` |
| Oculus Audio · 外部桥接 / `ref_chop_oculus_audio` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Meta/Oculus SDK + supported headset and native runtime。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=oculus` |
| Oculus Rift · 外部桥接 / `ref_chop_oculus_rift` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Meta/Oculus SDK + supported headset and native runtime。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=oculus` |
| OpenVR · 外部桥接 / `ref_chop_openvr` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：OpenVR/SteamVR runtime + supported headset/controllers。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=openvr` |
| OptiTrack In · 外部桥接 / `ref_chop_optitrack_in` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：OptiTrack NatNet SDK + Motive streaming server。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=optitrack` |
| OSC In / `ref_chop_osc_in` | — → out:CHOP | 浏览器 | 真实 OSC 1.0 UDP 消息与 bundle 读取，支持数值、文字、布尔和 blob。TUIO 保留原始地址与参数；Sync 使用开放 OSC 消息。<br>`enabled=False`；`interval=100`；`mode=listen`；`host=127.0.0.1`；`port=9000`；`address=/td-open` |
| OSC Out / `ref_chop_osc_out` | in:CHOP → out:CHOP | 浏览器 | 真实 OSC 1.0 UDP 消息与 bundle 读取，支持数值、文字、布尔和 blob。TUIO 保留原始地址与参数；Sync 使用开放 OSC 消息。<br>`enabled=False`；`interval=100`；`mode=connect`；`host=127.0.0.1`；`port=9000`；`address=/td-open` |
| Pangolin · 外部桥接 / `ref_chop_pangolin` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Supported Ether Dream / Pangolin DAC SDK, scanner and device interlock。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=laser` |
| Pipe In / `ref_chop_pipe_in` | — → out:CHOP | 浏览器 | 真实 TCP 连接与监听，支持换行 / 32 位长度 / 原始流消息边界；Pipe 使用开放 TCP，不兼容私有 Pipe 协议。<br>`enabled=False`；`interval=100`；`mode=listen`；`host=127.0.0.1`；`port=9001`；`framing=newline` |
| Pipe Out / `ref_chop_pipe_out` | in:CHOP → out:CHOP | 浏览器 | 真实 TCP 连接与监听，支持换行 / 32 位长度 / 原始流消息边界；Pipe 使用开放 TCP，不兼容私有 Pipe 协议。<br>`enabled=False`；`interval=100`；`mode=connect`；`host=127.0.0.1`；`port=9001`；`framing=newline` |
| PosiStageNet · 外部桥接 / `ref_chop_posistagenet` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：PSN multicast tracking source/encoder adapter。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=posistagenet` |
| RenderStream In · 外部桥接 / `ref_chop_renderstream_in` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Disguise RenderStream SDK and licensed host。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=renderstream` |
| Serial / `ref_chop_serial` | in:CHOP → out:CHOP | 浏览器 | 真实 POSIX 串口 8N1 读写（Linux / macOS）；需要设备权限，按接收字节块输出。<br>`enabled=False`；`interval=100`；`device=/dev/ttyUSB0`；`baud=115200` |
| Shared Mem In / `ref_chop_shared_mem_in` | — → out:CHOP | 浏览器 | 通过项目 data/io/sharedmem 中的 mmap 文件交换 JSON / 图像。开放格式，不兼容 TouchDesigner 专有共享内存 ABI。<br>`enabled=False`；`interval=100`；`channel=td-open` |
| Shared Mem Out / `ref_chop_shared_mem_out` | in:CHOP → out:CHOP | 浏览器 | 通过项目 data/io/sharedmem 中的 mmap 文件交换 JSON / 图像。开放格式，不兼容 TouchDesigner 专有共享内存 ABI。<br>`enabled=False`；`interval=100`；`channel=td-open` |
| Stype In · 外部桥接 / `ref_chop_stype_in` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：stYpe tracking protocol/SDK + tracking system。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=stype` |
| Stype Out · 外部桥接 / `ref_chop_stype_out` | in:CHOP → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：stYpe tracking protocol/SDK + tracking system。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=stype` |
| Sync In / `ref_chop_sync_in` | — → out:CHOP | 浏览器 | 真实 OSC 1.0 UDP 消息与 bundle 读取，支持数值、文字、布尔和 blob。TUIO 保留原始地址与参数；Sync 使用开放 OSC 消息。<br>`enabled=False`；`interval=100`；`mode=listen`；`host=127.0.0.1`；`port=9000`；`address=/td-open` |
| Sync Out / `ref_chop_sync_out` | in:CHOP → out:CHOP | 浏览器 | 真实 OSC 1.0 UDP 消息与 bundle 读取，支持数值、文字、布尔和 blob。TUIO 保留原始地址与参数；Sync 使用开放 OSC 消息。<br>`enabled=False`；`interval=100`；`mode=connect`；`host=127.0.0.1`；`port=9000`；`address=/td-open` |
| Touch In / `ref_chop_touch_in` | — → out:CHOP | 浏览器 | 通过 TD Open 开放 JSON 桥接协议交换数据，接收 POST /api/io/bridge/{通道}。Touch 私有网络协议未内置。<br>`enabled=False`；`interval=100`；`channel=td-open` |
| Touch Out / `ref_chop_touch_out` | in:CHOP → out:CHOP | 浏览器 | 通过 TD Open 开放 JSON 桥接协议交换数据，接收 POST /api/io/bridge/{通道}。Touch 私有网络协议未内置。<br>`enabled=False`；`interval=100`；`channel=td-open` |
| ZED · 外部桥接 / `ref_chop_zed` | — → out:CHOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Stereolabs ZED SDK + CUDA + connected ZED camera。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=zed` |
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

## SOP（131 个）

| 名称 / 类型 ID | 输入 → 输出 | 运行位置 | 用途与默认参数 |
| --- | --- | --- | --- |
| 几何体 / `geometry` | — → out:SOP | 浏览器 | 创建真正的三维网格。连接到 3D 渲染节点得到画面。<br>`shape=torus`；`detail=32` |
| 模型转表面点云 / `model_to_pointcloud_sop` | in:SOP → out:SOP | 浏览器 | 读取真实 GLB / SOP 网格，按三角面面积进行确定性采样；保留法线，不使用替代几何。<br>`count=28000`；`seed=41`；`height=2.7` |
| 四声部点云编舞 / `pointcloud_dance_sop` | in:SOP、vocals:CHOP、drums:CHOP、bass:CHOP、other:CHOP → out:SOP | 浏览器 | 人声变色、鼓点沿表面法线推进、贝斯呼吸缩放、其他声部产生流动波纹；保留真实点云，GPU 执行连续变形。<br>`pulse=0.12`；`scale=0.14`；`ripple=0.075`；`color_mix=0.75` |
| SOP 组件输入 / `network_in_sop` | — → out:SOP | 浏览器 | 从所属组件的指定编号输入端口读取数据。根网络无输入时返回空值。<br>`index=1` |
| SOP 组件输出 / `network_out_sop` | in:SOP → out:SOP | 浏览器 | 将内部网络结果输出到组件外部的指定端口。<br>`index=1` |
| SOP 路径引用 / `operator_select_sop` | — → out:SOP | 浏览器 | 通过节点 ID 路径读取算子输出。支持 / 根路径、../ 父级路径以及组件内部路径。循环引用会显示运行错误。<br>`path=` |
| Python 脚本 SOP / `python_script_sop` | in:SOP → out:SOP | 手动 Python 服务 | 显式点击运行 Python 才会执行 cook(inputs, time)。使用本机账户权限，支持安装的 Python 包；脚本与日志保存在本项目。返回 TD Open 的通道/表格/网格/图像数据，不支持 TouchDesigner op()/scriptOp 对象。<br>`code=def cook(inputs, time): ↵     return {"shape":"mesh", "mesh":{"positions":[[-1,-1,0],[1,-1,0],[0,1,0]], "faces":[[0,1,2]]}}` |
| 添加点与面 / `add_sop` | — → out:SOP | 浏览器 | 由 JSON 点坐标和索引创建真正可编辑网格。<br>`points=[[-1,-1,0],[1,-1,0],[1,1,0],[-1,1,0]]`；`faces=[[0,1,2,3]]`；`connect=False` |
| 几何对齐 / `align_sop` | in:SOP、in2:SOP → out:SOP | 浏览器 | 按包围盒中心或边界将第一路对齐第二路。<br>`axis=all`；`anchor=center` |
| 属性管理 / `attribute_sop` | in:SOP → out:SOP | 浏览器 | 重命名或删除点属性，可归一化向量。<br>`name=Cd`；`rename=color`；`operation=rename` |
| 创建属性 / `attribute_create_sop` | in:SOP → out:SOP | 浏览器 | 给点或面创建指定分量的数值属性。<br>`name=Cd`；`value=[1,0.5,0.15]`；`domain=point` |
| 曲线基函数 / `basis_sop` | in:SOP → out:SOP | 浏览器 | 将控制点转换为线性、Catmull-Rom 或三次贝塞尔曲线。<br>`basis=catmullrom`；`count=32`；`closed=False` |
| 顶点混合 / `blend_sop` | in:SOP、in2:SOP → out:SOP | 浏览器 | 混合拓扑一致的两套网格顶点。<br>`weight=0.5` |
| 网格布尔 / `boolean_sop` | in:SOP、in2:SOP → out:SOP | 浏览器 | 对封闭网格进行 BSP 并集、差集或交集，输入上限 6000 三角形。<br>`operation=union` |
| 边界桥接 / `bridge_sop` | in:SOP、in2:SOP → out:SOP | 浏览器 | 连接两条边界环形成四边形带；可设置环偏移。<br>`offset=0` |
| 几何帧缓存 / `cache_sop` | in:SOP → out:SOP | 浏览器 | 保存独立网格快照并按延迟帧读取，可冻结当前缓存；总缓存最多 50 万顶点。<br>`frames=10`；`freeze=False` |
| 封闭边界 / `cap_sop` | in:SOP → out:SOP | 浏览器 | 自动识别开放边界环并添加三角形盖面。 |
| 曲线截取 / `carve_sop` | in:SOP → out:SOP | 浏览器 | 按弧长比例截取曲线的起止区间。<br>`start=0.1`；`end=0.9`；`count=32` |
| 信号转几何 / `chop_to_sop` | in:CHOP → out:SOP | 浏览器 | 从多通道 x/y/z 样本生成点和折线，也接受数值数组。<br>`scale=1`；`connect=True` |
| 数据转几何 / `dat_to_sop` | in:DAT → out:SOP | 浏览器 | 从 JSON 顶点/面对象、坐标数组或 CSV 创建网格。<br>`connect=True` |
| 局部雕刻 / `clay_sop` | in:SOP → out:SOP | 浏览器 | 以球形衰减将顶点沿方向推拉，保留网格拓扑。<br>`x=0`；`y=0`；`z=0`；`radius=1`；`amount=0.4`；`axis=z` |
| 平面裁剪 / `clip_sop` | in:SOP → out:SOP | 浏览器 | 逐面裁剪多边形并生成切口顶点。<br>`nx=1`；`ny=0`；`nz=0`；`offset=0`；`cap=False` |
| 几何类型转换 / `convert_sop` | in:SOP → out:SOP | 浏览器 | 在三角网格、线框、点云之间转换。<br>`mode=triangles` |
| 曲面贴附 / `creep_sop` | in:SOP、in2:SOP → out:SOP | 浏览器 | 将第一路 XY 参数坐标贴附到第二路曲面的最近三角形。<br>`offset=0` |
| 曲线推拉 / `curveclay_sop` | in:SOP → out:SOP | 浏览器 | 按控制点索引的高斯衰减移动曲线。<br>`index=0.5`；`radius=0.25`；`dx=0.2`；`dy=0.2`；`dz=0.2` |
| 删除点与面 / `delete_sop` | in:SOP → out:SOP | 浏览器 | 删除指定组、索引范围或反选范围，并重建网格索引。<br>`domain=primitive`；`group=`；`start=0`；`end=0`；`invert=False` |
| 多边形三角化 / `divide_sop` | in:SOP → out:SOP | 浏览器 | 将每个多边形拆为三角形并保留顶点属性。 |
| 法线与焊接 / `facet_sop` | in:SOP → out:SOP | 浏览器 | 计算平滑或平面法线，按距离焊接重合顶点。<br>`mode=smooth`；`tolerance=0.0001` |
| 折线圆角 / `fillet_sop` | in:SOP → out:SOP | 浏览器 | 在折线内角插入二次贝塞尔圆角段。<br>`radius=0.2`；`segments=6` |
| 适配包围盒 / `fit_sop` | in:SOP → out:SOP | 浏览器 | 将几何缩放平移到指定尺寸，支持保持比例。<br>`width=2`；`height=2`；`depth=2`；`uniform=True` |
| 力场属性 / `force_sop` | in:SOP → out:SOP | 浏览器 | 为每个点计算方向、径向或旋涡力，写入 force 属性。<br>`mode=vortex`；`amount=0.5`；`dx=1`；`dy=1`；`dz=1` |
| 分形地形 / `fractal_sop` | in:SOP → out:SOP | 浏览器 | 多层确定性分形噪声沿顶点法向近似位移。<br>`amount=0.5`；`frequency=2`；`octaves=4`；`seed=1` |
| 点与面分组 / `group_sop` | in:SOP → out:SOP | 浏览器 | 按索引范围或包围球创建命名点组或面组。<br>`name=selection`；`domain=point`；`mode=range`；`start=0`；`end=10`；`x=0`；`y=0`；`z=0`；`radius=1` |
| 面域开孔 / `hole_sop` | in:SOP → out:SOP | 浏览器 | 按面中心到指定球心的距离移除面，适合规则曲面的开孔。<br>`x=0`；`y=0`；`z=0`；`radius=0.5` |
| 反转曲线 / `inverse_curve_sop` | in:SOP → out:SOP | 浏览器 | 反转曲线参数方向和面绕序。 |
| 等值面 / `iso_surface_sop` | — → out:SOP | 浏览器 | 对球、环面或 gyroid 标量场进行 marching tetrahedra 提取。<br>`field=gyroid`；`resolution=18`；`iso=0`；`scale=2` |
| 折线拼接 / `join_sop` | in:SOP、in2:SOP → out:SOP | 浏览器 | 将两条曲线端点相接，可自动翻转第二条以缩短距离。<br>`nearest=True` |
| 晶格变形 / `lattice_sop` | in:SOP → out:SOP | 浏览器 | 以包围盒三线性权重插值八个控制角的位移。<br>`offsets=[[0,0,0],[0,0,0],[0.2,0,0],[0.2,0,0],[0,0,0],[0,0,0],[-0.2,0,0],[-0.2,0,0]]` |
| 坐标限制 / `limit_sop` | in:SOP → out:SOP | 浏览器 | 逐轴将顶点坐标截断或循环到指定范围。<br>`min=-1`；`max=1`；`mode=clamp` |
| 曲线加粗 / `line_thick_sop` | in:SOP → out:SOP | 浏览器 | 将折线转为具有圆形截面的可渲染管道。<br>`radius=0.06`；`segments=8` |
| 几何细节级别 / `lod_sop` | in:SOP → out:SOP | 浏览器 | 根据细节比例进行空间顶点聚类，可减少远处几何复杂度。<br>`ratio=0.5` |
| L 系统生长 / `lsystem_sop` | — → out:SOP | 浏览器 | 迭代字符串规则并用三维 turtle 解释 F、+、-、[、]。<br>`axiom=F`；`rules={"F":"F[+F]F[-F]F"}`；`iterations=3`；`angle=25`；`step=0.15` |
| 磁铁吸附 / `magnet_sop` | in:SOP → out:SOP | 浏览器 | 在半径内按平滑权重将顶点吸向指定位置。<br>`x=0`；`y=0`；`z=0`；`radius=2`；`amount=0.5` |
| 指定材质 / `material_sop` | in:SOP、material:MAT → out:SOP | 浏览器 | 把 MAT 材质绑定到几何；Render 会使用其纹理和表面属性。 |
| 融合球等值面 / `metaball_sop` | — → out:SOP | 浏览器 | 累加多个球形势场并提取连续表面。<br>`centers=[[-0.55,0,0],[0.55,0,0],[0,0.6,0]]`；`radius=0.6`；`iso=1`；`resolution=18` |
| 凸包建模 / `model_sop` | in:SOP → out:SOP | 浏览器 | 根据点云构造三维凸包多边形模型。 |
| 几何中继 / `null_sop` | in:SOP → out:SOP | 浏览器 | 保留网格与属性，为网络提供稳定的输出节点。 |
| 对象合并 / `object_merge_sop` | in:SOP、in2:SOP、in3:SOP → out:SOP | 浏览器 | 把多个对象变换烘焙到世界坐标并合并为一套拓扑。 |
| 粒子系统 / `particle_sop` | in:SOP → out:SOP | 浏览器 | 保存位置与速度，按重力、阻力与速度属性逐帧积分，倒放时重置。<br>`gravity=-0.5`；`drag=0.2`；`speed=0.3`；`lifetime=5` |
| 点编辑 / `point_sop` | in:SOP → out:SOP | 浏览器 | 仅对选定点组应用位移、缩放，并可设置点颜色。<br>`group=`；`x=0`；`y=0`；`z=0`；`scale=1`；`color=#f59e75`；`set_color=False` |
| 轮廓放样 / `polyloft_sop` | in:SOP、in2:SOP → out:SOP | 浏览器 | 将两个轮廓按弧长重采样并放样为多层四边形面。<br>`count=32`；`layers=12` |
| 边界补片 / `polypatch_sop` | in:SOP → out:SOP | 浏览器 | 将边界环与质心连接，并用细分和平滑生成补片。<br>`iterations=1` |
| 网格简化 / `polyreduce_sop` | in:SOP → out:SOP | 浏览器 | 通过空间顶点聚类合并小面，重建有效多边形。<br>`ratio=0.5` |
| 多段样条 / `polyspline_sop` | in:SOP → out:SOP | 浏览器 | 用 Catmull-Rom 样条平滑控制多边形。<br>`count=32`；`tension=0.5`；`closed=False` |
| 网格缝合 / `polystitch_sop` | in:SOP、in2:SOP → out:SOP | 浏览器 | 合并两套网格并焊接容差范围内的顶点。<br>`tolerance=0.05` |
| 逐面变换 / `primitive_sop` | in:SOP → out:SOP | 浏览器 | 将各面分离，围绕各自中心进行缩放和法线推挤。<br>`group=`；`scale=0.85`；`extrude=0.1` |
| 截面曲线 / `profile_sop` | in:SOP → out:SOP | 浏览器 | 计算三角网格与指定高度平面的相交线段。<br>`axis=y`；`offset=0` |
| 平面投影 / `project_sop` | in:SOP → out:SOP | 浏览器 | 把几何投影到 XY、XZ 或 YZ 平面。<br>`plane=xy`；`offset=0` |
| 双轨曲面 / `rails_sop` | in:SOP、in2:SOP → out:SOP | 浏览器 | 把两条路径重采样并连接为带状曲面。<br>`count=32` |
| 栅格高度场 / `raster_sop` | in:TOP → out:SOP | 浏览器 | 从输入图像亮度生成规则网格高度场。<br>`resolution=32`；`height=1`；`width=3` |
| 射线贴附 / `ray_sop` | in:SOP、in2:SOP → out:SOP | 浏览器 | 沿指定方向发射射线，将点贴附到第二路三角网格。<br>`dx=0`；`dy=-1`；`dz=0`；`offset=0` |
| 矩形轮廓 / `rectangle_sop` | — → out:SOP | 浏览器 | 创建矩形闭合曲线或填充四边形。<br>`width=2`；`height=1.5`；`fill=False` |
| 曲线插值细化 / `refine_sop` | in:SOP → out:SOP | 浏览器 | 在线段上插入等间距点，保持原折线形状。<br>`segments=3` |
| 等距重采样 / `resample_sop` | in:SOP → out:SOP | 浏览器 | 按总弧长均匀重采样曲线。<br>`count=32`；`closed=False` |
| 曲线旋转成面 / `revolve_sop` | in:SOP → out:SOP | 浏览器 | 绕 Y 轴旋转输入剖面，生成连续旋转网格。<br>`segments=32`；`angle=360` |
| 声明式网格脚本 / `script_sop` | in:SOP → out:SOP | 浏览器 | 执行 JSON 网格操作列表（translate、scale、rotate、subdivide），不执行导入项目中的任意代码。<br>`operations=[{"op":"scale","value":[1,1.4,1]},{"op":"rotate","value":[0,30,0]}]` |
| 选择几何组 / `select_sop` | in:SOP → out:SOP | 浏览器 | 保留指定面组或点组；通过命名组串联建模流程。<br>`group=selection`；`domain=primitive` |
| 序列混合 / `sequence_blend_sop` | in:SOP、in2:SOP → out:SOP | 浏览器 | 按时间在两套匹配网格之间循环插值。<br>`speed=0.3`；`phase=0` |
| 轮廓蒙皮 / `skin_sop` | in:SOP、in2:SOP → out:SOP | 浏览器 | 连接拓扑匹配的两个截面，并可封闭两端。<br>`cap=True` |
| 顶点排序 / `sort_sop` | in:SOP → out:SOP | 浏览器 | 按坐标、距离或逆序重排顶点，并同步更新面索引与属性。<br>`axis=x`；`descending=False` |
| 弹性几何 / `spring_sop` | in:SOP → out:SOP | 浏览器 | 各顶点以阻尼弹簧追随输入几何，保存独立速度状态。<br>`stiffness=20`；`damping=6` |
| 表面随机撒点 / `sprinkle_sop` | in:SOP → out:SOP | 浏览器 | 按三角形面积加权分布点，使用可复现随机种子。<br>`count=500`；`seed=1` |
| 点精灵 / `sprite_sop` | in:SOP → out:SOP | 浏览器 | 将每个点扩展为 XY 朝向的小四边形并创建 UV。<br>`size=0.06` |
| 边界拉合 / `stitch_sop` | in:SOP、in2:SOP → out:SOP | 浏览器 | 将两路网格的近距离顶点向中点拉合后焊接。<br>`tolerance=0.1` |
| 网格细分 / `subdivide_sop` | in:SOP → out:SOP | 浏览器 | 共享边中点进行三角细分，可附加拉普拉斯平滑。<br>`iterations=1`；`smooth=0.2` |
| 超二次曲面 / `superquad_sop` | — → out:SOP | 浏览器 | 生成由两个指数控制的球体、方球或星状超二次曲面。<br>`exponent1=0.5`；`exponent2=0.5`；`segments=32` |
| 曲面交线 / `surfsect_sop` | in:SOP、in2:SOP → out:SOP | 浏览器 | 对两组三角面计算逐面对平面的线段交点，输出交线。 |
| 截面扫描 / `sweep_sop` | in:SOP、in2:SOP → out:SOP | 浏览器 | 沿第一路路径扫描第二路截面，使用平行移动标架。<br>`scale=0.2`；`closed=False` |
| 几何切换 / `switch_sop` | in:SOP、in2:SOP、in3:SOP → out:SOP | 浏览器 | 选择输入几何并保留属性和材质。<br>`index=0` |
| 立体文字 / `text_sop` | — → out:SOP | 浏览器 | 使用打包字体轮廓生成可挤出三维拉丁文字（当前字体不包含汉字）。<br>`text=TD OPEN`；`size=0.5`；`depth=0.12`；`bevel=0.01` |
| UV 贴图坐标 / `texture_sop` | in:SOP → out:SOP | 浏览器 | 创建平面、柱面或球面 UV 坐标，供 MAT 图像纹理使用。<br>`projection=spherical`；`repeat_u=1`；`repeat_v=1` |
| 图像轮廓追踪 / `trace_sop` | in:TOP → out:SOP | 浏览器 | 阈值化输入图像并输出像素边界线段。<br>`threshold=0.5`；`resolution=48` |
| 几何轨迹 / `trail_sop` | in:SOP → out:SOP | 浏览器 | 保存历史点位置，连接相同索引形成运动轨迹；总历史最多 25 万顶点。<br>`frames=24` |
| 范围裁剪 / `trim_sop` | in:SOP → out:SOP | 浏览器 | 用六个平面逐面裁剪网格，保留指定三维区间。<br>`min=-0.8`；`max=0.8` |
| 三角条带 / `tristrip_sop` | in:SOP → out:SOP | 浏览器 | 根据邻接关系生成 triangle_strip 基元属性，网格保持可渲染。 |
| 逐面顶点编辑 / `vertex_sop` | in:SOP → out:SOP | 浏览器 | 分离共享顶点以创建独立面角属性，再对指定顶点施加位移。<br>`index=0`；`dx=0.1`；`dy=0.1`；`dz=0.1` |
| 导入模型 / `file_in_sop` | — → out:SOP | 浏览器 | 导入 GLB、GLTF、FBX 或 OBJ 模型；依赖资源需要允许跨域访问。<br>`url=`；`format=auto` |
| 选择场景对象 / `import_select_sop` | in:COMP → out:SOP | 浏览器 | 从场景中提取一个对象，将其位置/旋转/缩放带回 SOP。<br>`index=0` |
| 骨骼捕获 / `capture_sop` | in:SOP、bones:COMP → out:SOP | 浏览器 | 根据点到骨骼段的距离生成最多四骨骼权重，供 Deform 线性蒙皮。<br>`falloff=2` |
| 骨骼影响区域 / `capture_region_sop` | in:SOP、bones:COMP → out:SOP | 浏览器 | 按胶囊形区域计算指定骨骼的捕获权重并写入颜色。<br>`index=0`；`radius=1` |
| 骨骼蒙皮变形 / `deform_sop` | in:SOP、bones:COMP → out:SOP | 浏览器 | 使用 Capture 生成的四骨骼权重和 COMP 骨骼姿态做线性混合蒙皮。 |
| 骨骼影响分组 / `bone_group_sop` | in:SOP → out:SOP | 浏览器 | 按捕获属性选择受指定骨骼影响的点，并创建命名组。<br>`index=0`；`threshold=0.1`；`name=bone_selection` |
| 关节链 / `arm_sop` | — → out:SOP | 浏览器 | 通过关节长度和局部角度构建平面正向运动学骨架折线。<br>`lengths=[1,0.8,0.6]`；`angles=[45,-60,45]` |
| 关节旋转 / `joint_sop` | in:SOP → out:SOP | 浏览器 | 围绕指定关节点旋转后续链条顶点。<br>`index=1`；`angle=30`；`axis=z` |
| 曲线交点 / `curvesect_sop` | in:SOP、in2:SOP → out:SOP | 浏览器 | 计算两条 XY 平面折线的线段交点，输出可编辑点云。 |
| Alembic · 外部桥接 / `ref_sop_alembic` | — → out:SOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Alembic native reader and animated mesh to scene JSON adapter。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=alembic` |
| CPlusPlus · 外部桥接 / `ref_sop_cplusplus` | — → out:SOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Native C++ compiler + SDK/plugin host adapter; exports portable data over the open bridge, not binary ABI compatibility。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=cpp` |
| Face Track · 外部桥接 / `ref_sop_face_track` | — → out:SOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Computer vision tracking model/runtime and explicit coordinate schema。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=tracking` |
| Kinect · 外部桥接 / `ref_sop_kinect` | — → out:SOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Microsoft Kinect SDK / libfreenect; a connected Kinect camera。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=kinect` |
| Oculus Rift · 外部桥接 / `ref_sop_oculus_rift` | — → out:SOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Meta/Oculus SDK + supported headset and native runtime。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=oculus` |
| OpenVR · 外部桥接 / `ref_sop_openvr` | — → out:SOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：OpenVR/SteamVR runtime + supported headset/controllers。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=openvr` |
| ZED · 外部桥接 / `ref_sop_zed` | — → out:SOP | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：Stereolabs ZED SDK + CUDA + connected ZED camera。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=zed` |
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

## OUT（1 个）

| 名称 / 类型 ID | 输入 → 输出 | 运行位置 | 用途与默认参数 |
| --- | --- | --- | --- |
| 画面输出 / `output` | in:TOP → — | 浏览器 | 最终画面输出。实时预览和导出使用此节点的结果。 |

## COMP（40 个）

| 名称 / 类型 ID | 输入 → 输出 | 运行位置 | 用途与默认参数 |
| --- | --- | --- | --- |
| 基础组件 / `base_comp` | in:any、in2:any、in3:any、in4:any → out:any、out2:any、out3:any、out4:any | 浏览器 | 包含独立的内部节点网络。双击进入；使用 In / Out 节点按编号连接父网络，支持嵌套、保存和撤销。Engine 在当前进程执行，不等同于 TouchEngine 进程隔离。 |
| 嵌套引擎 / `engine_comp` | in:any、in2:any、in3:any、in4:any → out:any、out2:any、out3:any、out4:any | 浏览器 | 包含独立的内部节点网络。双击进入；使用 In / Out 节点按编号连接父网络，支持嵌套、保存和撤销。Engine 在当前进程执行，不等同于 TouchEngine 进程隔离。 |
| 容器 / `container_comp` | in:any、in2:any、in3:any、in4:any → out:any、out2:any、out3:any、out4:any | 浏览器 | 包含独立的内部节点网络。双击进入；使用 In / Out 节点按编号连接父网络，支持嵌套、保存和撤销。Engine 在当前进程执行，不等同于 TouchEngine 进程隔离。 |
| 控件组件 / `widget_comp` | in:any、in2:any、in3:any、in4:any → out:any、out2:any、out3:any、out4:any | 浏览器 | 包含独立的内部节点网络。双击进入；使用 In / Out 节点按编号连接父网络，支持嵌套、保存和撤销。Engine 在当前进程执行，不等同于 TouchEngine 进程隔离。 |
| 按钮 / `button_comp` | in:any → out:TOP | 浏览器 | 可预览的交互面板。参数检查器提供控件操作，画面可继续连接到 TOP。数值可通过 Panel CHOP 读取。<br>`text=Hello TD Open`；`value=0`；`items=One ↵ Two ↵ Three`；`color=#a995fa`；`count=4`；`path=` |
| 输入框 / `field_comp` | in:any → out:TOP | 浏览器 | 可预览的交互面板。参数检查器提供控件操作，画面可继续连接到 TOP。数值可通过 Panel CHOP 读取。<br>`text=Hello TD Open`；`value=0`；`items=One ↵ Two ↵ Three`；`color=#a995fa`；`count=4`；`path=` |
| 列表 / `list_comp` | in:any → out:TOP | 浏览器 | 可预览的交互面板。参数检查器提供控件操作，画面可继续连接到 TOP。数值可通过 Panel CHOP 读取。<br>`text=Hello TD Open`；`value=0`；`items=One ↵ Two ↵ Three`；`color=#a995fa`；`count=4`；`path=` |
| 节点查看器 / `op_viewer_comp` | in:any → out:TOP | 浏览器 | 可预览的交互面板。参数检查器提供控件操作，画面可继续连接到 TOP。数值可通过 Panel CHOP 读取。<br>`text=Hello TD Open`；`value=0`；`items=One ↵ Two ↵ Three`；`color=#a995fa`；`count=4`；`path=` |
| 参数面板 / `parameter_comp` | in:any → out:TOP | 浏览器 | 可预览的交互面板。参数检查器提供控件操作，画面可继续连接到 TOP。数值可通过 Panel CHOP 读取。<br>`text=Hello TD Open`；`value=0`；`items=One ↵ Two ↵ Three`；`color=#a995fa`；`count=4`；`path=` |
| 滑杆 / `slider_comp` | in:any → out:TOP | 浏览器 | 可预览的交互面板。参数检查器提供控件操作，画面可继续连接到 TOP。数值可通过 Panel CHOP 读取。<br>`text=Hello TD Open`；`value=0`；`items=One ↵ Two ↵ Three`；`color=#a995fa`；`count=4`；`path=` |
| 表格面板 / `table_comp` | in:any → out:TOP | 浏览器 | 可预览的交互面板。参数检查器提供控件操作，画面可继续连接到 TOP。数值可通过 Panel CHOP 读取。<br>`text=Hello TD Open`；`value=0`；`items=One ↵ Two ↵ Three`；`color=#a995fa`；`count=4`；`path=` |
| 文本面板 / `text_comp` | in:any → out:TOP | 浏览器 | 可预览的交互面板。参数检查器提供控件操作，画面可继续连接到 TOP。数值可通过 Panel CHOP 读取。<br>`text=Hello TD Open`；`value=0`；`items=One ↵ Two ↵ Three`；`color=#a995fa`；`count=4`；`path=` |
| 时间控制 / `time_comp` | in:any → out:any | 浏览器 | 为内部节点网络提供独立时间域，支持速率、偏移和循环。双击进入，内部 In/Out 与 Base 相同。<br>`rate=1`；`offset=0`；`duration=10`；`loop=False` |
| 动画曲线 / `animation_comp` | — → out:CHOP | 浏览器 | 真正的命名关键帧动画曲线。JSON格式为通道名到 [秒,值] 序列，支持线性、平滑和保持插值。输出CHOP采样数据。<br>`keys={"x":[[0,0],[1,1],[2,0]],"y":[[0,1],[1,0],[2,1]]}`；`mode=linear`；`samples=128`；`sample_rate=60`；`loop=True` |
| 注释 / `annotate_comp` | in:any → out:TOP | 浏览器 | 可预览的交互面板。参数检查器提供控件操作，画面可继续连接到 TOP。数值可通过 Panel CHOP 读取。<br>`text=Hello TD Open`；`value=0`；`items=One ↵ Two ↵ Three`；`color=#a995fa`；`count=4`；`path=` |
| 输出窗口 / `window_comp` | in:any → out:TOP | 浏览器 | 可预览的交互面板。参数检查器提供控件操作，画面可继续连接到 TOP。数值可通过 Panel CHOP 读取。<br>`text=Hello TD Open`；`value=0`；`items=One ↵ Two ↵ Three`；`color=#a995fa`；`count=4`；`path=` |
| 选择面板 / `select_comp` | in:any → out:TOP | 浏览器 | 可预览的交互面板。参数检查器提供控件操作，画面可继续连接到 TOP。数值可通过 Panel CHOP 读取。<br>`text=Hello TD Open`；`value=0`；`items=One ↵ Two ↵ Three`；`color=#a995fa`；`count=4`；`path=` |
| 复制布局 / `replicator_comp` | in:any → out:TOP | 浏览器 | 按数量真正实例化内部TOP网络，独立执行每份副本并平铺输出。双击编辑模板，用 Replica Index CHOP 驱动每份副本差异。<br>`count=4` |
| 相机 / `camera_comp` | in:COMP → out:COMP | 浏览器 | 独立透视 / 正交相机，支持位置、目标、裁剪面和缩放。<br>`x=4`；`y=3`；`z=6`；`targetx=0`；`targety=0`；`targetz=0`；`projection=perspective`；`fov=45`；`near=0.01`；`far=1000`；`zoom=1` |
| 相机混合 / `camera_blend_comp` | in:COMP、in2:COMP → out:COMP | 浏览器 | 混合两路相机的位置、朝向目标、视角和裁剪范围。<br>`weight=0.5` |
| 环境基础光 / `ambient_light_comp` | in:COMP → out:COMP | 浏览器 | 在场景中添加均匀环境光。<br>`color=#bcc9ff`；`intensity=1` |
| 天空环境光 / `environment_light_comp` | in:COMP → out:COMP | 浏览器 | 独立天空/地面半球光；当前不提供 HDR 环境贴图。<br>`color=#ccdfff`；`ground_color=#403545`；`intensity=1` |
| 灯光 / `light_comp` | in:COMP → out:COMP | 浏览器 | 可编辑方向光、点光或聚光及衰减、位置、照射目标。<br>`x=4`；`y=3`；`z=6`；`targetx=0`；`targety=0`；`targetz=0`；`type=directional`；`color=#fff0de`；`intensity=3`；`distance=0`；`decay=2`；`angle=45` |
| 场景几何对象 / `geometry_comp` | in:SOP、material:MAT、scene:COMP → out:COMP | 浏览器 | 将 SOP 几何与 MAT 材质加入场景，保留独立对象变换。<br>`x=0`；`y=0`；`z=0`；`rx=0`；`ry=0`；`rz=0`；`sx=1`；`sy=1`；`sz=1`；`visible=True` |
| 场景组合 / `blend_comp` | in:COMP、in2:COMP → out:COMP | 浏览器 | 合并两路场景的对象和灯光，以权重插值相机。<br>`weight=0.5` |
| 场景变换 / `null_comp` | in:COMP → out:COMP | 浏览器 | 将场景对象组织到统一变换坐标中。<br>`x=0`；`y=0`；`z=0`；`rx=0`；`ry=0`；`rz=0`；`scale=1` |
| 刚体对象 / `actor_comp` | in:COMP → out:COMP | 浏览器 | 将场景几何设为动态或静态刚体，以盒 / 球碰撞体参与 Cannon 求解。<br>`index=-1`；`mass=1`；`shape=box`；`restitution=0.4`；`friction=0.3`；`vx=0`；`vy=0`；`vz=0`；`wx=0`；`wy=0`；`wz=0` |
| 场景力场 / `force_comp` | in:COMP → out:COMP | 浏览器 | 为刚体施加恒定方向、中心吸引或绕 Y 轴旋涡力。<br>`type=directional`；`strength=1`；`dx=1`；`dy=0`；`dz=0`；`centerx=0`；`centery=0`；`centerz=0` |
| 刚体约束 / `constraint_comp` | in:COMP → out:COMP | 浏览器 | 将两个刚体用距离、点对点或铰链约束连接。<br>`type=distance`；`a=0`；`b=1`；`distance=2`；`pivotAx=0`；`pivotAy=0`；`pivotAz=0`；`pivotBx=0`；`pivotBy=0`；`pivotBz=0`；`axisx=0`；`axisy=1`；`axisz=0` |
| 刚体求解器 / `bullet_solver_comp` | in:COMP → out:COMP | 浏览器 | 使用开源 Cannon 兼容实现刚体碰撞、力和约束；不兼容原生 Bullet SDK 或 TD 参数全集。<br>`gravity=-9.81`；`ground=True`；`ground_y=-2`；`substeps=8`；`paused=False` |
| 骨骼 / `bone_comp` | in:COMP → out:COMP | 浏览器 | 创建具备父级标识、静止端点及欧拉姿态的骨骼，供 Capture/Deform 使用。<br>`name=bone1`；`parent=`；`startx=0`；`starty=0`；`startz=0`；`endx=0`；`endy=1`；`endz=0`；`rx=0`；`ry=0`；`rz=0`；`display=True` |
| 对象操纵器 / `handle_comp` | in:COMP → out:COMP | 浏览器 | 对一个指定场景对象进行相对位移和旋转，保留其他对象变换。<br>`index=0`；`dx=0`；`dy=0`；`dz=0`；`rx=0`；`ry=0`；`rz=0` |
| 场景文字 / `geo_text_comp` | in:COMP、material:MAT → out:COMP | 浏览器 | 以带材质的三维拉丁文字对象加入场景。<br>`text=TD OPEN`；`size=0.5`；`depth=0.12`；`x=0`；`y=0`；`z=0` |
| 模型场景 / `fbx_comp` | in:COMP → out:COMP | 浏览器 | 把 FBX、OBJ 或 GLTF 模型资源加入可编辑场景；保留导入层级。<br>`url=`；`x=0`；`y=0`；`z=0`；`scale=1` |
| Nvidia Flow Emitter · 外部桥接 / `ref_comp_nvidia_flow_emitter` | — → out:DAT | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：NVIDIA Flow SDK + compatible NVIDIA GPU + native simulation adapter。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=nvidia_flow` |
| Shared Mem In / `ref_comp_shared_mem_in` | — → out:DAT | 浏览器 | 通过项目 data/io/sharedmem 中的 mmap 文件交换 JSON / 图像。开放格式，不兼容 TouchDesigner 专有共享内存 ABI。<br>`enabled=False`；`interval=100`；`channel=td-open` |
| Shared Mem Out / `ref_comp_shared_mem_out` | in:DAT → out:DAT | 浏览器 | 通过项目 data/io/sharedmem 中的 mmap 文件交换 JSON / 图像。开放格式，不兼容 TouchDesigner 专有共享内存 ABI。<br>`enabled=False`；`interval=100`；`channel=td-open` |
| USD · 外部桥接 / `ref_comp_usd` | — → out:DAT | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：OpenUSD native library and USD stage to scene JSON adapter。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=usd` |
| Nvidia Flex Solver · 外部桥接 / `ref_comp_nvidia_flex_solver` | — → out:DAT | 外部适配器（未内置） | 外部适配器（未内置原生驱动）。依赖：NVIDIA FleX SDK + compatible NVIDIA GPU + native solver adapter。通过开放桥接接收真实数据；没有设备/适配器时会明确提示等待。<br>`enabled=False`；`interval=100`；`channel=nvidia_flex` |
| GLSL 面板 / `glsl_comp` | in:TOP、mod:CHOP → out:TOP | 浏览器 | 实际编译并执行WebGL2 GLSL ES 3.00片段着色器，暴露uInput0/uInput1/uTime/uResolution/uMod；不是TD完整shader ABI。<br>`code=#version 300 es ↵ precision highp float; ↵ uniform sampler2D uInput0; ↵ uniform sampler2D uInput1; ↵ uniform vec2 uResolution; ↵ uniform float uTime; ↵ uniform float uMod; ↵ in vec2 vUV; ↵ out vec4 fragColor; ↵ void main(){ ↵   vec4 source=texture(uInput0,vUV); ↵   vec3 waves=0.5+0.5*cos(uTime+vUV.xyx*6.283+vec3(0,2,4)); ↵   fragColor=vec4(mix(waves,source.rgb,source.a*0.65),1.0); ↵ }` |

## MAT（13 个）

| 名称 / 类型 ID | 输入 → 输出 | 运行位置 | 用途与默认参数 |
| --- | --- | --- | --- |
| 恒定材质 / `constant_mat` | map:TOP → out:MAT | 浏览器 | 不受光照影响的颜色与图像纹理。<br>`color=#a8c9ed`；`opacity=1`；`double_side=True` |
| 深度材质 / `depth_mat` | — → out:MAT | 浏览器 | 把片元相机深度写为 RGBA 深度值。<br>`double_side=True` |
| GLSL 材质 / `glsl_mat` | map:TOP → out:MAT | 浏览器 | 可编辑顶点和片元着色器，提供 uTime/uColor/uOpacity/uTexture。<br>`color=#a8c9ed`；`opacity=1`；`double_side=True`；`vertex_shader=varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`；`fragment_shader=uniform float uTime; uniform float uOpacity; uniform vec3 uColor; varying vec2 vUv; void main(){gl_FragColor=vec4(uColor*(0.5+0.5*sin(vUv.x*20.0+uTime)),uOpacity);}` |
| 材质入口 / `in_mat` | in:MAT → out:MAT | 浏览器 | 接受来自外部连接的材质值。 |
| 线条材质 / `line_mat` | — → out:MAT | 浏览器 | 用于 SOP 线段几何的颜色和透明度。<br>`color=#a8c9ed`；`opacity=1`；`double_side=True` |
| 材质中继 / `null_mat` | in:MAT → out:MAT | 浏览器 | 保留上游材质描述，提供稳定连接点。 |
| 材质出口 / `out_mat` | in:MAT → out:MAT | 浏览器 | 导出上游材质值供场景使用。 |
| 物理材质 / `pbr_mat` | map:TOP、normal:TOP → out:MAT | 浏览器 | 支持金属度、粗糙度、清漆、透射、折射率和法线贴图。<br>`color=#a8c9ed`；`opacity=1`；`double_side=True`；`roughness=0.35`；`metalness=0.4`；`clearcoat=0.2`；`transmission=0`；`ior=1.5`；`emissive=#000000`；`emissive_intensity=1` |
| 高光材质 / `phong_mat` | map:TOP、normal:TOP → out:MAT | 浏览器 | 经典 Blinn-Phong 漫反射、高光、自发光和图像纹理。<br>`color=#a8c9ed`；`opacity=1`；`double_side=True`；`shininess=50`；`emissive=#000000` |
| 点精灵材质 / `point_sprite_mat` | map:TOP → out:MAT | 浏览器 | 为点云设置屏幕透视大小、颜色和图像纹理。<br>`color=#a8c9ed`；`opacity=1`；`double_side=True`；`size=0.06` |
| 选择材质 / `select_mat` | in:MAT、in2:MAT、in3:MAT → out:MAT | 浏览器 | 选择三路材质中的一路。<br>`index=0` |
| 信号切换材质 / `switch_mat` | in:MAT、in2:MAT、in3:MAT、index:CHOP → out:MAT | 浏览器 | 通过 CHOP 索引或参数切换材质。<br>`index=0` |
| 线框材质 / `wireframe_mat` | — → out:MAT | 浏览器 | 以三角线框显示网格表面。<br>`color=#a8c9ed`；`opacity=1`；`double_side=True` |
