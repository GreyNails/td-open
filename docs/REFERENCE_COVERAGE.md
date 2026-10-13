# 参考节点逐项进度

本次检查六张参考截图的 531 项，项目目录有 699 个入口。节点数量与完整兼容率不是一回事。

**可运行子集**表示已有所描述的实际算法；**相关子集**表示沿用已有节点但保留差距；**外部依赖**表示只有数据桥接，原生驱动未内置。

| 参考族 | 截图条目 | 可运行子集 | 相关子集 | 外部依赖 |
| --- | ---: | ---: | ---: | ---: |
| COMP | 40 | 37 | 0 | 3 |
| TOP | 137 | 91 | 6 | 40 |
| CHOP | 162 | 126 | 0 | 36 |
| SOP | 111 | 103 | 1 | 7 |
| MAT | 13 | 13 | 0 | 0 |
| DAT | 68 | 62 | 0 | 6 |

每个条目的实现和限制保存在 [完整 JSON 清单](reference-capabilities.json)，算法参数见 [节点手册](NODES.md)。

## 仍需要外部 SDK / 设备的条目

这些条目尚不能宣称补全。驱动开发使用 [I/O 适配器接口](IO_PROTOCOLS.md)；节点没有收到实际数据时会显示依赖错误。

| 族 | 参考名称 | 当前入口 |
| --- | --- | --- |
| COMP | Nvidia Flow Emitter | `ref_comp_nvidia_flow_emitter` |
| COMP | USD | `ref_comp_usd` |
| COMP | Nvidia Flex Solver | `ref_comp_nvidia_flex_solver` |
| TOP | CPlusPlus | `ref_top_cplusplus` |
| TOP | DirectX In | `ref_top_directx_in` |
| TOP | DirectX Out | `ref_top_directx_out` |
| TOP | Kinect | `ref_top_kinect` |
| TOP | Kinect Azure | `ref_top_kinect_azure` |
| TOP | Kinect Azure Select | `ref_top_kinect_azure_select` |
| TOP | Leap Motion | `ref_top_leap_motion` |
| TOP | MoSys | `ref_top_mosys` |
| TOP | MPCDI | `ref_top_mpcdi` |
| TOP | Ncam | `ref_top_ncam` |
| TOP | NDI In | `ref_top_ndi_in` |
| TOP | NDI Out | `ref_top_ndi_out` |
| TOP | Notch | `ref_top_notch` |
| TOP | Nvidia Background | `ref_top_nvidia_background` |
| TOP | Nvidia Denoise | `ref_top_nvidia_denoise` |
| TOP | Nvidia Flex | `ref_top_nvidia_flex` |
| TOP | Nvidia Flow | `ref_top_nvidia_flow` |
| TOP | Nvidia Upscaler | `ref_top_nvidia_upscaler` |
| TOP | OAK Select | `ref_top_oak_select` |
| TOP | Oculus Rift | `ref_top_oculus_rift` |
| TOP | OpenColorIO | `ref_top_opencolorio` |
| TOP | OpenVR | `ref_top_openvr` |
| TOP | Orbbec | `ref_top_orbbec` |
| TOP | Orbbec Select | `ref_top_orbbec_select` |
| TOP | Ouster | `ref_top_ouster` |
| TOP | Ouster Select | `ref_top_ouster_select` |
| TOP | Photoshop In | `ref_top_photoshop_in` |
| TOP | RealSense | `ref_top_realsense` |
| TOP | RenderStream In | `ref_top_renderstream_in` |
| TOP | RenderStream Out | `ref_top_renderstream_out` |
| TOP | Scalable Display | `ref_top_scalable_display` |
| TOP | STICK | `ref_top_stick` |
| TOP | Stype | `ref_top_stype` |
| TOP | Substance | `ref_top_substance` |
| TOP | Substance Select | `ref_top_substance_select` |
| TOP | Syphon Spout In | `ref_top_syphon_spout_in` |
| TOP | Syphon Spout Out | `ref_top_syphon_spout_out` |
| TOP | Video Device Out | `ref_top_video_device_out` |
| TOP | Vioso | `ref_top_vioso` |
| TOP | ZED | `ref_top_zed` |
| CHOP | Ableton Link | `ref_chop_ableton_link` |
| CHOP | Audio NDI | `ref_chop_audio_ndi` |
| CHOP | Audio VST | `ref_chop_audio_vst` |
| CHOP | Audio Web Render | `ref_chop_audio_web_render` |
| CHOP | BlackTrax | `ref_chop_blacktrax` |
| CHOP | Body Track | `ref_chop_body_track` |
| CHOP | CPlusPlus | `ref_chop_cplusplus` |
| CHOP | Face Track | `ref_chop_face_track` |
| CHOP | FreeD In | `ref_chop_freed_in` |
| CHOP | FreeD Out | `ref_chop_freed_out` |
| CHOP | Gesture | `ref_chop_gesture` |
| CHOP | Hog | `ref_chop_hog` |
| CHOP | Hokuyo | `ref_chop_hokuyo` |
| CHOP | Kinect | `ref_chop_kinect` |
| CHOP | Kinect Azure | `ref_chop_kinect_azure` |
| CHOP | Laser | `ref_chop_laser` |
| CHOP | Laser Device | `ref_chop_laser_device` |
| CHOP | Leap Motion | `ref_chop_leap_motion` |
| CHOP | Leuze ROD4 | `ref_chop_leuze_rod4` |
| CHOP | LTC In | `ref_chop_ltc_in` |
| CHOP | LTC Out | `ref_chop_ltc_out` |
| CHOP | MoSys | `ref_chop_mosys` |
| CHOP | Mouse Out | `ref_chop_mouse_out` |
| CHOP | Ncam | `ref_chop_ncam` |
| CHOP | OAK Device | `ref_chop_oak_device` |
| CHOP | OAK Select | `ref_chop_oak_select` |
| CHOP | Oculus Audio | `ref_chop_oculus_audio` |
| CHOP | Oculus Rift | `ref_chop_oculus_rift` |
| CHOP | OpenVR | `ref_chop_openvr` |
| CHOP | OptiTrack In | `ref_chop_optitrack_in` |
| CHOP | Pangolin | `ref_chop_pangolin` |
| CHOP | PosiStageNet | `ref_chop_posistagenet` |
| CHOP | RenderStream In | `ref_chop_renderstream_in` |
| CHOP | Stype In | `ref_chop_stype_in` |
| CHOP | Stype Out | `ref_chop_stype_out` |
| CHOP | ZED | `ref_chop_zed` |
| SOP | Alembic | `ref_sop_alembic` |
| SOP | CPlusPlus | `ref_sop_cplusplus` |
| SOP | Face Track | `ref_sop_face_track` |
| SOP | Kinect | `ref_sop_kinect` |
| SOP | Oculus Rift | `ref_sop_oculus_rift` |
| SOP | OpenVR | `ref_sop_openvr` |
| SOP | ZED | `ref_sop_zed` |
| DAT | CPlusPlus | `ref_dat_cplusplus` |
| DAT | EtherDream | `ref_dat_etherdream` |
| DAT | MPCDI | `ref_dat_mpcdi` |
| DAT | NDI | `ref_dat_ndi` |
| DAT | SocketIO | `ref_dat_socketio` |
| DAT | WebRTC | `ref_dat_webrtc` |

