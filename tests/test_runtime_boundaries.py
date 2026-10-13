"""Regression coverage for subprocess ownership and compiled graph boundaries."""
import asyncio
from contextlib import suppress
import json
import os
from pathlib import Path
import signal
import sys
import time

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from backend.graph import GraphError, apply_commands, normalize_project, require_valid, validate_graph
from backend.models import Node, NodeData, Project
from backend.networks import compile_networks
from backend.process_runtime import ProcessOutputLimit, run_bounded_process
from backend.script_runtime import create_script_router


def invoke(tmp_path, source, timeout=3, limit=1024):
    return run_bounded_process(sys.executable, '-I', '-c', source, payload=b'', cwd=str(tmp_path),
                               env={'PATH': os.environ.get('PATH', '')}, timeout=timeout, stdout_limit=limit)


def alive(pid):
    try:
        stat = Path(f'/proc/{pid}/stat').read_text()
        return stat.rsplit(')', 1)[1].split()[0] != 'Z'
    except FileNotFoundError: return False


def test_subprocess_stdout_limit_is_enforced_while_running(tmp_path):
    async def run():
        started = time.monotonic()
        with pytest.raises(ProcessOutputLimit):
            await invoke(tmp_path, 'import os,time\nos.write(1,b"x"*200000)\ntime.sleep(30)', timeout=5)
        assert time.monotonic() - started < 3
    asyncio.run(run())


@pytest.mark.skipif(os.name != 'posix', reason='POSIX process group cleanup')
def test_normal_exit_and_timeout_reap_subprocess_children(tmp_path):
    async def run():
        source = 'import subprocess,sys\np=subprocess.Popen([sys.executable,"-c","import time;time.sleep(30)"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)\nprint(p.pid,flush=True)'
        code, output, _ = await invoke(tmp_path, source)
        pid = int(output); assert code == 0
        for _ in range(50):
            if not alive(pid): break
            await asyncio.sleep(.01)
        assert not alive(pid)
        child_path = tmp_path / 'child.pid'
        source += f'\nopen({str(child_path)!r},"w").write(str(p.pid))\nimport time;time.sleep(30)'
        with pytest.raises(asyncio.TimeoutError): await invoke(tmp_path, source, timeout=.5)
        pid = int(child_path.read_text())
        for _ in range(50):
            if not alive(pid): break
            await asyncio.sleep(.01)
        assert not alive(pid)
    asyncio.run(run())


def test_python_logs_are_bounded_during_execution_and_persisted(tmp_path):
    app = FastAPI(); app.include_router(create_script_router(tmp_path))
    with TestClient(app) as client:
        response = client.post('/api/scripts/run', headers=script_headers(client), json={'code':'def cook(inputs,time):\n    for i in range(30): print("x"*100000)\n    print("TAIL")\n    return 7'})
        assert response.status_code == 200, response.text
        assert response.json()['value'] == 7
        assert len(response.json()['log']) <= 10000
        assert response.json()['log'].endswith('TAIL\n')
        assert next((tmp_path / 'scripts').glob('*.log')).read_text().endswith('TAIL\n')
        response = client.post('/api/scripts/run', headers=script_headers(client), json={'code':'def cook(inputs,time):\n    return "x"*9000000'})
        assert response.status_code == 413


def test_python_api_rejects_nonlocal_requests_and_symlink_worker(tmp_path):
    app = FastAPI(); app.include_router(create_script_router(tmp_path))
    with TestClient(app, client=('203.0.113.9', 1234)) as client:
        assert client.post('/api/scripts/run', json={'code':'def cook(inputs,time): return 1'}).status_code == 403
    other = tmp_path / 'other'; other.mkdir()
    (other / 'scripts').symlink_to(tmp_path / 'scripts')
    with pytest.raises(ValueError, match='symbolic'): create_script_router(other)


