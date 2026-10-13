import type { ExampleTemplate, Recipe } from "./templates";

const local = (
  id: string,
  name: string,
  description: string,
  learn: string,
  recipe: Recipe,
  advanced = false,
): ExampleTemplate => ({
  id,
  name,
  category: "本地 AI",
  description,
  learn,
  recipe,
  requires: "local",
  level: advanced ? "进阶" : "入门",
});
const imagePrompt =
  "A small ceramic robot, clean white background, studio photography";
export const localTemplates: ExampleTemplate[] = [
  local(
    "local-flux",
    "本地 · FLUX.2 图片",
    "四步采样生成图片，再调色输出。",
    "安装 FLUX.2 Klein；选中生成节点点击运行，比较不同种子。",
    {
      nodes: [
        [
          "local_image",
          { model_id: "flux-klein-4b", prompt: imagePrompt, steps: 4 },
        ],
        "color",
        "output",
      ],
      edges: [
        [0, 1],
        [1, 2],
      ],
    },
  ),
  local(
    "local-z-image",
    "本地 · Z-Image 中文海报",
    "用中文提示词生成图像，再接入实时合成。",
    "安装 Z-Image Turbo；先用 512×512、9 步、CFG 1 手动生成。",
    {
      nodes: [
        [
          "local_image",
          {
            model_id: "z-image-turbo",
            prompt:
              "一张极简海报，白色陶瓷机器人，浅蓝色背景，标题文字：你好，未来",
            steps: 9,
          },
        ],
        "output",
      ],
      edges: [[0, 1]],
    },
  ),
  local(
    "local-edit",
    "本地 · 参考图编辑",
    "把图片节点直接连接到 FLUX.2 编辑输入。",
    "在素材节点填写或导入图片；提示词描述修改，运行编辑节点。",
    {
      nodes: [
        "media",
        [
          "local_image_edit",
          {
            prompt:
              "Change the robot to polished blue ceramic, preserve the pose and background",
          },
        ],
        "output",
      ],
      edges: [
        [0, 1, "image"],
        [1, 2],
      ],
    },
  ),
  local(
    "local-img2img",
    "本地 · 图生图",
    "将程序纹理送入 Z-Image 图生图，探索结构与降噪强度。",
    "安装 Z-Image；运行图生图节点，比较 denoise 0.3 和 0.7。",
    {
      nodes: [
        ["noise", { scale: 5 }],
        [
          "local_image_to_image",
          {
            prompt: "An abstract watercolor landscape, soft pastel colors",
            denoise: 0.65,
          },
        ],
        "output",
      ],
      edges: [
        [0, 1, "image"],
        [1, 2],
      ],
    },
  ),
  local(
    "local-inpaint",
    "本地 · 局部重绘",
    "原图与独立遮罩控制重绘区域，保留未遮罩的像素。",
    "导入图片和白色需重绘、黑色保留的遮罩；两者连线后手动运行。",
    {
      nodes: [
        ["media", { url: "" }],
        ["media", { url: "" }],
        ["local_inpaint", { prompt: "A small red flower in a ceramic vase" }],
        "output",
      ],
      edges: [
        [0, 2, "image"],
        [1, 2, "mask"],
        [2, 3],
      ],
    },
    true,
  ),
  local(
    "local-music",
    "本地 · 音乐与声音可视化",
    "ACE-Step 生成 WAV，完整 PCM 进入音频分析和粒子系统。",
    "运行音乐节点；点击读取完整音频为 PCM，再观察声音控制画面。",
    {
      nodes: ["local_music", "channel_analyze", "particles", "output"],
      edges: [
        [0, 1],
        [1, 2, "mod"],
        [2, 3],
      ],
    },
  ),
  local(
    "local-3d",
    "本地 · 图片变成三维",
    "Hunyuan3D 2.1 生成可下载的 GLB，再在工作台渲染。",
    "导入单物体参考图片，运行三维节点；此预设生成几何，不包含 PBR 纹理。",
    {
      nodes: [
        "media",
        "local_3d",
        ["render", { speed: 0, wireframe: false }],
        "output",
      ],
      edges: [
        [0, 1, "image"],
        [1, 2],
        [2, 3],
      ],
    },
  ),
  local(
    "local-demucs",
    "本地 · 四轨音乐拆分",
    "Demucs 将音频分成人声、鼓、贝斯与其余乐器。",
    "在分轨节点导入音频；运行后分别下载四条 WAV，可选择某轨进入分析。",
    {
      nodes: [
        ["local_stems", { model_id: "demucs-4" }],
        "channel_analyze",
        "particles",
        "output",
      ],
      edges: [
        [0, 1],
        [1, 2, "mod"],
        [2, 3],
      ],
    },
  ),
  local(
    "local-melband",
    "本地 · 人声与伴奏",
    "MelBand RoFormer 从同一音频分离人声和伴奏。",
    "安装 MelBand；导入音频手动运行，试听两条结果并选为输出。",
    {
      nodes: [
        ["local_stems", { model_id: "melband-roformer" }],
        "channel_analyze",
        "particles",
        "output",
      ],
      edges: [
        [0, 1],
        [1, 2, "mod"],
        [2, 3],
      ],
    },
  ),
  local(
    "local-video",
    "本地 · 文生视频",
    "Wan 2.2 TI2V 5B 输出 MP4，接入工作台预览。",
    "先从 512×320、17 帧开始；视频采样期间可以编辑其他面板。",
    {
      nodes: [
        [
          "local_video",
          {
            prompt:
              "A tiny ceramic robot slowly waves one arm in a white studio, smooth movement",
          },
        ],
        "output",
      ],
      edges: [[0, 1]],
    },
  ),
  local(
    "local-image-video",
    "本地 · 图生视频",
    "使用图片素材作为 Wan 的起始帧。",
    "导入图片，连到视频节点；修改运动提示词后运行。",
    {
      nodes: [
        "media",
        [
          "local_video",
          {
            prompt:
              "The robot gently turns its head, a slow camera push in, natural movement",
          },
        ],
        "output",
      ],
      edges: [
        [0, 1, "image"],
        [1, 2],
      ],
    },
  ),
  local(
    "local-comfy-z",
    "Comfy · 完整 Z-Image 采样网络",
    "拆开模型、文本编码、潜空间、采样和保存步骤，组成原生 ComfyUI 网络。",
    "安装 Z-Image 后选中 Comfy 保存图片节点运行；可以替换模型、添加 LoRA 或修改采样参数。",
    {
      nodes: [
        ["comfy_unet", { unet_name: "z_image_turbo_int8_convrot.safetensors" }],
        [
          "comfy_clip",
          {
            clip_name: "qwen_3_4b_fp8_mixed.safetensors",
            type: "lumina2",
            device: "cpu",
          },
        ],
        ["comfy_vae_loader", { vae_name: "ae.safetensors" }],
        ["comfy_text", { text: imagePrompt }],
        "comfy_zero_condition",
        "comfy_latent",
        ["comfy_flow_sampling", { shift: 3 }],
        [
          "comfy_sampler",
          { steps: 9, cfg: 1, sampler_name: "euler", scheduler: "simple" },
        ],
        "comfy_vae_decode",
        "comfy_save_image",
        "output",
      ],
      edges: [
        [0, 6, "model", "model"],
        [1, 3, "clip", "clip"],
        [3, 4, "conditioning", "conditioning"],
        [3, 7, "positive", "conditioning"],
        [4, 7, "negative", "conditioning"],
        [5, 7, "latent_image", "samples"],
        [6, 7, "model", "model"],
        [7, 8, "samples", "samples"],
        [2, 8, "vae", "vae"],
        [8, 9, "images", "image"],
        [9, 10],
      ],
    },
    true,
  ),
];
