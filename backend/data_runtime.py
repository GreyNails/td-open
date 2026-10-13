"""Stateless signal and text operators shared semantically with dataRuntime.ts.

Stateful frame history belongs to the browser engine. HTTP evaluation never
fabricates a one-frame result for integrators, envelopes, counters, or filters.
"""

import json
import math
import re


STATELESS_TYPES = frozenset({
    "time", "beat", "saw", "square", "triangle", "noise_chop", "range", "limit",
    "logic", "switch_chop", "null_chop", "sine", "abs", "quantize", "text_dat",
    "concatenate", "replace_text", "case_text", "split_text", "json_select",
    "table_dat", "dat_to_chop",
})


def _number(value, default=0):
    if isinstance(value, bool):
        return default
    if isinstance(value, (int, float)):
        return value if math.isfinite(value) else default
    return _parse_number(value, default) if isinstance(value, str) else default


def _json(value):
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def _reject_json_constant(value):
    raise ValueError(f"JSON 不支持数值 {value}")


def _parse_number(text, fallback):
    text = text.strip()
    if not text:
        return fallback
    if re.fullmatch(r"0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+", text):
        return int(text, 0)
    if not re.fullmatch(r"[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?", text):
        return fallback
    result = float(text)
    return result if math.isfinite(result) else fallback


def _parse_csv(source):
    """Match the browser's quoted CSV contract, including empty rows/cells."""
    rows, row, cell = [], [], ""
    quoted = closed = False
    index = 0
    while index < len(source):
        char = source[index]
        if quoted:
            if char == '"':
                if source[index + 1:index + 2] == '"':
                    cell += '"'
                    index += 1
                else:
                    quoted, closed = False, True
            else:
                cell += char
        elif char == ",":
            row.append(cell)
            cell, closed = "", False
        elif char in "\r\n":
            if char == "\r" and source[index + 1:index + 2] == "\n":
                index += 1
            row.append(cell)
            rows.append(row)
            row, cell, closed = [], "", False
        elif char == '"' and not cell and not closed:
            quoted = True
        elif closed:
            raise ValueError("CSV 引号结束后应为逗号或换行")
        else:
            cell += char
        index += 1
    if quoted:
        raise ValueError("CSV 中存在未闭合的引号")
    if cell or row or closed or not rows:
        rows.append([*row, cell])
    return rows


