"""Operator descriptions and the deliberately small Python execution extension API."""

import importlib
import pkgutil
from collections.abc import Callable
from typing import Any

NODE_TYPES: dict[str, dict[str, Any]] = {}
NODE_EVALUATORS: dict[str, Callable] = {}


def port(id: str, kind: str, label: str = "") -> dict:
    return {"id": id, "kind": kind, "label": label or id}


def parameter(key: str, label: str, default: Any, type: str = "number", **kw) -> dict:
    return {"key": key, "label": label, "type": type, "default": default, **kw}


def register_operator(spec: dict, evaluator: Callable | None = None) -> None:
    """Register a trusted local plugin. evaluator(params, inputs, time) returns JSON."""
    key = spec["type"]
    if key in NODE_TYPES:
        raise ValueError(f"Operator already registered: {key}")
    spec.setdefault("inputs", [])
    spec.setdefault("outputs", [])
    spec.setdefault("params", [])
    spec.setdefault("runtime", "server" if evaluator else "browser")
    spec["defaults"] = {p["key"]: p["default"] for p in spec["params"]}
    NODE_TYPES[key] = spec
    if evaluator:
        NODE_EVALUATORS[key] = evaluator


def _node(type, label, family, description, inputs=(), outputs=(), params=(), runtime="browser"):
    register_operator(dict(type=type, label=label, family=family, description=description,
                           inputs=list(inputs), outputs=list(outputs), params=list(params), runtime=runtime))


TEX = port("out", "TOP", "图像")
SIG = port("out", "CHOP", "数值")
TIN = port("in", "TOP", "图像输入")
MOD = port("mod", "CHOP", "调制")
P = parameter

