"""Compile portable component networks into scoped operator IDs for cooking."""
import json
import re

from backend.catalog import NODE_TYPES
from backend.models import Edge, Project
from backend.graph import GraphError, graph_tree_errors, resolve_port


def operator_path(scope: str, path: str) -> str:
    parts = []
    for item in (path if path.startswith('/') else scope + path).split('/'):
        if item == '..':
            if parts and re.fullmatch(r'_copy[0-9]+', parts[-1]): parts.pop()
            if parts: parts.pop()
        elif item and item != '.': parts.append(item)
    return '/'.join(parts)


def compile_networks(root: Project) -> Project:
    errors = graph_tree_errors(root)
    if errors: raise GraphError(errors)
    nodes = []; edges = []; outputs = {}
    def index_of(node):
        index = node.data.params.get('index', 1)
        if isinstance(index, bool) or not isinstance(index, (int, float)) or not float(index).is_integer() or not 1 <= index <= 4:
            raise GraphError('组件输入/输出编号必须为 1–4 的整数')
        return int(index)
    def walk(graph, prefix, parent_inputs, depth, clocks, replica=None):
        incoming = {}
        for edge in graph.edges: incoming.setdefault(edge.target, []).append(edge)
        for source in graph.nodes:
            identifier = prefix + source.id
            parameters = dict(source.data.params)
            # These values belong to the compiler, never to saved user parameters.
            parameters.pop('__td_replica', None)
            parameters.pop('__td_clocks', None)
            if replica is not None: parameters['__td_replica'] = replica
            if clocks: parameters['__td_clocks'] = json.dumps(clocks, separators=(',', ':'))
            nodes.append(source.model_copy(update={'id': identifier, 'data': source.data.model_copy(update={'params': parameters})}))
            if len(nodes) > 5000: raise GraphError('展开组件后的总节点数不能超过 5000')
            if source.type.startswith('network_in_') and prefix:
                index = index_of(source); handle = 'in' if index == 1 else f'in{index}'
                match = next((e for e in parent_inputs if (e.targetHandle or 'in') == handle), None)
                if match: edges.append(match.model_copy(update={'id': identifier + '/input', 'target': identifier, 'targetHandle': 'in'}))
            if source.data.graph is not None:
                inputs = [e.model_copy(update={'source': prefix + e.source}) for e in incoming.get(source.id, [])]
                child_clocks = clocks
                if source.type == 'time_comp':
                    p = source.data.params
                    child_clocks = [*clocks, {'rate': p.get('rate', 1), 'offset': p.get('offset', 0), 'loop': p.get('loop', False), 'duration': p.get('duration', 10)}]
                if source.type == 'replicator_comp':
                    count = source.data.params.get('count', 4)
                    if isinstance(count, bool) or not isinstance(count, (int, float)) or not float(count).is_integer() or not 1 <= count <= 16:
                        raise GraphError('复制器副本数量必须为 1–16 的整数')
                    for copy_index in range(int(count)):
                        copy_prefix = identifier + ('/' if copy_index == 0 else f'/_copy{copy_index}/')
                        walk(source.data.graph, copy_prefix, inputs, depth + 1, child_clocks, copy_index)
                        outs = [out for out in source.data.graph.nodes if out.type == 'network_out_top' and index_of(out) == 1]
                        if len(outs) > 1: raise GraphError(f'复制器 {identifier} 的输出编号 1 重复')
                        if outs: edges.append(Edge.model_construct(id=copy_prefix + 'result', source=copy_prefix + outs[0].id,
                                                                 target=identifier, targetHandle=f'copy_{copy_index}', sourceHandle='out'))
                    continue
                walk(source.data.graph, identifier + '/', inputs, depth + 1, child_clocks, replica)
                for out in source.data.graph.nodes:
                    if not out.type.startswith('network_out_'): continue
                    index = index_of(out); handle = 'out' if index == 1 else f'out{index}'
                    if (identifier, handle) in outputs: raise GraphError(f'组件 {identifier} 的输出编号 {index} 重复')
                    outputs[identifier, handle] = identifier + '/' + out.id
                    if index == 1:
                        edges.append(Edge.model_construct(id=identifier + '/result', source=identifier + '/' + out.id,
                                                         target=identifier, targetHandle='internal', sourceHandle='out'))
            reference_parameter = ('path' if source.type.startswith('operator_select_') else
                                   {'ref_top_op_viewer': 'source', 'ref_top_import_select': 'parent'}.get(source.type))
            if reference_parameter and source.data.params.get(reference_parameter):
                # Viewer and imported-texture reads cook the referenced operator too.
                # Material/geometry references have no family restriction, unlike Select.
                edges.append(Edge.model_construct(id=identifier + '/reference',
                                                 source=operator_path(prefix, str(source.data.params[reference_parameter])),
                                                 target=identifier, targetHandle='in' if reference_parameter == 'path' else 'reference',
                                                 sourceHandle='out'))
        edges.extend(e.model_copy(update={'id': prefix + e.id, 'source': prefix + e.source, 'target': prefix + e.target}) for e in graph.edges)
        if len(edges) > 40000: raise GraphError('展开组件后的总连接数不能超过 40000')
    walk(root, '', [], 0, [])
    by_id = {node.id: node for node in nodes}
    if len(by_id) != len(nodes): raise GraphError('展开网络中的节点 ID 必须唯一')
    for edge in edges:
        route = outputs.get((edge.source, edge.sourceHandle or 'out'))
        if route: edge.source = route; edge.sourceHandle = 'out'
        source, target = by_id.get(edge.source), by_id.get(edge.target)
        if source is None or target is None: raise GraphError(f'引用的节点不存在：/{edge.source if source is None else edge.target}')
        source_port = resolve_port(source.type, 'outputs', edge.sourceHandle)
        if target.type.startswith(('network_in_', 'operator_select_')) and edge.targetHandle == 'in':
            target_kind = NODE_TYPES[target.type]['family']
        else:
            target_port = resolve_port(target.type, 'inputs', edge.targetHandle)
            target_kind = target_port['kind'] if target_port else 'any'
        if source_port and target_kind != 'any' and source_port['kind'] not in (target_kind, 'any'):
            raise GraphError(f'跨网络连接 {edge.id} 的端口类型不匹配：{source_port["kind"]} → {target_kind}')
    return root.model_copy(update={'nodes': nodes, 'edges': edges})
