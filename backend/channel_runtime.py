"""Portable named sample buffers and native tables for deterministic server evaluation.

Browser streaming, devices, and history operators remain browser-owned. This module
never replaces an unavailable streaming result with a fabricated scalar.
"""
from __future__ import annotations

import ast
import csv
import fnmatch
import io
import json
import math
import operator
import re
from collections.abc import Mapping
from typing import Any

MAX_SAMPLES = 262144

def number(value, default=0.0):
    if isinstance(value, dict) and value.get("kind") == "channels":
        channels = value.get("channels", [])
        value = channels[0]["samples"][-1] if channels and channels[0]["samples"] else default
    elif isinstance(value, dict) and value.get("kind") == "table":
        rows = value.get("rows", [])
        value = rows[0][0] if rows and rows[0] else default
    try:
        result = float(value)
    except (ValueError, TypeError):
        return default
    return result if math.isfinite(result) else default


def make_channels(channels, sample_rate=60, start=0, time_slice=False):
    if isinstance(channels, Mapping):
        channels = [{"name": name, "samples": samples} for name, samples in channels.items()]
    if not isinstance(channels, list) or len(channels) > 1024:
        raise ValueError("信号最多包含 1024 个通道")
    if not math.isfinite(sample_rate) or not 0 < sample_rate <= 384000 or not math.isfinite(start):
        raise ValueError("采样率或起始样本无效")
    names, result, length, total = set(), [], None, 0
    for channel in channels:
        name, values = channel.get("name"), channel.get("samples")
        if not isinstance(name, str) or not name or name in names:
            raise ValueError("通道名称不能为空或重复")
        if not isinstance(values, (list, tuple)) or any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) for x in values):
            raise ValueError("通道样本必须为有限数字数组")
        if length is not None and len(values) != length:
            raise ValueError("同一缓冲区的通道样本数量必须相等")
        length = len(values)
        total += length
        if total > MAX_SAMPLES:
            raise ValueError("信号缓冲区超过 262144 个总样本")
        names.add(name)
        result.append({"name": name, "samples": list(values)})
    return {"kind": "channels", "channels": result, "sampleRate": sample_rate, "start": start, "timeSlice": bool(time_slice)}


def as_channels(value, sample_rate=60):
    if isinstance(value, dict) and value.get("kind") == "channels":
        return make_channels(value["channels"], value["sampleRate"], value.get("start", 0), value.get("timeSlice", False))
    if isinstance(value, str) and value.lstrip().startswith(("[", "{")):
        value = json.loads(value)
        if isinstance(value, dict) and value.get("kind") == "channels":
            return as_channels(value)
        if isinstance(value, dict):
            return make_channels(value, sample_rate)
        if isinstance(value, list):
            return make_channels({"chan1": value}, sample_rate)
        raise ValueError("通道 JSON 必须为对象或数组")
    return make_channels({"chan1": [number(value)]}, sample_rate)


def _cell(value):
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    if value is None:
        return ""
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def make_table(rows):
    if not isinstance(rows, list) or len(rows) > 65536 or any(not isinstance(row, list) for row in rows) or sum(map(len, rows)) > MAX_SAMPLES:
        raise ValueError("表格格式错误或超过 262144 个单元格")
    return {"kind": "table", "rows": [[_cell(value) for value in row] for row in rows]}


def text_value(value):
    if isinstance(value, dict) and value.get("kind") == "table":
        stream = io.StringIO()
        csv.writer(stream, lineterminator="\n").writerows(value["rows"])
        return stream.getvalue().removesuffix("\n")
    return _cell(value)


def as_table(value):
    if isinstance(value, dict) and value.get("kind") == "table":
        return make_table(value["rows"])
    if isinstance(value, dict) and value.get("kind") == "channels":
        return make_table([[c["name"] for c in value["channels"]], *map(list, zip(*(c["samples"] for c in value["channels"])))])
    return make_table(list(csv.reader(io.StringIO(text_value(value)), strict=True)))


def _size(buffer):
    return len(buffer["channels"][0]["samples"]) if buffer["channels"] else 0


