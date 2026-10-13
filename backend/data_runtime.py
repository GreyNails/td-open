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
    def normalize(item):
        if isinstance(item, float) and item.is_integer():
            return int(item)
        if isinstance(item, (list, tuple)):
            return [normalize(child) for child in item]
        if isinstance(item, dict):
            return {key: normalize(child) for key, child in item.items()}
        return item
    return json.dumps(normalize(value), ensure_ascii=False, allow_nan=False, separators=(",", ":"))


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


def _evaluate_basic_data(kind, params, inputs, time):
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


ADVANCED_STATELESS_TYPES = frozenset({
    "weighted_sum", "function_chop", "atan2", "mix_chop", "ease_chop", "smoothstep",
    "angle_wrap", "angle_distance", "sequence_chop", "gaussian_chop", "exponential_chop", "damped_wave",
    "text_length", "substring_dat", "pad_dat", "format_dat", "encode_dat", "sort_dat", "unique_dat",
    "filter_dat", "join_dat", "json_merge", "json_set", "json_keys", "table_transpose", "table_select",
    "table_sort", "table_merge", "table_to_json", "chop_to_dat",
})
STATELESS_TYPES = STATELESS_TYPES | ADVANCED_STATELESS_TYPES


def evaluate_data(kind, params, inputs, time):
    if kind not in ADVANCED_STATELESS_TYPES:
        return _evaluate_basic_data(kind, params, inputs, time)
    import base64
    import binascii
    import urllib.parse
    from functools import cmp_to_key

    n = lambda key, default=0: _number(params.get(key), default)
    s = lambda key, default="": str(params.get(key, default))
    a = lambda: _number(inputs.get("in"))
    b = lambda: _number(inputs.get("in2"))
    text = lambda key="in", fallback="": inputs.get(key) if isinstance(inputs.get(key), str) else fallback
    clamp = lambda value, low, high: max(low, min(high, value))
    def parse(value):
        try:
            return json.loads(value, parse_constant=_reject_json_constant)
        except (ValueError, TypeError) as exc:
            raise ValueError("输入不是有效的 JSON 文本") from exc
    def array(value):
        value = parse(value)
        if not isinstance(value, list):
            raise ValueError("输入必须是 JSON 数组")
        return value
    def obj(value):
        value = parse(value)
        if not isinstance(value, dict):
            raise ValueError("输入必须是 JSON 对象")
        return value
    def display(value):
        return value if isinstance(value, str) else _json(value)
    def csv(rows):
        def cell(value):
            value = str(value)
            return '"' + value.replace('"', '""') + '"' if any(c in value for c in ',"\r\n') else value
        return "\n".join(",".join(cell(value) for value in row) for row in rows)
    def compare(left, right, numeric):
        if numeric:
            return _number(left) - _number(right)
        left, right = display(left).encode("utf-16-be", "surrogatepass"), display(right).encode("utf-16-be", "surrogatepass")
        return (left > right) - (left < right)
    def sort_key(numeric):
        return cmp_to_key(lambda left, right: compare(left, right, numeric) * (-1 if params.get("descending") else 1))
    if kind == "weighted_sum":
        return a() * n("weight1", 1) + b() * n("weight2", .5) + _number(inputs.get("in3")) * n("weight3", .25) + n("offset")
    if kind == "function_chop":
        functions = {"power": lambda x: math.pow(x, n("exponent", 2)), "sqrt": math.sqrt, "log": math.log, "exp": math.exp, "cos": math.cos, "tan": math.tan, "asin": math.asin, "acos": math.acos, "atan": math.atan, "tanh": math.tanh}
        try:
            value = functions[s("function", "power")](a())
            if not math.isfinite(value):
                raise ValueError()
            return value
        except (ValueError, OverflowError) as exc:
            raise ValueError("运算结果不是有限数值") from exc
    if kind == "atan2":
        return math.atan2(a(), b()) * (180 / math.pi if s("unit", "degrees") == "degrees" else 1)
    if kind == "mix_chop":
        mix = _number(inputs.get("mod"), n("mix", .5))
        if params.get("clamp", True):
            mix = clamp(mix, 0, 1)
        return a() + (b() - a()) * mix
    if kind == "ease_chop":
        def bounce(t):
            c, d = 7.5625, 2.75
            if t < 1 / d:
                return c * t * t
            if t < 2 / d:
                return c * (t - 1.5 / d) ** 2 + .75
            if t < 2.5 / d:
                return c * (t - 2.25 / d) ** 2 + .9375
            return c * (t - 2.625 / d) ** 2 + .984375
        curve, x = s("curve", "sine"), clamp(a(), 0, 1)
        f = lambda t: t*t if curve == "quadratic" else t*t*t if curve == "cubic" else 1-bounce(1-t) if curve == "bounce" else 1-math.cos(t*math.pi/2)
        direction = s("direction", "in_out")
        return f(x) if direction == "in" else 1-f(1-x) if direction == "out" else f(2*x)/2 if x < .5 else 1-f(2-2*x)/2
    if kind == "smoothstep":
        span = n("edge1", 1)-n("edge0")
        if not span:
            raise ValueError("两个阈值不能相同")
        x = clamp((a()-n("edge0"))/span, 0, 1)
        return x*x*x*(x*(x*6-15)+10) if params.get("smoother") else x*x*(3-2*x)
    if kind == "angle_wrap":
        start = n("start", -180)
        return start+(a()-start) % max(.001, abs(n("period", 360)))
    if kind == "angle_distance":
        period = max(.001, abs(n("period", 360)))
        return (b()-a()+period/2) % period-period/2
    if kind == "sequence_chop":
        try:
            values = [float(value.strip()) if value.strip() else 0 for value in s("values", "0,1,0.25,0.75").split(",")]
            if len(values) > 4096 or not all(math.isfinite(value) for value in values):
                raise ValueError()
        except ValueError as exc:
            raise ValueError("请输入逗号分隔的有限数值序列") from exc
        phase = time*n("rate", 2) % len(values)
        index = math.floor(phase)
        return values[index]+(values[(index+1) % len(values)]-values[index])*(phase-index) if s("mode", "step") == "linear" else values[index]
    if kind == "gaussian_chop":
        return n("amplitude", 1)*math.exp(-.5*((a()-n("center"))/max(.001, abs(n("sigma", 1))))**2)
    if kind == "exponential_chop":
        return n("amplitude", 1)*math.exp(-max(0, n("decay", 2))*max(0, a()))
    if kind == "damped_wave":
        t = time % n("repeat", 3) if n("repeat", 3) > 0 else max(0, time)
        return math.sin(t*n("frequency", 3)*math.tau)*math.exp(-t*n("decay", 1))*n("amplitude", 1)
    if kind == "text_length":
        return len(re.split(r"\r?\n", text())) if s("mode", "characters") == "lines" else len(text().split()) if s("mode") == "words" else len(text())
    if kind == "substring_dat":
        start = max(0, len(text())+math.trunc(n("start"))) if n("start") < 0 else math.trunc(n("start"))
        return text()[start:start+max(0, math.trunc(n("length", 10)))]
    if kind == "pad_dat":
        fill, count = s("fill", "0"), clamp(math.trunc(n("length", 8))-len(text()), 0, 10000)
        padding = "".join(fill[i % len(fill)] for i in range(count)) if fill else ""
        return padding+text() if s("side", "left") == "left" else text()+padding
    if kind == "format_dat":
        return re.sub(r"\{in2?\}", lambda m: text("in" if m[0] == "{in}" else "in2"), s("template", "第一路：{in}\n第二路：{in2}"))
    if kind == "encode_dat":
        mode = s("mode", "base64_encode")
        try:
            if mode == "base64_encode":
                return base64.b64encode(text().encode()).decode()
            if mode == "base64_decode":
                value = re.sub(r"\s", "", text())
                if len(value) % 4 == 1:
                    raise ValueError()
                return base64.b64decode(value + "=" * (-len(value) % 4), validate=True).decode("utf-8")
            if mode == "url_encode":
                return urllib.parse.quote(text(), safe="~()*!.'-_")
            if re.search(r"%(?![a-fA-F0-9]{2})", text()):
                raise ValueError()
            return urllib.parse.unquote(text(), errors="strict")
        except (UnicodeError, ValueError, binascii.Error) as exc:
            raise ValueError("输入不是有效的编码文本") from exc
    if kind in {"sort_dat", "unique_dat"}:
        values = array(text()) if s("format", "lines") == "json" else re.split(r"\r?\n", text())
        if kind == "sort_dat":
            values = sorted(values, key=sort_key(bool(params.get("numeric"))))
        else:
            seen, unique = set(), []
            for value in values:
                key = _json(value)
                if key not in seen:
                    seen.add(key)
                    unique.append(value)
            values = unique
        return _json(values) if s("format", "lines") == "json" else "\n".join(values)
    if kind == "filter_dat":
        query, mode = s("query", "a"), s("mode", "contains")
        def matches(line):
            match = line.startswith(query) if mode == "starts" else line.endswith(query) if mode == "ends" else query in line
            return not match if params.get("invert") else match
        return "\n".join(line for line in re.split(r"\r?\n", text()) if matches(line))
    if kind == "join_dat":
        return s("separator", ", ").join(display(value) for value in array(text()))
    if kind == "json_merge":
        return _json({**obj(text()), **obj(text("in2", "{}"))})
    if kind == "json_set":
        value, path = parse(text()), s("path", "settings.amount").split(".")
        if not isinstance(value, (dict, list)) or any(not key or key in {"__proto__", "prototype", "constructor"} for key in path):
            raise ValueError("JSON 路径无效或包含保留键")
        try:
            next_value = parse(s("value", "1"))
        except ValueError:
            next_value = s("value", "1")
        target = value
        for i, key in enumerate(path):
            last = i == len(path)-1
            if isinstance(target, list):
                if not re.fullmatch(r"0|[1-9][0-9]*", key) or int(key) > 10000:
                    raise ValueError("数组索引必须为 0–10000 的整数")
                key = int(key)
                target.extend([None] * max(0, key+1-len(target)))
            if last:
                target[key] = next_value
            else:
                child = target[key] if isinstance(target, list) else target.get(key)
                if not isinstance(child, (list, dict)):
                    child = [] if path[i+1].isascii() and path[i+1].isdecimal() else {}
                    target[key] = child
                target = child
        return _json(value)
    if kind == "json_keys":
        value = obj(text())
        return _json(list(value) if s("mode", "keys") == "keys" else list(value.values()) if s("mode") == "values" else list(value.items()))
    if kind == "table_transpose":
        rows = _parse_csv(text())
        return csv([[row[i] if i < len(row) else "" for row in rows] for i in range(max(map(len, rows)))])
    if kind == "table_select":
        start, count = max(0, math.trunc(n("start"))), max(0, math.trunc(n("count", 10)))
        rows = _parse_csv(text())[start:start+count]
        if s("columns").strip():
            try:
                columns = [int(value.strip()) for value in s("columns").split(",")]
                if any(value < 0 for value in columns):
                    raise ValueError()
            except ValueError as exc:
                raise ValueError("列索引必须是非负整数") from exc
            rows = [[row[i] if i < len(row) else "" for i in columns] for row in rows]
        return csv(rows)
    if kind == "table_sort":
        rows, col = _parse_csv(text()), max(0, math.trunc(n("column", 1)))
        head = [rows.pop(0)] if params.get("header", True) else []
        cmp_key = cmp_to_key(lambda left, right: compare(left[col] if col < len(left) else "", right[col] if col < len(right) else "", params.get("numeric", True)) * (-1 if params.get("descending") else 1))
        return csv(head+sorted(rows, key=cmp_key))
    if kind == "table_merge":
        rows, second = _parse_csv(text()), _parse_csv(text("in2"))
        if s("axis", "rows") == "rows":
            return csv(rows+second[1 if params.get("skip_header", True) else 0:])
        width = max(map(len, rows))
        return csv([(rows[i] if i < len(rows) else [""]*width)+(second[i] if i < len(second) else []) for i in range(max(len(rows), len(second)))])
    if kind == "table_to_json":
        header, *rows = _parse_csv(text())
        if len(set(header)) != len(header):
            raise ValueError("表头名称不能重复")
        return _json([{key: _parse_number(row[i], row[i]) if params.get("numeric", True) and i < len(row) else row[i] if i < len(row) else "" for i, key in enumerate(header)} for row in rows])
    if kind == "chop_to_dat":
        # Decimal.from_float tracks JavaScript toFixed's rounding of the binary float.
        from decimal import Decimal, localcontext, ROUND_HALF_UP
        digits = clamp(math.trunc(n("digits", 2)), 0, 12)
        with localcontext() as context:
            context.prec = 340
            value = Decimal.from_float(float(a()) if a() else 0.0).quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP)
        return s("prefix") + f"{value:.{digits}f}" + s("suffix")
    raise ValueError(f"没有服务端执行器：{kind}")
