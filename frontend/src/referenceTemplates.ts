import type { ExampleTemplate } from "./templates";
import type { GraphNode, Project } from "./types";
export const referenceTemplates: ExampleTemplate[] = [
  {
    id: "editable-scene-material",
    name: "相机、灯光与材质",
    category: "三维",
    level: "入门",
    description: "用独立相机和灯光照亮带动态纹理的 PBR 立方体。",
    learn:
      "调整 Camera 的位置、PBR 的粗糙度，以及 Light 的方向，观察各自作用。",
    recipe: {
      nodes: [
        "box",
        "texture_sop",
        "noise",
        ["pbr_mat", { metalness: 0.1, roughness: 0.6 }],
        "geometry_comp",
        "ambient_light_comp",
        "light_comp",
        ["camera_comp", { x: 3, y: 2, z: 4 }],
        "render",
        "output",
      ],
      edges: [
        [0, 1],
        [1, 4],
        [2, 3, "map"],
        [3, 4, "material"],
        [4, 5],
        [5, 6],
        [6, 7],
        [7, 8],
        [8, 9],
      ],
    },
  },
  {
    id: "boolean-mesh-lab",
    name: "布尔建模实验",
    category: "三维",
    level: "进阶",
    description: "从立方体中减去球体，真实生成切口网格。",
    learn:
      "移动 Transform 改变切口，再将 Boolean 从 subtract 切换到 union 或 intersect。",
    recipe: {
      nodes: [
        "box",
        ["sphere", { radius: 1, detail: 12 }],
        ["transform_sop", { x: 0.65, y: 0.65, z: 0.65 }],
        ["boolean_sop", { operation: "subtract" }],
        ["pbr_mat", { color: "#f4a47f", roughness: 0.55 }],
        "geometry_comp",
        "ambient_light_comp",
        "light_comp",
        ["camera_comp", { x: 3, y: 2, z: 4 }],
        "render",
        "output",
      ],
      edges: [
        [0, 3],
        [1, 2],
        [2, 3, "in2"],
        [3, 5],
        [4, 5, "material"],
        [5, 6],
        [6, 7],
        [7, 8],
        [8, 9],
        [9, 10],
      ],
    },
  },
  {
    id: "bone-capture-deform",
    name: "骨骼捕获与蒙皮",
    category: "三维",
    level: "进阶",
    description: "对一条细分平面捕获骨骼权重，再根据骨骼姿态变形。",
    learn: "调整右侧 Bone 的 rz，观察 Deform 计算后的真实顶点位置。",
    recipe: {
      nodes: [
        ["plane", { width: 1, height: 2, detail: 16 }],
        "capture_sop",
        ["bone_comp", { name: "lower", starty: -1, endy: 0, display: false }],
        [
          "bone_comp",
          { name: "upper", parent: "lower", endy: 1, display: false },
        ],
        "deform_sop",
        ["bone_comp", { name: "lower", starty: -1, endy: 0, display: false }],
        [
          "bone_comp",
          { name: "upper", parent: "lower", endy: 1, rz: 65, display: false },
        ],
        ["render", { speed: 0, color: "#a6d3ff" }],
        "output",
      ],
      edges: [
        [0, 1],
        [2, 3],
        [3, 1, "bones"],
        [1, 4],
        [5, 6],
        [6, 4, "bones"],
        [4, 7],
        [7, 8],
      ],
    },
  },
  {
    id: "rigid-body-collision",
    name: "刚体落地碰撞",
    category: "三维",
    level: "进阶",
    description: "球体受重力下落，与静态平台碰撞回弹。",
    learn:
      "调整 Actor 的弹性和质量；暂停播放可检查姿态。求解使用 Cannon 开源实现。",
    recipe: {
      nodes: [
        ["sphere", { radius: 0.5, detail: 16 }],
        ["geometry_comp", { y: 2 }],
        "actor_comp",
        ["box", { width: 5, height: 0.2, depth: 4 }],
        ["geometry_comp", { y: -2 }],
        ["actor_comp", { index: 1, mass: 0 }],
        "bullet_solver_comp",
        "light_comp",
        "ambient_light_comp",
        ["camera_comp", { x: 4, y: 2.5, z: 6 }],
        "render",
        "output",
      ],
      edges: [
        [0, 1],
        [1, 2],
        [3, 4],
        [2, 4, "scene"],
        [4, 5],
        [5, 6],
        [6, 7],
        [7, 8],
        [8, 9],
        [9, 10],
        [10, 11],
      ],
    },
  },
  {
    id: "top-to-heightfield",
    name: "纹理变成地形",
    category: "三维",
    level: "入门",
    description: "把二维纹理的亮度采样为三维顶点高度。",
    learn: "调整 Raster 的网格精度与高度，再替换前面的任意图像节点。",
    recipe: {
      nodes: [
        "noise",
        ["raster_sop", { height: 1.5, resolution: 48 }],
        "texture_sop",
        ["pbr_mat", { color: "#acd6ca", metalness: 0.15, roughness: 0.7 }],
        "geometry_comp",
        "light_comp",
        "ambient_light_comp",
        ["camera_comp", { x: 3, y: 3, z: 4 }],
        "render",
        "output",
      ],
      edges: [
        [0, 1],
        [1, 2],
        [2, 4],
        [3, 4, "material"],
        [4, 5],
        [5, 6],
        [6, 7],
        [7, 8],
        [8, 9],
      ],
    },
  },
  {
    id: "implicit-gyroid",
    name: "Gyroid 等值曲面",
    category: "三维",
    level: "进阶",
    description: "直接采样三维标量场，提取连续的周期曲面。",
    learn:
      "改变 Iso Surface 的 iso 阈值与场尺度；切换 sphere 或 torus 比较场函数。",
    recipe: {
      nodes: [
        ["iso_surface_sop", { resolution: 18, scale: 2 }],
        "geometry_comp",
        ["pbr_mat", { color: "#a5b8ff", metalness: 0.35, roughness: 0.4 }],
        "light_comp",
        "ambient_light_comp",
        ["camera_comp", { x: 5, y: 3, z: 6 }],
        "render",
        "output",
      ],
      edges: [
        [0, 1],
        [2, 1, "material"],
        [1, 3],
        [3, 4],
        [4, 5],
        [5, 6],
        [6, 7],
      ],
    },
  },
];
referenceTemplates.push(
  {
    id: "glsl-surface-study",
    name: "编写三维着色器",
    category: "三维",
    level: "进阶",
    description: "用 GLSL 片元着色器在球面上生成随时间变化的条纹。",
    learn: "修改 GLSL MAT 的片元代码，uTime 是时间，vUv 是网格贴图坐标。",
    recipe: {
      nodes: [
        "sphere",
        "glsl_mat",
        "geometry_comp",
        "camera_comp",
        "render",
        "output",
      ],
      edges: [
        [0, 2],
        [1, 2, "material"],
        [2, 3],
        [3, 4],
        [4, 5],
      ],
    },
  },
  {
    id: "height-normal-material",
    name: "高度图与凹凸材质",
    category: "三维",
    level: "进阶",
    description: "把图像高度差转为法线贴图，驱动物理材质表面光照。",
    learn: "调节 Normal Map 的 strength，与改变球体真实顶点的效果作比较。",
    recipe: {
      nodes: [
        "noise",
        "ref_top_normal_map",
        ["sphere", { detail: 48 }],
        "pbr_mat",
        "geometry_comp",
        "light_comp",
        "ambient_light_comp",
        ["camera_comp", { x: 3, y: 1.5, z: 4 }],
        "render",
        "output",
      ],
      edges: [
        [0, 1],
        [1, 3, "normal"],
        [0, 3, "map"],
        [2, 4],
        [3, 4, "material"],
        [4, 5],
        [5, 6],
        [6, 7],
        [7, 8],
        [8, 9],
      ],
    },
  },
  {
    id: "curve-sweep-surface",
    name: "沿路径扫描截面",
    category: "三维",
    level: "进阶",
    description: "将矩形轮廓沿三维控制曲线扫描，生成可继续编辑的网格。",
    learn: "修改 Add 的点坐标改变路径，修改 Rectangle 改变横截面。",
    recipe: {
      nodes: [
        [
          "add_sop",
          {
            points: "[[-1,-1,0],[-0.6,0,0.4],[0.5,0.7,0],[1,1,-0.5]]",
            faces: "[]",
            connect: true,
          },
        ],
        ["rectangle_sop", { width: 1, height: 0.5 }],
        "sweep_sop",
        ["render", { wireframe: false, speed: 0.15, color: "#b4dccc" }],
        "output",
      ],
      edges: [
        [0, 2],
        [1, 2, "in2"],
        [2, 3],
        [3, 4],
      ],
    },
  },
  {
    id: "surface-points-sprites",
    name: "表面撒点与精灵",
    category: "三维",
    level: "入门",
    description: "按面积在球面均匀撒点，再转换为带 UV 的小四边形。",
    learn: "比较 Sprinkle 的随机种子与 Sprite 的大小，点分布仍跟随原曲面。",
    recipe: {
      nodes: [
        ["sphere", { radius: 1.2, detail: 20 }],
        ["sprinkle_sop", { count: 700, seed: 7 }],
        ["sprite_sop", { size: 0.05 }],
        ["render", { wireframe: false, color: "#f7c594", speed: 0.25 }],
        "output",
      ],
      edges: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4],
      ],
    },
  },
  {
    id: "named-topology-groups",
    name: "点组驱动建模",
    category: "三维",
    level: "进阶",
    description: "按空间位置创建命名点组，只移动组内的网格顶点。",
    learn:
      "改变 Group 的球心与半径，再调节 Point 的位移，未入组选点会保持原位。",
    recipe: {
      nodes: [
        ["sphere", { detail: 20 }],
        ["group_sop", { name: "upper", mode: "sphere", y: 1, radius: 1 }],
        [
          "point_sop",
          {
            group: "upper",
            y: 0.5,
            scale: 1.1,
            set_color: true,
            color: "#ecaa76",
          },
        ],
        ["render", { wireframe: false, color: "#8acadb", speed: 0.1 }],
        "output",
      ],
      edges: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4],
      ],
    },
  },
  {
    id: "profile-loft-vase",
    name: "轮廓放样曲面",
    category: "三维",
    level: "进阶",
    description: "连接两条不同尺寸的轮廓，生成具有过渡层的四边形曲面。",
    learn: "改变两端轮廓的尺寸、位置或旋转，观察放样网格。",
    recipe: {
      nodes: [
        ["rectangle_sop", { width: 1.8, height: 1.8 }],
        ["rectangle_sop", { width: 0.7, height: 0.7 }],
        ["transform_sop", { z: 2, rz: 45 }],
        ["polyloft_sop", { count: 32, layers: 18 }],
        ["render", { wireframe: true, color: "#9abcf3", speed: 0.15 }],
        "output",
      ],
      edges: [
        [0, 3],
        [1, 2],
        [2, 3, "in2"],
        [3, 4],
        [4, 5],
      ],
    },
  },
  {
    id: "image-fourier-spectrum",
    name: "图像二维傅里叶频谱",
    category: "图像处理",
    level: "进阶",
    description: "查看棋盘图案的二维频率分布，而不是音频频谱。",
    learn: "改变 Checker 的格子尺度，观察频谱亮点的位置变化。",
    recipe: {
      nodes: [
        "checkerboard",
        ["ref_top_spectrum", { mode: "magnitude", size: "128", gain: 0.4 }],
        "output",
      ],
      edges: [
        [0, 1],
        [1, 2],
      ],
    },
  },
  {
    id: "image-fourier-reconstruction",
    name: "傅里叶变换与还原",
    category: "图像处理",
    level: "进阶",
    description: "保留真实复数频域数据，再通过逆变换重建图像亮度。",
    learn: "比较输入与末端图像；Spectrum 节点之间传递的是复数频谱缓存。",
    recipe: {
      nodes: [
        "noise",
        ["ref_top_spectrum", { size: "128" }],
        ["ref_top_spectrum", { mode: "inverse", size: "128" }],
        "output",
      ],
      edges: [
        [0, 1],
        [1, 2],
        [2, 3],
      ],
    },
  },
  {
    id: "projective-corner-pin",
    name: "四角投影映射",
    category: "图像处理",
    level: "入门",
    description: "用四个角点执行透视投影，将棋盘映射到任意四边形。",
    learn: "编辑 Corner Pin 的四个归一化坐标，形成投影幕布或倾斜屏幕。",
    recipe: {
      nodes: ["checkerboard", "ref_top_corner_pin", "output"],
      edges: [
        [0, 1],
        [1, 2],
      ],
    },
  },
  {
    id: "motion-optical-flow",
    name: "图像运动光流",
    category: "图像处理",
    level: "进阶",
    description: "比较连续渲染帧，估计局部图像运动方向与速度。",
    learn: "播放时观察方向颜色；暂停后相邻帧运动将归零。",
    recipe: {
      nodes: [
        "noise",
        ["ref_top_optical_flow", { scale: 0.08, window: 2 }],
        "output",
      ],
      edges: [
        [0, 1],
        [1, 2],
      ],
    },
  },
  {
    id: "pcm-audio-spectrum",
    name: "PCM 音频频谱分析",
    category: "音频与信号",
    level: "进阶",
    description: "生成真实音频采样缓冲，再计算 Hann 窗 FFT 幅度曲线。",
    learn: "修改 Audio Oscillator 的 frequency，频谱中的峰值随之移动。",
    recipe: {
      nodes: [
        ["audio_oscillator", { samples: 1024, frequency: 1500 }],
        "audio_spectrum_chop",
        ["ref_top_op_viewer", { source: "$node:1" }],
        "output",
      ],
      edges: [
        [0, 1],
        [2, 3],
      ],
    },
  },
  {
    id: "pcm-lowpass-filter",
    name: "采样波形低通滤波",
    category: "音频与信号",
    level: "进阶",
    description: "比较方波与双二阶低通滤波后的真实采样曲线。",
    learn: "调整滤波器截止频率，观察高频边沿如何变平滑。",
    recipe: {
      nodes: [
        ["audio_oscillator", { samples: 256, frequency: 800, wave: "square" }],
        ["audio_filter_chop", { frequency: 1000 }],
        "channel_merge",
        ["ref_top_op_viewer", { source: "$node:2" }],
        "output",
      ],
      edges: [
        [0, 1],
        [0, 2],
        [1, 2, "in2"],
        [3, 4],
      ],
    },
  },
  {
    id: "native-table-selection",
    name: "原生表格数据处理",
    category: "数据与文字",
    level: "入门",
    description: "把 CSV 保存为二维表格，选择部分数据并可视化显示。",
    learn: "修改 Table 的 CSV 内容，再调整 Select 的行列范围。",
    recipe: {
      nodes: [
        [
          "native_table",
          {
            csv: "name,category,value\nFlow,TOP,12\nPulse,CHOP,24\nSurface,SOP,36\nScene,COMP,48",
          },
        ],
        "native_select",
        ["ref_top_op_viewer", { source: "$node:1" }],
        "output",
      ],
      edges: [
        [0, 1],
        [2, 3],
      ],
    },
  },
  {
    id: "nested-image-component",
    name: "把效果封装为组件",
    category: "入门",
    level: "入门",
    description: "将着色器与辉光封装在可进入编辑的 Base 子网络中。",
    learn: "双击 Base 进入内部网络；In/Out 节点将父级图像传入并把效果传回。",
    recipe: {
      nodes: ["noise", "base_comp", "output"],
      edges: [
        [0, 1],
        [1, 2],
      ],
    },
  },
);
/** Resolve per-project node references and construct the one actual nested network example. */
export function decorateReferenceProject(
  project: Project,
  makeNode: (type: string, x?: number, y?: number) => GraphNode,
): Project {
  if (
    !referenceTemplates.some(
      (example) => example.id === project.settings?.preset,
    )
  )
    return project;
  for (const node of project.nodes)
    for (const key of ["source", "path"]) {
      const value = node.data.params[key];
      if (typeof value === "string" && value.startsWith("$node:")) {
        const target = project.nodes[Number(value.slice(6))];
        if (target) node.data.params[key] = "/" + target.id;
      }
    }
  if (project.settings?.preset === "nested-image-component") {
    const component = project.nodes.find((node) => node.type === "base_comp")!;
    const nodes = [
      makeNode("network_in_top", 0, 0),
      makeNode("ref_top_glsl", 245, 0),
      makeNode("ref_top_bloom", 490, 0),
      makeNode("network_out_top", 735, 0),
    ];
    component.data.graph = {
      id: "net_" + component.id,
      name: "可复用纹理效果",
      version: 1,
      nodes,
      edges: nodes.slice(1).map((node, index) => ({
        id: `internal_${index}`,
        source: nodes[index].id,
        target: node.id,
        sourceHandle: "out",
        targetHandle: "in",
      })),
    };
  }
  return project;
}
