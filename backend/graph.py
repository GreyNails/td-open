"""Typed directed graph validation and atomic, explicit graph commands."""

from collections import deque
from copy import deepcopy
import math
from uuid import uuid4

from pydantic import ValidationError

from backend.catalog import NODE_TYPES
from backend.models import Node, Project


class GraphError(ValueError):
    def __init__(self, errors: str | list[str]):
        self.errors = [errors] if isinstance(errors, str) else errors
        super().__init__("; ".join(self.errors))


def resolve_port(node_type: str, direction: str, handle: str | None):
    ports = NODE_TYPES.get(node_type, {}).get(direction, [])
    if not ports:
        return None
    if handle is None:
        return ports[0]
    return next((p for p in ports if p["id"] == handle), None)


def normalize_project(project: Project) -> Project:
    """Fill operator defaults and implicit ports without changing the caller's graph."""
    normalized = project.model_copy(deep=True)
    nodes = {node.id: node for node in normalized.nodes}
    for node in normalized.nodes:
        spec = NODE_TYPES.get(node.type)
        if spec:
            node.data.params = {**deepcopy(spec["defaults"]), **node.data.params}
    for edge in normalized.edges:
        for node_id, direction, attribute in ((edge.source, "outputs", "sourceHandle"), (edge.target, "inputs", "targetHandle")):
            if getattr(edge, attribute) is None and node_id in nodes:
                port = resolve_port(nodes[node_id].type, direction, None)
                if port:
                    setattr(edge, attribute, port["id"])
    return normalized


def topological_order(project: Project) -> list[str]:
    """Kahn's algorithm avoids recursion limits on larger user graphs."""
    indegree = {n.id: 0 for n in project.nodes}
    successors = {n.id: [] for n in project.nodes}
    for edge in project.edges:
        if edge.source not in indegree or edge.target not in indegree:
            raise GraphError(f"连接 {edge.id} 引用了不存在的节点")
        indegree[edge.target] += 1
        successors[edge.source].append(edge.target)
    ready = deque(node_id for node_id, count in indegree.items() if count == 0)
    order = []
    while ready:
        node_id = ready.popleft()
        order.append(node_id)
        for target in successors[node_id]:
            indegree[target] -= 1
            if indegree[target] == 0:
                ready.append(target)
    if len(order) != len(indegree):
        raise GraphError("检测到循环连接；请移除反馈环，当前运行时仅支持有向无环图")
    return order


def _is_finite(value) -> bool:
    if isinstance(value, float):
        return math.isfinite(value)
    if isinstance(value, dict):
        return all(_is_finite(v) for v in value.values())
    if isinstance(value, list):
        return all(_is_finite(v) for v in value)
    return True


def validate_graph(project: Project) -> list[str]:
    errors = []
    nodes = {n.id: n for n in project.nodes}
    if len(nodes) != len(project.nodes):
        errors.append("节点 ID 必须唯一")
    if len({e.id for e in project.edges}) != len(project.edges):
        errors.append("连接 ID 必须唯一")
    for node in project.nodes:
        if node.type not in NODE_TYPES:
            errors.append(f"节点 {node.id} 的算子类型未注册：{node.type}")
        else:
            # Imported graphs and AI commands share the same declared parameter
            # types as the inspector. Preserve extra plugin metadata, but reject
            # objects/null/strings where a known numeric or boolean value belongs.
            for parameter in NODE_TYPES[node.type]["params"]:
                key, kind = parameter["key"], parameter["type"]
                if key not in node.data.params:
                    continue
                value = node.data.params[key]
                valid = True
                if kind == "number":
                    valid = isinstance(value, (int, float)) and not isinstance(value, bool)
                elif kind == "boolean":
                    valid = isinstance(value, bool)
                elif kind in ("text", "textarea", "color", "select"):
                    valid = isinstance(value, str)
                if not valid:
                    errors.append(f"节点 {node.id} 的参数 {key} 类型错误，应为 {kind}")
                elif kind == "select" and value not in parameter.get("options", []):
                    errors.append(f"节点 {node.id} 的参数 {key} 不在支持的选项中")
        if not _is_finite(node.data.params):
            errors.append(f"节点 {node.id} 包含非有限数值")
    if not _is_finite(project.settings):
        errors.append("项目设置包含非有限数值")
    occupied = set()
    for edge in project.edges:
        source, target = nodes.get(edge.source), nodes.get(edge.target)
        if source is None or target is None:
            errors.append(f"连接 {edge.id} 引用了不存在的节点")
            continue
        src = resolve_port(source.type, "outputs", edge.sourceHandle)
        dst = resolve_port(target.type, "inputs", edge.targetHandle)
        if src is None or dst is None:
            errors.append(f"连接 {edge.id} 引用了不存在的端口")
            continue
        if src["kind"] != dst["kind"] and "any" not in (src["kind"], dst["kind"]):
            errors.append(f"连接 {edge.id} 的端口类型不匹配：{src['kind']} → {dst['kind']}")
        key = (target.id, dst["id"])
        if key in occupied:
            errors.append(f"节点 {target.id} 的端口 {dst['id']} 只能有一个输入")
        occupied.add(key)
    try:
        topological_order(project)
    except GraphError as exc:
        for error in exc.errors:
            if error not in errors:
                errors.append(error)
    return errors