def _sample(values, index, mode="hold"):
    if not values:
        return 0
    length = len(values)
    if mode == "zero" and not 0 <= index < length:
        return 0
    if mode == "wrap":
        index %= length
    elif mode == "mirror":
        phase = index % max(1, 2 * (length - 1))
        index = 2 * (length - 1) - phase if phase > length - 1 else phase
    return values[max(0, min(length - 1, math.floor(index)))]


def _lerp(values, index, mode="hold"):
    base = math.floor(index)
    fraction = index - base
    return _sample(values, base, mode) * (1 - fraction) + _sample(values, base + 1, mode) * fraction


def _rebuild(source, channels, rate=None, start=None, time_slice=None):
    return make_channels(channels, source["sampleRate"] if rate is None else rate, source["start"] if start is None else start, source["timeSlice"] if time_slice is None else time_slice)


def _align(buffer, channel, index):
    return next((c["samples"] for c in buffer["channels"] if c["name"] == channel["name"]), buffer["channels"][min(index, len(buffer["channels"]) - 1)]["samples"] if buffer["channels"] else [])


def _match(name, patterns):
    return any(fnmatch.fnmatchcase(name, pattern) for pattern in str(patterns).replace(",", " ").split())


def _wave(phase, wave):
    phase %= 1
    return {"triangle": lambda: 1 - 4 * abs(phase - .5), "square": lambda: 1 if phase < .5 else -1,
            "saw": lambda: 2 * phase - 1, "ramp": lambda: phase, "pulse": lambda: int(phase < .1)}.get(wave, lambda: math.sin(phase * math.tau))()


def _expression(source):
    """Restricted AST, no Python eval, attributes, containers, subscripts, or imports."""
    if len(source) > 2048:
        raise ValueError("表达式过长")
    source = re.sub(r"!(?!=)", " not ", source.replace("^", "**").replace("&&", " and ").replace("||", " or "))
    tree = ast.parse(source.strip(), mode="eval")
    if sum(1 for _ in ast.walk(tree)) > 512:
        raise ValueError("表达式过于复杂")
    operators = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv, ast.Mod: lambda a, b: a - math.trunc(a / b) * b, ast.Pow: operator.pow}
    functions = {name: getattr(math, name) for name in ["sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sqrt", "exp", "log", "log10", "floor", "ceil"]}
    functions.update(abs=abs, min=min, max=max, pow=pow, round=lambda x: math.floor(x + .5), sign=lambda x: (x > 0) - (x < 0), clamp=lambda x, a, b: max(a, min(b, x)), mix=lambda a, b, t: a + (b - a) * t)
    allowed_names = {"x", "y", "i", "c", "t", "n", "r", "col", "row", "pi", "e"}
    def visit(node, variables, depth=0):
        if depth > 64:
            raise ValueError("表达式嵌套过深")
        if isinstance(node, ast.Expression):
            return visit(node.body, variables, depth + 1)
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            return node.value
        if isinstance(node, ast.Name) and node.id in allowed_names:
            return {"pi": math.pi, "e": math.e}.get(node.id, variables.get(node.id, 0))
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
            return visit(node.operand, variables, depth + 1) * (-1 if isinstance(node.op, ast.USub) else 1)
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
            return int(not visit(node.operand, variables, depth + 1))
        if isinstance(node, ast.BoolOp) and isinstance(node.op, (ast.And, ast.Or)):
            values = [bool(visit(child, variables, depth + 1)) for child in node.values]
            return int(all(values) if isinstance(node.op, ast.And) else any(values))
        if isinstance(node, ast.Compare):
            comparisons = {ast.Lt: operator.lt, ast.Gt: operator.gt, ast.LtE: operator.le, ast.GtE: operator.ge, ast.Eq: operator.eq, ast.NotEq: operator.ne}
            value = visit(node.left, variables, depth + 1)
            for comparison, child in zip(node.ops, node.comparators):
                if type(comparison) not in comparisons:
                    raise ValueError("表达式包含未允许的比较")
                value = int(comparisons[type(comparison)](value, visit(child, variables, depth + 1)))
            return value
        if isinstance(node, ast.BinOp) and type(node.op) in operators:
            a, b = visit(node.left, variables, depth + 1), visit(node.right, variables, depth + 1)
            if isinstance(node.op, ast.Pow) and abs(b) > 1024:
                raise ValueError("表达式幂指数过大")
            return operators[type(node.op)](a, b)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in functions and not node.keywords:
            return functions[node.func.id](*(visit(arg, variables, depth + 1) for arg in node.args))
        raise ValueError("表达式包含未允许的语法")
    def evaluate(variables):
        value = visit(tree, variables)
        if not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError("表达式结果必须为有限数值")
        return value
    return evaluate