def test_select_dependencies_are_validated_before_save():
    project = Project(id='root', name='Implicit references')
    with pytest.raises(GraphError, match='循环'):
        apply_commands(project, [{'op':'add_node','id':'a','type':'operator_select_chop','params':{'path':'b'}},
                                 {'op':'add_node','id':'b','type':'operator_select_chop','params':{'path':'a'}}])
    with pytest.raises(GraphError, match='不存在'):
        apply_commands(project, [{'op':'add_node','id':'a','type':'operator_select_chop','params':{'path':'missing'}}])


def test_nested_reference_resolves_parent_and_edits_remain_atomic():
    project = apply_commands(Project(id='root', name='Parent reference'), [
        {'op':'add_node','id':'external','type':'constant','params':{'value':7}},
        {'op':'add_node','id':'component','type':'base_comp'},
        {'op':'add_node','id':'select','type':'operator_select_chop','params':{'path':'../external'},'scope':['component']},
        {'op':'add_node','id':'out','type':'network_out_chop','scope':['component']},
        {'op':'connect','source':'select','target':'out','scope':['component']},
    ])
    compiled = compile_networks(project)
    assert any(e.source == 'external' and e.target == 'component/select' for e in compiled.edges)
    original = project.model_dump()
    with pytest.raises(GraphError):
        apply_commands(project, [{'op':'remove_node','id':'external'}])
    assert project.model_dump() == original


def test_typed_component_boundaries_and_port_indices():
    with pytest.raises(GraphError, match='类型不匹配'):
        apply_commands(Project(id='root', name='Boundary'), [
            {'op':'add_node','id':'image','type':'solid'},
            {'op':'add_node','id':'component','type':'base_comp'},
            {'op':'add_node','id':'input','type':'network_in_chop','scope':['component']},
            {'op':'connect','source':'image','target':'component'},
        ])
    for index in [0, 5, 1.5]:
        with pytest.raises(GraphError, match='整数'):
            apply_commands(Project(id='root', name='Index'), [{'op':'add_node','type':'network_in_chop','params':{'index':index}}])


def test_global_node_and_depth_budgets_precede_normalization():
    children = [Project(id=f'child{k}', name='Child', nodes=[Node(id=f'n{i}', type='constant') for i in range(2500)]) for k in range(2)]
    project = Project(id='root', name='Oversized tree', nodes=[Node(id=f'component{k}', type='base_comp', data=NodeData(graph=child)) for k, child in enumerate(children)])
    with pytest.raises(GraphError, match='5000'): normalize_project(project)
    nested = Project(id='root', name='Deep')
    for index in range(17): nested = Project(id=f'p{index}', name='Nested', nodes=[Node(id='child', type='base_comp', data=NodeData(graph=nested))])
    with pytest.raises(GraphError, match='16'): normalize_project(nested)


def test_compiler_clock_chain_is_ordered_and_does_not_mutate_project():
    inner = Project(id='inner', name='Inner', nodes=[Node(id='clock', type='time')])
    outer = Project(id='outer', name='Outer', nodes=[Node(id='inner', type='time_comp', data=NodeData(params={'rate':3,'offset':4,'loop':True,'duration':9}, graph=inner))])
    root = Project(id='root', name='Root', nodes=[Node(id='outer', type='time_comp', data=NodeData(params={'rate':2,'offset':1}, graph=outer))])
    original = root.model_dump()
    compiled = compile_networks(root)
    value = next(n for n in compiled.nodes if n.id == 'outer/inner/clock')
    assert json.loads(value.data.params['__td_clocks']) == [{'rate':2,'offset':1,'loop':False,'duration':10},{'rate':3,'offset':4,'loop':True,'duration':9}]
    assert root.model_dump() == original


