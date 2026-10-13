"""Deterministic scalar/text execution. Pixel/audio/3D rendering lives in the browser."""

import json
import math
from typing import Any

from backend.catalog import NODE_EVALUATORS, NODE_TYPES
from backend.graph import require_valid, resolve_port, topological_order
from backend.models import Project


def _number(value, default=0):
    if value is None:
        return default
    value = float(value)
    if not math.isfinite(value):
        raise ValueError("数值必须有限")
    return value


def evaluate(project: Project, time: float = 0) -> dict[str, Any]:
    project = require_valid(project)
    nodes = {n.id: n for n in project.nodes}
    values, errors, skipped = {}, {}, []
    for node_id in topological_order(project):
        node = nodes[node_id]
        spec = NODE_TYPES[node.type]
        params = {**spec["defaults"], **node.data.params}
        inputs = {}
        incoming = [edge for edge in project.edges if edge.target == node_id]
        failed_inputs = [edge.source for edge in incoming if edge.source in errors]
        if failed_inputs:
            errors[node_id] = "上游节点执行失败：" + ", ".join(failed_inputs)
            continue
        if any(edge.source in skipped for edge in incoming):
            skipped.append(node_id)
            continue
        for edge in incoming:
            if edge.source in values:
                port = resolve_port(node.type, "inputs", edge.targetHandle)
                inputs[port["id"]] = values[edge.source]
        try:
            if node.type in NODE_EVALUATORS:
                result = NODE_EVALUATORS[node.type](params, inputs, time)
            elif node.type == "constant":
                result = _number(params.get("value"))
            elif node.type == "lfo":
                phase = time * _number(params.get("frequency"), 0.3) + _number(params.get("phase"), 0)
                wave = params.get("wave", "sine")
                fraction = phase % 1
                signal = {"triangle": 1 - 4 * abs(fraction - 0.5), "square": 1 if fraction < 0.5 else -1, "saw": 2 * fraction - 1}.get(wave, math.sin(phase * math.tau))
                result = signal * _number(params.get("amplitude"), 1) + _number(params.get("offset"), 0)
            elif node.type == "math":
                a = _number(inputs.get("in"), 0)
                b = _number(inputs.get("in2", params.get("value")), 1)
                operation = params.get("operation", "multiply")
                if operation == "divide" and b == 0:
                    raise ValueError("不能除以零")
                operations = {"add": lambda: a + b, "subtract": lambda: a - b, "multiply": lambda: a * b,
                              "divide": lambda: a / b, "min": lambda: min(a, b), "max": lambda: max(a, b), "clamp": lambda: max(0, min(b, a))}
                if operation not in operations:
                    raise ValueError(f"未知运算：{operation}")
                result = operations[operation]()
            elif node.type in ("text", "ai_text"):
                result = str(inputs.get("in", params.get("result_text") or params.get("text", "")))
            else:
                skipped.append(node_id)
                continue
            if isinstance(result, float) and not math.isfinite(result):
                raise ValueError("运算结果不是有限数值")
            # A plugin must return finite JSON data; invalid plugin outputs are local
            # node errors, not a serialization failure for the entire HTTP response.
            json.dumps(result, allow_nan=False)
            values[node_id] = result
        except Exception as exc:
            errors[node_id] = str(exc)
    return {"values": values, "errors": errors, "skipped": skipped, "time": time}
