"""Deterministic scalar/text execution. Pixel/audio/3D rendering lives in the browser."""

import json
import math
from typing import Any

from backend.networks import compile_networks
from backend.channel_runtime import CHANNEL_STATELESS_TYPES,evaluate_channels,number,text_value
from backend.catalog import NODE_EVALUATORS, NODE_TYPES
from backend.data_runtime import STATELESS_TYPES, evaluate_data
from backend.graph import require_valid, resolve_port, topological_order
from backend.models import Project


def _number(value, default=0):
    if value is None:
        return default
    if isinstance(value,dict) and value.get("kind") in ("channels","table"):
        return number(value,default)
    value = float(value)
    if not math.isfinite(value):
        raise ValueError("数值必须有限")
    return value


def evaluate(project: Project, time: float = 0) -> dict[str, Any]:
    project = compile_networks(require_valid(project))
    nodes = {n.id: n for n in project.nodes}
    values, errors, skipped, skip_reasons = {}, {}, [], {}
    global_time = time
    for node_id in topological_order(project):
        node = nodes[node_id]
        spec = NODE_TYPES[node.type]
        params = {**spec["defaults"], **node.data.params}
        time = global_time
        for clock in json.loads(params.get("__td_clocks", "[]"))[:16]:
            time = time * float(clock.get("rate",1)) + float(clock.get("offset",0))
            if clock.get("loop"):
                time %= max(.001,float(clock.get("duration",10)))
        inputs = {}
        incoming = [edge for edge in project.edges if edge.target == node_id]
        failed_inputs = [edge.source for edge in incoming if edge.source in errors]
        if failed_inputs:
            errors[node_id] = "上游节点执行失败：" + ", ".join(failed_inputs)
            continue
        if any(edge.source in skipped for edge in incoming):
            skipped.append(node_id)
            skip_reasons[node_id] = "上游节点需要浏览器实时运行环境"
            continue
        for edge in incoming:
            if edge.source in values:
                port = resolve_port(node.type, "inputs", edge.targetHandle)
                inputs[port["id"] if port else edge.targetHandle or "in"] = values[edge.source]
        try:
            if node.type in ("base_comp","engine_comp","container_comp","widget_comp","time_comp"):
                result=inputs.get("internal",inputs.get("in",0))
            elif node.type.startswith(("network_in_","network_out_","operator_select_")):
                result=inputs.get("in",0)
            elif node.type in CHANNEL_STATELESS_TYPES:
                result=evaluate_channels(node.type,params,inputs,time)
            elif node.type in NODE_EVALUATORS:
                result = NODE_EVALUATORS[node.type](params, inputs, time)
            elif node.type in STATELESS_TYPES:
                result = evaluate_data(node.type, params, {key: number(value) if isinstance(value,dict) and value.get("kind")=="channels" else text_value(value) if isinstance(value,dict) and value.get("kind")=="table" else value for key,value in inputs.items()}, time)
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
                if node.type in {"lag", "speed", "counter", "trigger", "derivative", "hold", "spring", "delay_chop", "moving_average", "peak_chop", "rms_chop", "adsr", "hysteresis", "random_hold", "timer_chop", "slew_chop"}:
                    skip_reasons[node_id] = "有状态信号节点需要浏览器连续帧上下文"
                elif spec.get("runtime") == "provider":
                    skip_reasons[node_id] = "AI 与 MCP 节点需要通过专用接口手动执行"
                elif spec.get('runtime')=='local_model':
                    skip_reasons[node_id]='本地模型与 Comfy 工作流需要在节点中手动执行，不随时间线自动生成'
                else:
                    skip_reasons[node_id] = "图像、音频设备与几何节点在浏览器运行"
                continue
            if isinstance(result, float) and not math.isfinite(result):
                raise ValueError("运算结果不是有限数值")
            # A plugin must return finite JSON data; invalid plugin outputs are local
            # node errors, not a serialization failure for the entire HTTP response.
            json.dumps(result, allow_nan=False)
            values[node_id] = result
        except Exception as exc:
            errors[node_id] = str(exc)
    return {"values": values, "errors": errors, "skipped": skipped, "skip_reasons": skip_reasons, "time": global_time}
