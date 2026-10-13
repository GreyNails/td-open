import type { NodeSpec } from "../types";
const codes: Record<string, string> = {
  CHOP: 'def cook(inputs, time):\n    import math\n    return {"kind":"channels", "channels":[{"name":"sine", "samples":[math.sin(i/32*math.tau + time) for i in range(128)]}], "sampleRate":60, "start":0, "timeSlice":False}',
  DAT: 'def cook(inputs, time):\n    return {"kind":"table", "rows":[["name","value"],["time",str(time)],["message","Hello Python"]]}',
  SOP: 'def cook(inputs, time):\n    return {"shape":"mesh", "mesh":{"positions":[[-1,-1,0],[1,-1,0],[0,1,0]], "faces":[[0,1,2]]}}',
  TOP: 'def cook(inputs, time):\n    import base64, math\n    width, height = 128, 72\n    rgba = bytes(v for y in range(height) for x in range(width) for v in (int(255*x/width),int(255*y/height),160,255))\n    return {"kind":"image", "width":width, "height":height, "rgba":base64.b64encode(rgba).decode()}',
};
export const pythonCatalog: NodeSpec[] = ["TOP", "CHOP", "DAT", "SOP"].map(
  (family) => ({
    type: "python_script_" + family.toLowerCase(),
    label: "Python 脚本 " + family,
    english: "Script Python " + family,
    family,
    description:
      "显式点击运行 Python 才会执行 cook(inputs, time)。使用本机账户权限，支持安装的 Python 包；脚本与日志保存在本项目。返回 TD Open 的通道/表格/网格/图像数据，不支持 TouchDesigner op()/scriptOp 对象。",
    inputs: [{ id: "in", kind: family, label: "输入" }],
    outputs: [{ id: "out", kind: family, label: "脚本结果" }],
    params: [
      {
        key: "code",
        label: "Python 代码",
        type: "text",
        default: codes[family],
      },
    ],
    reference: {
      family,
      name: "Script",
      level: "subset",
      note: "真实 Python 回调，手动执行、10 秒超时；TD Open 数据结构，非 TouchDesigner Python API。",
    },
  }),
);