def test_replicator_expands_true_copies_and_keeps_parent_references():
    child = Project(id='child', name='Child', nodes=[
        Node(id='index', type='replica_index_chop'),
        Node(id='outside', type='operator_select_chop', data=NodeData(params={'path':'../external'})),
        Node(id='out', type='network_out_top'),
    ])
    root = Project(id='root', name='Replicas', nodes=[Node(id='external', type='constant'),
        Node(id='replicator', type='replicator_comp', data=NodeData(params={'count':3}, graph=child))])
    compiled = compile_networks(root)
    replicas = [n for n in compiled.nodes if n.type == 'replica_index_chop']
    assert [n.data.params['__td_replica'] for n in replicas] == [0,1,2]
    assert {n.id for n in replicas} == {'replicator/index','replicator/_copy1/index','replicator/_copy2/index'}
    assert all(e.source == 'external' for e in compiled.edges if e.id.endswith('/reference'))
    assert {e.targetHandle for e in compiled.edges if e.target == 'replicator'} == {'copy_0','copy_1','copy_2'}


def test_compiled_replica_budget_prevents_exponential_expansion():
    child = Project(id='leaf', name='Leaf', nodes=[Node(id=f'n{i}', type='constant') for i in range(30)])
    for index in range(3): child = Project(id=f'p{index}', name='Nested replicas', nodes=[Node(id='rep', type='replicator_comp', data=NodeData(params={'count':16}, graph=child))])
    with pytest.raises(GraphError, match='5000'): compile_networks(child)


@pytest.mark.parametrize('node_type,parameter', [('ref_top_op_viewer', 'source'), ('ref_top_import_select', 'parent')])
def test_viewer_and_import_references_reject_missing_nodes_and_cycles(node_type, parameter):
    root = Project(id='root', name='Implicit image dependencies')
    with pytest.raises(GraphError, match='不存在'):
        apply_commands(root, [{'op':'add_node','id':'a','type':node_type,'params':{parameter:'missing'}}])
    with pytest.raises(GraphError, match='循环'):
        apply_commands(root, [{'op':'add_node','id':'a','type':node_type,'params':{parameter:'b'}},
                              {'op':'add_node','id':'b','type':'ref_top_op_viewer','params':{'source':'a'}}])
    project = apply_commands(root, [
        {'op':'add_node','id':'external','type':'solid'},
        {'op':'add_node','id':'component','type':'base_comp'},
        {'op':'add_node','id':'ref','type':node_type,'params':{parameter:'../external'},'scope':['component']},
    ])
    assert any(e.source == 'external' and e.target == 'component/ref' for e in compile_networks(project).edges)
    with pytest.raises(GraphError, match='不存在'):
        apply_commands(project, [{'op':'remove_node','id':'external'}])


def test_compiler_discards_reserved_scope_parameters_before_injection():
    forged = {'__td_clocks': '{broken JSON', '__td_replica': 999}
    leaf = Project(id='leaf', name='Leaf', nodes=[Node(id='clock', type='time', data=NodeData(params=forged))])
    timed = Project(id='timed', name='Timed', nodes=[Node(id='timer', type='time_comp', data=NodeData(params={**forged,'rate':2}, graph=leaf))])
    root = Project(id='root', name='Reserved parameters', nodes=[
        Node(id='clock', type='time', data=NodeData(params=forged)),
        Node(id='rep', type='replicator_comp', data=NodeData(params={**forged,'count':2}, graph=timed)),
    ])
    original = root.model_dump()
    nodes = {node.id: node for node in compile_networks(root).nodes}
    for name in ['clock', 'rep']:
        assert '__td_clocks' not in nodes[name].data.params
        assert '__td_replica' not in nodes[name].data.params
    for index, prefix in [(0,'rep/'), (1,'rep/_copy1/')]:
        assert nodes[prefix + 'timer'].data.params['__td_replica'] == index
        assert '__td_clocks' not in nodes[prefix + 'timer'].data.params
        parameters = nodes[prefix + 'timer/clock'].data.params
        assert parameters['__td_replica'] == index
        assert json.loads(parameters['__td_clocks']) == [{'rate':2,'offset':0,'loop':False,'duration':10}]
    assert root.model_dump() == original


def script_headers(client):
    response = client.post('/api/scripts/intent')
    assert response.status_code == 200, response.text
    return {'X-TD-Script-Intent': response.json()['token']}