_node("noise", "流动噪声", "TOP", "生成随时间变化的程序纹理，作为视觉作品的起点。", [MOD], [TEX], [P("scale", "纹理尺度", 3, min=0.2, max=12, step=0.01), P("speed", "流动速度", 0.25, min=0, max=2, step=0.01), P("detail", "细节层次", 4, min=1, max=6, step=1), P("seed", "随机种子", 1, min=0, max=100, step=1)])
_node("ramp", "渐变", "TOP", "创建两种颜色之间的渐变。", [], [TEX], [P("angle", "角度", 45, min=0, max=360, step=1), P("color1", "起始颜色", "#9c6dff", "color"), P("color2", "结束颜色", "#ff9055", "color")])
_node("shape", "形状", "TOP", "绘制基础几何图形。", [], [TEX], [P("shape", "形状", "circle", "select", options=["circle", "rectangle"]), P("size", "大小", 0.35, min=0.05, max=1, step=0.01), P("color", "颜色", "#b696ff", "color")])
_node("color", "颜色调整", "TOP", "调整输入图像的亮度、饱和度与色相。", [TIN], [TEX], [P("hue", "色相", 0, min=-180, max=180, step=1), P("saturation", "饱和度", 1.2, min=0, max=3, step=0.01), P("brightness", "亮度", 1.1, min=0, max=3, step=0.01)])
_node("blur", "模糊", "TOP", "柔化输入图像。", [TIN], [TEX], [P("radius", "模糊半径", 8, min=0, max=40, step=1), P("glow", "辉光", 0.5, min=0, max=2, step=0.01)])
_node("transform", "变换", "TOP", "平移、缩放并旋转图像。", [TIN, MOD], [TEX], [P("rotate", "旋转", 0, min=-180, max=180, step=1), P("scale", "缩放", 1, min=0.1, max=3, step=0.01), P("x", "水平位置", 0, min=-1, max=1, step=0.01), P("y", "垂直位置", 0, min=-1, max=1, step=0.01)])
_node("composite", "图像合成", "TOP", "混合两路图像。", [TIN, port("in2", "TOP", "图像 B")], [TEX], [P("mode", "混合模式", "screen", "select", options=["screen", "source-over", "multiply", "difference", "lighter"]), P("opacity", "混合比例", 0.7, min=0, max=1, step=0.01)])
_node("output", "最终输出", "OUT", "将图像送入作品预览与导出。", [TIN], [], [])
_node("lfo", "波形振荡器", "CHOP", "生成周期变化的数值，驱动视觉参数。", [], [SIG], [P("frequency", "频率", 0.3, min=0.01, max=5, step=0.01), P("amplitude", "振幅", 1, min=0, max=5, step=0.01), P("offset", "偏移", 0, min=-5, max=5, step=0.01)], "server")
_node("constant", "常量", "CHOP", "提供一个固定数值。", [], [SIG], [P("value", "数值", 1, min=-10, max=10, step=0.01)], "server")
_node("math", "数学运算", "CHOP", "对输入数值进行基础运算。", [port("in", "CHOP", "数值")], [SIG], [P("operation", "运算", "multiply", "select", options=["multiply", "add", "clamp"]), P("value", "第二个数值", 1, min=-10, max=10, step=0.01)], "server")
_node("audio", "音频输入", "CHOP", "读取麦克风音量与频谱；也可播放导入的本地音频。", [], [port("out", "CHOP", "音频")], [P("gain", "增益", 1, min=0, max=5, step=0.01), P("url", "音频地址", "", "text")])
_node("spectrum", "频谱画面", "TOP", "将音频频率能量绘制成图像。", [port("in", "CHOP", "音频输入")], [TEX], [P("bars", "频段数", 64, min=8, max=128, step=1)])
_node("particles", "粒子", "TOP", "生成随时间运动的粒子图像。", [MOD], [TEX], [P("count", "数量", 1600, min=100, max=6000, step=100), P("speed", "运动速度", 0.3, min=0, max=2, step=0.01), P("size", "粒子大小", 2, min=0.5, max=6, step=0.1), P("color", "颜色", "#c1a2ff", "color"), P("spread", "扩散", 1, min=0.2, max=2, step=0.01)])
_node("geometry", "几何体", "SOP", "创建基础三维几何体。", [], [port("out", "SOP", "几何数据")], [P("shape", "几何体", "torus", "select", options=["torus", "sphere", "box", "knot"]), P("detail", "细分", 32, min=8, max=80, step=1)])
_node("render", "3D 渲染", "TOP", "将基础几何体渲染成二维图像。", [port("in", "SOP", "几何输入"), MOD], [TEX], [P("color", "颜色", "#a888ff", "color"), P("wireframe", "线框", True, "boolean"), P("speed", "旋转速度", 0.3, min=0, max=2, step=0.01)])
_node("text", "文字", "TOP", "把文字内容绘制为图像。", [port("in", "DAT", "文字")], [TEX], [P("text", "内容", "HELLO, FLOW", "text"), P("size", "字号", 64, min=12, max=180, step=1), P("color", "颜色", "#ffffff", "color")])
_node("media", "媒体文件", "TOP", "读取上传的图像或视频。", [], [TEX], [P("url", "资源地址", "", "text"), P("fit", "填充方式", "cover", "select", options=["cover", "contain"])])
for kind, label, out_kind in [("image", "AI 图像", "TOP"), ("music", "AI 音乐", "CHOP"), ("3d", "AI 3D", "SOP"), ("text", "AI 文字", "DAT")]:
    _node(f"ai_{kind}", label, "AI", "连接已配置的 AI 服务，按需生成内容。", [], [port("out", out_kind)], [P("prompt", "提示词", "", "text"), P("provider_id", "服务商", "", "text"), P("result_url", "生成资源", "", "text"), P("result_text", "文字结果", "", "text")], "provider")
_node("mcp_tool", "MCP 工具", "AI", "通过已配置的 MCP 服务发现与调用工具。", [], [port("out", "DAT", "工具结果")], [P("server_id", "服务 ID", "", "text"), P("tool", "工具名称", "", "text"), P("arguments", "工具参数 JSON", "{}", "text")], "provider")


def load_plugins() -> None:
    """Local Python plugins are trusted code; restart the server after adding one."""
    import backend.plugins
    for module in pkgutil.iter_modules(backend.plugins.__path__):
        if not module.name.startswith("_"):
            importlib.import_module(f"backend.plugins.{module.name}")


load_plugins()