## 保留原差距的相关实现

| 族 | 参考名称 | 本项目实现 | 原审查差距 |
| --- | --- | --- | --- |
| TOP | Add | `composite_add` | 仅两输入Canvas加色，未兼容原TOP公共格式/分辨率控制。 |
| TOP | Cross | `switch_top` | 可对两路画面线性混合；原Cross的完整定位/格式未实现。 |
| TOP | Movie File In | `media` | 浏览器素材读取；缺序列、专业解码、帧精确寻址与硬件解码控制。 |
| TOP | Multiply | `composite_multiply` | Canvas两图相乘混合；无浮点/HDR原语义兼容。 |
| TOP | Over | `composite_over` | 基础alpha叠加，缺原TOP完整变换和格式控制。 |
| TOP | Screen | `composite_screen` | 基础Canvas滤色混合。 |
| SOP | Noise | `noise_sop` | 有限三角函数噪声扰动网格顶点，缺少完整噪声类型、属性及时间控制。 |

此外，截图没有列出的文件兼容、POP、完整参数系统、专业音视频与演出同步等差距仍见 [功能矩阵](FEATURE_MATRIX.md)。

复现：`node scripts/sync-catalog.mjs` 后运行 `.venv/bin/python scripts/audit-reference-capabilities.py`。不需要分发用户提供的截图。
