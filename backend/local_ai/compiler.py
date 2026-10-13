"""Compile the visible TD Open Comfy subgraph; non-Comfy pictures are captured by the UI."""
from __future__ import annotations

import json
from backend.catalog import NODE_TYPES
from backend.models import Project


def compile_graph(project: Project, node_id: str, external_files: dict[str,str], job_id: str = 'graph') -> dict:
    nodes={node.id:node for node in project.nodes}
    if node_id not in nodes:raise ValueError('执行节点不存在')
    graph={}
    visiting=set()
    prefix='td_open/'+job_id
    def visit(identifier):
        key='n_'+identifier
        if key in graph:return key
        if identifier in visiting:raise ValueError('Comfy 工作流不能有循环')
        visiting.add(identifier)
        node=nodes[identifier]
        spec=NODE_TYPES[node.type]
        comfy=spec.get('comfy')
        if not comfy:
            if identifier not in external_files:raise ValueError('请从画面节点提供输入图片；非 Comfy 输入当前仅支持图片快照')
            graph[key]={'class_type':'LoadImage','inputs':{'image':external_files[identifier]}}
            visiting.remove(identifier)
            return key
        cls=comfy['class_type']
        params=node.data.params
        if cls=='__custom__':
            cls=str(params.get('class_type','')).strip()
            inputs=json.loads(str(params.get('inputs_json','{}')))
            if not isinstance(inputs,dict):raise ValueError('Comfy 自定义输入应为 JSON 对象')
            names=[name.strip() for name in str(params.get('input_names','')).split(',')]
        else:
            inputs={param['key']:params.get(param['key'],param['default']) for param in spec['params']
                    if param['key'] not in ('result_url','result_text','job_id','outputs_json','input_url')}
            names=[]
            if cls in ('LoadImage','LoadAudio'):
                if identifier not in external_files:raise ValueError('请为 Comfy 读取节点上传素材或填写工作台素材地址')
                inputs['image' if cls=='LoadImage' else 'audio']=external_files[identifier]
            if cls.startswith('Save') or cls=='TDOpenSaveWAV':inputs['filename_prefix']=prefix+'/'+identifier
        for edge in project.edges:
            if edge.target!=identifier:continue
            source=nodes[edge.source]
            src_spec=NODE_TYPES[source.type]
            source_key=visit(source.id)
            outputs=src_spec['outputs']
            if source.type=='comfy_custom':
                handle=edge.sourceHandle or 'out'
                index=int(source.data.params.get('output_index',0))+next((i for i,port in enumerate(outputs) if port['id']==handle),0)
            else:
                handle=edge.sourceHandle or (outputs[0]['id'] if outputs else 'out')
                index=next((i for i,port in enumerate(outputs) if port['id']==handle),0)
            target_handle=edge.targetHandle or spec['inputs'][0]['id']
            if node.type=='comfy_custom':
                index_name=next(i for i,port in enumerate(spec['inputs']) if port['id']==target_handle)
                if index_name>=len(names) or not names[index_name]:raise ValueError('请填写自定义节点各连线对应的 Comfy 输入名称')
                target_handle=names[index_name]
            inputs[target_handle]=[source_key,index]
        if (cls.startswith('Save') or cls=='TDOpenSaveWAV') and 'filename_prefix' in inputs:inputs['filename_prefix']=prefix+'/'+identifier
        if cls=='SaveVideo' and 'format.codec' not in inputs:
            inputs['format.codec']=inputs.pop('codec','auto')
        graph[key]={'class_type':cls,'inputs':inputs,'_meta':{'title':node.data.label or spec['label']}}
        visiting.remove(identifier)
        return key
    end=visit(node_id)
    final_spec=NODE_TYPES[nodes[node_id].type]
    if not final_spec.get('comfy',{}).get('terminal') and not (nodes[node_id].type=='comfy_custom' and nodes[node_id].data.params.get('is_output')):
        outputs=final_spec['outputs']
        kind=outputs[0]['kind'] if outputs else ''
        if kind=='TOP':graph['td_save']={'class_type':'SaveImage','inputs':{'images':[end,0],'filename_prefix':prefix+'/image'}}
        elif kind=='AUDIO':graph['td_save']={'class_type':'TDOpenSaveWAV','inputs':{'audio':[end,0],'filename_prefix':prefix+'/audio'}}
        elif kind=='MESH':graph['td_save']={'class_type':'SaveGLB','inputs':{'mesh':[end,0],'filename_prefix':prefix+'/mesh'}}
        else:raise ValueError('请连接到保存图片、音频、视频或网格节点后运行完整工作流')
    return graph