def evaluate_data(kind, params, inputs, time):
    """Evaluate a recognized stateless operator, preserving finite JSON output."""
    n = lambda key, default=0: _number(params.get(key), default)
    a = lambda: _number(inputs.get("in"), 0)
    text = lambda fallback="": inputs.get("in") if isinstance(inputs.get("in"), str) else fallback
    if kind == "time":
        return time * n("speed", 1) + n("offset")
    if kind == "beat":
        return int((time * n("bpm", 120) / 60 + n("phase")) % 1 < max(0, min(1, n("width", 0.1))))
    if kind in {"saw", "square", "triangle"}:
        phase = (time * n("frequency", 1) + n("phase")) % 1
        value = (2 * phase - 1 if kind == "saw" else
                 1 - 4 * abs(phase - 0.5) if kind == "triangle" else
                 1 if phase < max(0, min(1, n("width", 0.5))) else -1)
        return value * n("amplitude", 1) + n("offset")
    if kind == "noise_chop":
        phase = time * n("frequency", 1)
        index = math.floor(phase)
        blend = phase - index
        blend *= blend * (3 - 2 * blend)
        def random_at(sample):
            value = math.sin(sample * 127.1 + n("seed", 1) * 311.7) * 43758.5453123
            return (value - math.floor(value)) * 2 - 1
        return (random_at(index) * (1 - blend) + random_at(index + 1) * blend) * n("amplitude", 1) + n("offset")
    if kind == "range":
        width = n("in_max", 1) - n("in_min")
        if width == 0:
            raise ValueError("范围映射的输入最小值和最大值不能相同")
        fraction = (a() - n("in_min")) / width
        if params.get("clamp", True):
            fraction = max(0, min(1, fraction))
        return n("out_min") + fraction * (n("out_max", 360) - n("out_min"))
    if kind == "limit":
        low, high = sorted((n("min"), n("max", 1)))
        if high == low:
            return low
        mode = params.get("mode", "clamp")
        if mode == "wrap":
            return low + (a() - low) % (high - low)
        if mode == "mirror":
            phase = (a() - low) % (2 * (high - low))
            return low + min(phase, 2 * (high - low) - phase)
        return max(low, min(high, a()))
    if kind == "logic":
        value, threshold = a(), n("value", 0.5)
        second = _number(inputs.get("in2"), 0)
        operation = params.get("operation", "greater")
        first_on, second_on = value > threshold, second > threshold
        conditions = {
            "greater": first_on, "less": value < threshold,
            "equal": abs(value - threshold) < 1e-9,
            "between": min(threshold, n("high", 1)) <= value <= max(threshold, n("high", 1)),
            "and": first_on and second_on, "or": first_on or second_on,
            "xor": first_on != second_on, "not": not first_on,
        }
        return int(conditions[operation])
    if kind == "switch_chop":
        index = _number(inputs.get("mod"), n("index"))
        return _number(inputs.get("in2" if index >= 0.5 else "in"), 0)
    if kind == "null_chop":
        return a()
    if kind == "sine":
        value = a() * (math.pi / 180 if params.get("unit") == "degrees" else 1)
        return math.sin(value) * n("amplitude", 1)
    if kind == "abs":
        return abs(a())
    if kind == "quantize":
        step = abs(n("step", 0.25))
        if step == 0:
            raise ValueError("量化步长必须大于 0")
        value = a() / step
        mode = params.get("mode", "round")
        # JavaScript Math.round chooses +infinity at half steps, unlike Python's
        # bankers' rounding. This matters for negative signals and phase offsets.
        result = math.floor(value + 0.5) if mode == "round" else math.floor(value) if mode == "floor" else math.ceil(value)
        return result * step
    if kind == "text_dat":
        return str(params.get("text", ""))
    if kind == "concatenate":
        second = inputs.get("in2")
        return text(str(params.get("text", "Hello"))) + str(params.get("separator", " ")) + (second if isinstance(second, str) else str(params.get("text2", "world")))
    if kind == "replace_text":
        find = str(params.get("find", ""))
        return text().replace(find, str(params.get("replace", ""))) if find else text()
    if kind == "case_text":
        value = text()
        return {"upper": str.upper, "lower": str.lower, "trim": str.strip, "reverse": lambda s: s[::-1]}[params.get("mode", "upper")](value)
    if kind == "split_text":
        separator = str(params.get("separator", ","))
        parts = text().split(separator) if separator else list(text())
        if params.get("trim", True):
            parts = [part.strip() for part in parts]
        return _json(parts)
    if kind == "json_select":
        try:
            value = json.loads(text(), parse_constant=_reject_json_constant)
        except (ValueError, TypeError) as exc:
            raise ValueError("输入不是有效的 JSON 文本") from exc
        path = str(params.get("path", "")).strip()
        for segment in path.split(".") if path else []:
            if isinstance(value, dict) and segment in value:
                value = value[segment]
            elif isinstance(value, list) and segment == "length":
                value = len(value)
            elif isinstance(value, list) and segment.isascii() and segment.isdecimal() and str(int(segment)) == segment and int(segment) < len(value):
                value = value[int(segment)]
            else:
                return str(params.get("fallback", ""))
        return value if isinstance(value, str) else _json(value)
    if kind == "table_dat":
        value = text(str(params.get("csv", "")))
        mode = params.get("mode", "csv")
        if mode == "csv":
            return value
        rows = _parse_csv(value)
        if mode == "json":
            return _json(rows)
        row, column = max(0, math.floor(n("row", 1))), max(0, math.floor(n("column", 1)))
        return rows[row][column] if row < len(rows) and column < len(rows[row]) else ""
    if kind == "dat_to_chop":
        return _parse_number(text(), n("fallback"))
    raise ValueError(f"没有服务端执行器：{kind}")