CHANNEL_STATELESS_TYPES = frozenset({
    "channel_constant", "pattern_chop", "wave_chop", "audio_oscillator", "channel_lfo", "channel_beat",
    "channel_merge", "channel_select", "channel_delete", "channel_rename", "channel_reorder", "native_channel_shuffle",
    "channel_join", "channel_splice", "channel_trim", "channel_shift", "channel_stretch", "channel_resample", "channel_extend",
    "channel_cycle", "channel_copy", "channel_sort", "channel_replace", "channel_override", "channel_lookup", "channel_warp",
    "channel_analyze", "channel_math", "channel_blend", "channel_expression", "channel_limit", "channel_function",
    "channel_scurve", "channel_null", "channel_info", "channel_attribute", "channel_switch", "channel_cross", "channel_angle",
    "dat_to_channels", "channels_to_dat", "native_table", "native_select", "native_merge", "native_transpose", "native_sort",
    "native_insert", "lookup_dat", "dat_switch", "dat_null", "dat_info", "dat_evaluate", "native_convert", "native_text",
})


def evaluate_channels(kind: str, params: dict, inputs: dict, time: float = 0) -> Any:
    if kind not in CHANNEL_STATELESS_TYPES:
        raise ValueError(f"该节点需要浏览器连续执行环境：{kind}")
    n = lambda key, fallback=0: number(params.get(key), fallback)
    mode = str(params.get("mode", ""))
    if kind in {"channel_constant", "pattern_chop", "wave_chop", "audio_oscillator", "channel_lfo", "channel_beat"}:
        rate, length = n("sample_rate", 60), int(n("samples", 256))
        if not 1 <= length <= 16384:
            raise ValueError("生成长度必须为 1–16384 个样本")
        if kind == "channel_constant":
            values = json.loads(params.get("values", '{"chan1":0}'))
            if not isinstance(values, dict):
                raise ValueError("常量通道必须为 JSON 对象")
            width = max([1, *(len(value) for value in values.values() if isinstance(value, list))])
            return make_channels({name: value if isinstance(value, list) else [value] * width for name, value in values.items()}, rate)
        if kind == "channel_beat":
            speed, beats = n("bpm", 120) / 60, int(n("beats_per_bar", 4))
            progress = [(time + i / rate) * speed for i in range(length)]
            indexes = [math.floor(value) for value in progress]
            return make_channels({"beat": indexes, "phase": [p % 1 for p in progress], "bar": [i // beats for i in indexes], "accent": [int(i % beats == 0) for i in indexes], "pulse": [int(v != (indexes[i - 1] if i else math.floor((time - 1 / rate) * speed))) for i, v in enumerate(indexes)]}, rate, math.floor(time * rate), True)
        count = int(n("channels", 3)) if kind == "channel_lfo" else 1
        static = kind == "pattern_chop"
        channels = {}
        for c in range(count):
            name = f"lfo{c + 1}" if kind == "channel_lfo" else params.get("name", "audio" if kind == "audio_oscillator" else "wave")
            channels[name] = [_wave((i / length * n("cycles", 2) if static else (time + i / rate) * n("frequency", 1)) + n("phase") + (c / count if kind == "channel_lfo" else 0), params.get("wave", "sine")) * n("amplitude", 1) + n("offset") for i in range(length)]
        return make_channels(channels, rate, 0 if static else math.floor(time * rate), not static)
    if kind == "dat_to_channels":
        rows, header = as_table(inputs.get("in"))["rows"], params.get("header", True)
        if not rows:
            return make_channels({}, n("sample_rate", 60))
        data, width = rows[1:] if header else rows, max(map(len, rows))
        def numeric(row, column):
            cell = row[column] if column < len(row) else ""
            value = float(cell) if cell else 0
            if not math.isfinite(value):
                raise ValueError("表格样本不是有限数字")
            return value
        return make_channels({(rows[0][c] if c < len(rows[0]) and rows[0][c] else f"chan{c + 1}") if header else f"chan{c + 1}": [numeric(row, c) for row in data] for c in range(width)}, n("sample_rate", 60))
    if kind in {"channels_to_dat", "native_table", "native_select", "native_merge", "native_transpose", "native_sort", "native_insert", "lookup_dat", "dat_switch", "dat_null", "dat_info", "dat_evaluate", "native_convert", "native_text"}:
        return _evaluate_table(kind, params, inputs, time)
    a, b = as_channels(inputs.get("in")), as_channels(inputs.get("in2"))
    length, rate = _size(a), a["sampleRate"]
    def mapped(fn):
        return _rebuild(a, [{"name": ch["name"], "samples": [fn(x, i, c, ch["samples"]) for i, x in enumerate(ch["samples"])]} for c, ch in enumerate(a["channels"])])
    if kind == "channel_merge":
        total, used, result = max(length, _size(b)), set(), []
        for ch in [*a["channels"], *b["channels"]]:
            name, suffix = ch["name"], 2
            while name in used:
                name = f'{ch["name"]}_{suffix}'
                suffix += 1
            used.add(name)
            result.append({"name": name, "samples": [_sample(ch["samples"], i) for i in range(total)]})
        return _rebuild(a, result)
    if kind in {"channel_select", "channel_delete"}:
        return _rebuild(a, [ch for ch in a["channels"] if _match(ch["name"], params.get("channels", "*")) == (kind == "channel_select")])
    if kind in {"channel_null", "channel_rename"}:
        names = json.loads(params.get("mapping", "{}")) if kind == "channel_rename" else {}
        return _rebuild(a, [{"name": params.get("prefix", "") + str(names.get(ch["name"], ch["name"])) + params.get("suffix", ""), "samples": ch["samples"]} for ch in a["channels"]])
    if kind == "channel_reorder":
        channels = a["channels"]
        if mode == "alphabetical":
            channels = sorted(channels, key=lambda ch: ch["name"])
        elif mode == "reverse":
            channels = list(reversed(channels))
        else:
            indices = [int(i) for i in str(params.get("indices", "0,1")).replace(",", " ").split()]
            if any(i < 0 or i >= len(channels) for i in indices):
                raise ValueError("通道索引超出范围")
            channels = [channels[i] for i in indices]
        return _rebuild(a, channels)
    if kind == "native_channel_shuffle":
        flat = [x for ch in a["channels"] for x in ch["samples"]]
        if mode == "flatten":
            return _rebuild(a, {"all": flat})
        if mode == "split":
            size = max(1, int(n("size", 16)))
            return _rebuild(a, {f"chunk{i // size + 1}": flat[i:i + size] + [0] * max(0, size - len(flat[i:i + size])) for i in range(0, len(flat), size)})
        return _rebuild(a, {f"sample{i}": [ch["samples"][i] for ch in a["channels"]] for i in range(length)})
    if kind in {"channel_join", "channel_splice"}:
        result = []
        for c, ch in enumerate(a["channels"]):
            first, second = ch["samples"], _align(b, ch, c)
            if kind == "channel_splice":
                index = min(len(first), max(0, int(n("index"))))
                values = first[:index] + second + first[index + max(0, int(n("remove"))):]
            else:
                overlap = min(int(n("crossfade")), len(first), len(second))
                values = first[:len(first) - overlap] + [first[len(first) - overlap + i] * (1 - (i + 1) / (overlap + 1)) + second[i] * (i + 1) / (overlap + 1) for i in range(overlap)] + second[overlap:]
            result.append({"name": ch["name"], "samples": values})
        return _rebuild(a, result)
    if kind == "channel_trim":
        start, size = int(n("start")), int(n("length", 64))
        return _rebuild(a, {ch["name"]: ch["samples"][start:start + size] for ch in a["channels"]}, start=a["start"] + start)
    if kind == "channel_shift":
        return mapped(lambda x, i, c, values: _sample(values, i - int(n("shift", 16)), mode or "wrap"))
    if kind in {"channel_stretch", "channel_resample"}:
        new_rate = n("sample_rate", 120) if kind == "channel_resample" else rate
        count = max(1, math.floor(length * (new_rate / rate if kind == "channel_resample" else n("factor", 2)) + .5))
        if count > 16384:
            raise ValueError("重采样后超过 16384 个样本")
        def resample(values):
            result = []
            for i in range(count):
                position = i * rate / new_rate if kind == "channel_resample" else i * max(0, length - 1) / max(1, count - 1)
                if kind == "channel_resample" and new_rate < rate and mode != "nearest":
                    end = min(length, (i + 1) * rate / new_rate)
                    weights = [(j, max(0, min(j + 1, end) - max(j, position))) for j in range(math.floor(position), math.ceil(end))]
                    weight = sum(w for _, w in weights)
                    result.append(sum(_sample(values, j) * w for j, w in weights) / weight if weight else _sample(values, position))
                else:
                    result.append(_sample(values, math.floor(position + .5)) if mode == "nearest" else _lerp(values, position))
            return result
        return _rebuild(a, {ch["name"]: resample(ch["samples"]) for ch in a["channels"]}, new_rate, a["start"] * new_rate / rate)
    if kind == "channel_extend":
        before, after = int(n("before", 16)), int(n("after", 16))
        return _rebuild(a, {ch["name"]: [_sample(ch["samples"], i - before, mode or "hold") for i in range(length + before + after)] for ch in a["channels"]}, start=a["start"] - before)
    if kind == "channel_cycle":
        return _rebuild(a, {ch["name"]: [ch["samples"][length - 1 - i % length if params.get("pingpong") and i // length % 2 else i % length] for i in range(length * int(n("cycles", 3)))] for ch in a["channels"]})
    if kind == "channel_copy":
        return _rebuild(a, {f'{ch["name"]}_{j + 1}': [_sample(ch["samples"], i - j * n("shift_step", 8), "wrap") * (1 + j * n("gain_step", .2)) for i in range(length)] for ch in a["channels"] for j in range(int(n("copies", 3)))})
    if kind == "channel_sort":
        channels = sorted(a["channels"], key=lambda ch: sum(ch["samples"])) if mode == "channel_mean" else [{"name": ch["name"], "samples": sorted(ch["samples"], reverse=mode == "samples_descending")} for ch in a["channels"]]
        return _rebuild(a, channels)
    if kind in {"channel_replace", "channel_override"}:
        if kind == "channel_override" and not params.get("enabled", True):
            return a
        selected = {ch["name"]: ch for ch in b["channels"] if kind == "channel_replace" or _match(ch["name"], params.get("channels", "*"))}
        channels = [selected.get(ch["name"], ch) for ch in a["channels"]]
        if kind == "channel_replace" and params.get("append", True):
            channels += [ch for ch in b["channels"] if ch["name"] not in {c["name"] for c in a["channels"]}]
        return _rebuild(a, {ch["name"]: [_sample(ch["samples"], i) for i in range(length)] for ch in channels})
    if kind in {"channel_lookup", "channel_warp"}:
        positions, curves = (a, b) if kind == "channel_lookup" else (b, a)
        return _rebuild(positions, {ch["name"]: [_lerp(_align(curves, ch, c), x * max(0, len(_align(curves, ch, c)) - 1), mode or "hold") for x in ch["samples"]] for c, ch in enumerate(positions["channels"])})
    if kind == "channel_analyze":
        def analyze(values):
            if not values:
                return 0
            mean = sum(values) / len(values)
            return {"mean": lambda: mean, "sum": lambda: sum(values), "min": lambda: min(values), "max": lambda: max(values), "variance": lambda: sum((x - mean) ** 2 for x in values) / len(values), "peak_index": lambda: values.index(max(values))}.get(mode, lambda: math.sqrt(sum(x * x for x in values) / len(values)))()
        return _rebuild(a, {ch["name"]: [analyze(ch["samples"])] for ch in a["channels"]})
    if kind in {"channel_math", "channel_blend", "channel_expression"}:
        expr = _expression(params.get("expression", "x")) if kind == "channel_expression" else None
        modulation = as_channels(inputs["mod"])["channels"][0]["samples"] if "mod" in inputs else None
        operations = {"add": operator.add, "subtract": operator.sub, "multiply": operator.mul, "divide": operator.truediv, "min": min, "max": max}
        def calculate(x, i, c, values):
            y = _sample(_align(b, a["channels"][c], c), i)
            if expr:
                return expr(dict(x=x, y=y, i=i, c=c, t=(a["start"] + i) / rate, n=length))
            if kind == "channel_blend":
                mix = max(0, min(1, _sample(modulation, i) if modulation is not None else n("mix", .5)))
                return x * (1 - mix) + y * mix
            return operations[mode or "add"](x, y) * n("gain", 1) + n("offset")
        return mapped(calculate)
    if kind == "channel_limit":
        minimum, maximum = n("minimum", -1), n("maximum", 1)
        width = maximum - minimum
        if width <= 0:
            raise ValueError("最大值必须大于最小值")
        return mapped(lambda x, *_: minimum + (x - minimum) % width if mode == "wrap" else minimum + width - abs((x - minimum) % (2 * width) - width) if mode == "mirror" else max(minimum, min(maximum, x)))
    if kind == "channel_function":
        functions = {name: getattr(math, name) for name in ["sin", "cos", "tan", "sqrt", "exp", "log", "floor", "ceil"]}
        functions.update(abs=abs, square=lambda x: x*x, round=lambda x: math.floor(x + .5), sign=lambda x: (x > 0) - (x < 0))
        return mapped(lambda x, *_: functions[mode or "sin"](x))
    if kind == "channel_scurve":
        return mapped(lambda x, *_: (lambda u: u**3 * (u * (6 * u - 15) + 10) if mode == "smoother" else u*u*(3-2*u))(max(0, min(1, x))))
    if kind == "channel_info":
        return make_channels({"channels": [len(a["channels"])], "samples": [length], "sample_rate": [rate], "duration": [length / rate], "start": [a["start"]], "time_slice": [int(a["timeSlice"])]})
    if kind == "channel_attribute":
        return _rebuild(a, a["channels"], n("sample_rate", 60), n("start"), params.get("time_slice", False))
    if kind == "channel_switch":
        if "mod" not in inputs:
            return b if n("index") >= .5 else a
        control = as_channels(inputs["mod"])
        count = max(length, _size(b), _size(control))
        return _rebuild(a, {ch["name"]: [_sample(_align(b, ch, c) if _sample(control["channels"][0]["samples"], i) >= .5 else ch["samples"], i) for i in range(count)] for c, ch in enumerate(a["channels"])})
    if kind in {"channel_cross", "channel_angle"}:
        def vector(buffer, i):
            return [_sample(buffer["channels"][c]["samples"], i) if c < len(buffer["channels"]) else 0 for c in range(3)]
        out = {"value": []} if kind == "channel_angle" else {"x": [], "y": [], "z": []}
        for i in range(length):
            x, y = vector(a, i), vector(b, i)
            cross = [x[1]*y[2]-x[2]*y[1], x[2]*y[0]-x[0]*y[2], x[0]*y[1]-x[1]*y[0]]
            if kind == "channel_cross":
                for key, value in zip(out, cross):
                    out[key].append(value)
            else:
                dot, denominator = sum(u*v for u, v in zip(x, y)), math.sqrt(sum(u*u for u in x)*sum(v*v for v in y))
                out["value"].append(dot if mode == "dot" else math.degrees(math.atan2(cross[2], x[0]*y[0]+x[1]*y[1])) if mode == "signed2d" else math.degrees(math.acos(max(-1, min(1, dot/denominator)))) if denominator else 0)
        return make_channels(out, rate, a["start"], a["timeSlice"])
    raise ValueError(f"执行器缺失：{kind}")


def _evaluate_table(kind, params, inputs, time):
    n = lambda key, default=0: number(params.get(key), default)
    value, mode = inputs.get("in"), params.get("mode", "")
    if kind == "native_table":
        return as_table(params.get("csv", "name,value\nalpha,1\nbeta,2"))
    if kind == "channels_to_dat":
        signal = as_channels(value)
        rows = [[ch["name"] for ch in signal["channels"]]] if params.get("header", True) else []
        rows += [[round(ch["samples"][i], int(n("precision", 6))) for ch in signal["channels"]] for i in range(_size(signal))]
        return make_table(rows)
    if kind == "dat_null":
        return value if isinstance(value, dict) and value.get("kind") == "table" else text_value(value)
    if kind == "dat_switch":
        selected = inputs.get("in2") if number(inputs.get("mod"), n("index")) >= .5 else value
        return selected if isinstance(selected, dict) and selected.get("kind") == "table" else text_value(selected)
    if kind == "native_text":
        source = "\n".join(params.get("separator", "\t").join(row) for row in value["rows"]) if isinstance(value, dict) and value.get("kind") == "table" else text_value(value)
        return source + params.get("text", "Hello TD Open") if params.get("append") else source or params.get("text", "Hello TD Open")
    if kind == "native_convert":
        if isinstance(value, dict) and value.get("kind") == "table":
            table = as_table(value)
        elif params.get("input_format") == "json":
            table = make_table(json.loads(text_value(value)))
        elif params.get("input_format") == "tsv":
            table = make_table(list(csv.reader(io.StringIO(text_value(value)), delimiter="\t", strict=True)))
        else:
            table = as_table(value)
        return text_value(table) if mode == "csv" else "\n".join("\t".join(cell.replace("\t", " ").replace("\n", " ") for cell in row) for row in table["rows"]) if mode == "tsv" else json.dumps(table["rows"], ensure_ascii=False, separators=(",", ":")) if mode == "json" else table
    rows = as_table(value)["rows"]
    if kind == "native_select":
        selected = rows[int(n("start")):int(n("start") + n("length", 100))]
        columns = [int(c) for c in str(params.get("columns", "")).replace(",", " ").split()]
        if any(c < 0 for c in columns):
            raise ValueError("列索引必须非负")
        return make_table([[row[c] if c < len(row) else "" for c in columns] for row in selected] if columns else selected)
    if kind in {"native_merge", "native_insert"}:
        other = as_table(inputs.get("in2"))["rows"][1 if params.get("skip_header") else 0:]
        index = int(n("index", 1))
        if mode == "columns":
            width, other_width = max(map(len, rows), default=0), max(map(len, other), default=0)
            result = []
            for i in range(max(len(rows), len(other))):
                row, second = rows[i] if i < len(rows) else [], other[i] if i < len(other) else []
                row, second = row + [""] * (width - len(row)), second + [""] * (other_width - len(second))
                position = max(0, min(width, index)) if kind == "native_insert" else width
                result.append(row[:position] + second + row[position:])
            return make_table(result)
        position = max(0, min(len(rows), index)) if kind == "native_insert" else len(rows)
        return make_table(rows[:position] + other + rows[position:])
    if kind == "native_transpose":
        return make_table([[row[c] if c < len(row) else "" for row in rows] for c in range(max(map(len, rows), default=0))])
    if kind == "native_sort":
        header = rows[:1] if params.get("header", True) else []
        column = int(n("column"))
        def key(row):
            cell = row[column] if column < len(row) else ""
            return number(cell) if params.get("numeric") else cell
        return make_table(header + sorted(rows[len(header):], key=key, reverse=params.get("descending", False)))
    if kind == "lookup_dat":
        key_column, value_column = int(n("key_column")), int(n("value_column", 1))
        selected = [row for row in rows if key_column < len(row) and row[key_column] == params.get("key", "alpha")]
        return make_table(selected if value_column < 0 else [[row[value_column] if value_column < len(row) else ""] for row in selected])
    if kind == "dat_info":
        return make_table([["property", "value"], ["rows", len(rows)], ["columns", max(map(len, rows), default=0)], ["cells", sum(map(len, rows))], ["characters", len(text_value(value))], ["type", "table" if isinstance(value, dict) and value.get("kind") == "table" else "string"]])
    if kind == "dat_evaluate":
        expr = _expression(params.get("expression", "x*2+row"))
        return make_table([[cell if r == 0 and params.get("header", True) else expr(dict(x=number(cell), row=r, col=c, r=r, c=c, t=time)) for c, cell in enumerate(row)] for r, row in enumerate(rows)])
    raise ValueError(f"数据执行器缺失：{kind}")