def require_valid(project: Project) -> Project:
    project = normalize_project(project)
    errors = validate_graph(project)
    if errors:
        raise GraphError(errors)
    return project


def apply_commands(project: Project, commands: list[dict]) -> Project:
    """Apply all commands to a copy, validate once, and return or fail atomically."""
    document = normalize_project(project).model_dump()

    def node_for(command):
        node_id = command.get("id", command.get("node_id"))
        node = next((n for n in document["nodes"] if n["id"] == node_id), None)
        if node is None:
            raise GraphError(f"找不到节点：{node_id}")
        return node

    for command in commands:
        op = command.get("op")
        if op == "add_node":
            raw = command.get("node", {})
            if not isinstance(raw, dict):
                raise GraphError("add_node.node 必须是对象")
            node_type = raw.get("type", command.get("type"))
            if not isinstance(node_type, str) or node_type not in NODE_TYPES:
                raise GraphError(f"未知算子：{node_type}")
            spec = NODE_TYPES[node_type]
            node_id = raw.get("id", command.get("id", f"n_{uuid4().hex[:12]}"))
            if any(n["id"] == node_id for n in document["nodes"]):
                raise GraphError(f"节点 ID 已存在：{node_id}")
            data = raw.get("data", {})
            if not isinstance(data, dict):
                raise GraphError("节点 data 必须是对象")
            params = data.get("params", command.get("params", {}))
            if not isinstance(params, dict):
                raise GraphError("节点 params 必须是对象")
            new_node = {
                "id": node_id, "type": node_type,
                "position": raw.get("position", command.get("position", {"x": 100, "y": 100})),
                "data": {"label": data.get("label", command.get("label", spec["label"])),
                         "params": {**deepcopy(spec["defaults"]), **params}},
            }
            try:
                new_node = Node.model_validate(new_node).model_dump()
            except ValidationError as exc:
                raise GraphError("add_node 包含无效的节点字段") from exc
            document["nodes"].append(new_node)
        elif op == "set_param":
            node = node_for(command)
            key = command.get("key", command.get("param"))
            if not isinstance(key, str) or not key or len(key) > 100:
                raise GraphError("set_param 需要有效的 key")
            if "value" not in command:
                raise GraphError("set_param 缺少 value")
            node["data"]["params"][key] = command["value"]
        elif op == "update_node":
            node = node_for(command)
            if "params" in command:
                if not isinstance(command["params"], dict):
                    raise GraphError("update_node.params 必须是对象")
                node["data"]["params"].update(command["params"])
            if "label" in command:
                node["data"]["label"] = command["label"]
            if "position" in command:
                node["position"] = command["position"]
        elif op in ("remove_node", "delete_node"):
            node_id = node_for(command)["id"]
            document["nodes"] = [n for n in document["nodes"] if n["id"] != node_id]
            document["edges"] = [e for e in document["edges"] if e["source"] != node_id and e["target"] != node_id]
        elif op == "connect":
            source, target = command.get("source"), command.get("target")
            nodes = {n["id"]: n for n in document["nodes"]}
            if not isinstance(source, str) or not isinstance(target, str) or source not in nodes or target not in nodes:
                raise GraphError("连接的起点与终点必须是已存在的节点")
            handle = command.get("targetHandle", command.get("input"))
            if handle is None:
                target_type = nodes[target]["type"]
                if target_type not in NODE_TYPES:
                    raise GraphError(f"未知算子：{target_type}")
                ports = NODE_TYPES[target_type]["inputs"]
                occupied = {e.get("targetHandle") or (ports[0]["id"] if ports else "") for e in document["edges"] if e["target"] == target}
                source_port = resolve_port(nodes[source]["type"], "outputs", command.get("sourceHandle"))
                available = [p for p in ports if p["id"] not in occupied and source_port and (p["kind"] == source_port["kind"] or "any" in (p["kind"], source_port["kind"]))]
                if available:
                    handle = available[0]["id"]
            document["edges"].append({"id": command.get("id", f"e_{uuid4().hex[:12]}"), "source": source, "target": target,
                                      "sourceHandle": command.get("sourceHandle"), "targetHandle": handle})
        elif op == "disconnect":
            edge_id = command.get("id", command.get("edge_id"))
            if not any(e["id"] == edge_id for e in document["edges"]):
                raise GraphError(f"找不到连接：{edge_id}")
            document["edges"] = [e for e in document["edges"] if e["id"] != edge_id]
        elif op == "rename_project":
            document["name"] = command.get("name")
        elif op == "set_playback":
            for key in ("playing", "speed"):
                if key in command:
                    document["settings"][key] = command[key]
        else:
            raise GraphError(f"不支持的命令：{op}")
    try:
        result = Project.model_validate(document)
    except ValidationError as exc:
        raise GraphError(f"命令产生了无效项目：{exc}") from exc
    return require_valid(result)
