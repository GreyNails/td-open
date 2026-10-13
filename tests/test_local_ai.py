"""Host orchestration tests. Real GPU model runs have a separate live browser script."""
import hashlib
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.models import Project
from backend.graph import normalize_project
from backend.local_ai.compiler import compile_graph
from backend.local_ai.download import download_asset, partial_bytes
from backend.local_ai.registry import ASSETS, PROFILES
from backend.local_ai.workflows import build_workflow, validate_workflow


def node(identifier,kind,**params):
    return {'id':identifier,'type':kind,'data':{'params':params}}


def edge(source,target,output='out',input='in'):
    return {'id':source+'_'+target+'_'+input,'source':source,'target':target,'sourceHandle':output,'targetHandle':input}


def test_manifest_pins_every_large_official_weight_and_deduplicates_encoder():
    assert len(PROFILES)==7
    for key,asset in ASSETS.items():
        assert asset['size']>0
        assert asset['directory'] in ('diffusion_models','text_encoders','vae','checkpoints','demucs')
        if key!='demucs':
            assert len(asset['sha256'])==64
            assert len(asset['revision'])==40 and asset['revision'] in asset['url']
    assert 'qwen3' in PROFILES['flux-klein-4b']['assets'] and 'qwen3' in PROFILES['z-image-turbo']['assets']


@pytest.mark.parametrize('profile_id',list(PROFILES))
def test_model_graphs_have_real_loaders_samplers_and_saved_outputs(profile_id):
    workflow=build_workflow(profile_id,{'prompt':'local test'}, {'image':'input.png','audio':'input.wav'},'test_job')
    classes={value['class_type'] for value in workflow.values()}
    if PROFILES[profile_id]['category']!='stems':
        assert classes & {'UNETLoader','ImageOnlyCheckpointLoader'}
        assert classes & {'KSampler','SamplerCustomAdvanced'}
    assert classes & {'SaveImage','SaveGLB','SaveVideo','TDOpenSaveWAV'}
    for n in workflow.values():
        for value in n['inputs'].values():
            if isinstance(value,list) and len(value)==2:
                assert value[0] in workflow and isinstance(value[1],int)
    if profile_id=='wan22-5b':
        save=next(n for n in workflow.values() if n['class_type']=='SaveVideo')
        assert save['inputs']['format.codec']=='h264'


@pytest.mark.parametrize('params',[
    {'width':513},{'height':255},{'steps':0},{'seed':True},{'cfg':float('nan')},
])
def test_bad_parameters_are_rejected_before_gpu_submission(params):
    with pytest.raises(ValueError):build_workflow('flux-klein-4b',{'prompt':'test',**params},{},'test')


def test_inpaint_requires_real_image_and_mask_and_preserves_destination():
    with pytest.raises(ValueError):build_workflow('z-image-turbo',{'prompt':'test','mode':'inpaint'},{'image':'input.png'},'test')
    workflow=build_workflow('z-image-turbo',{'prompt':'test','mode':'inpaint'}, {'image':'input.png','mask':'mask.png'},'test')
    assert any(n['class_type']=='ImageCompositeMasked' for n in workflow.values())


def test_comfy_graph_keeps_output_indices_and_external_picture_boundary():
    graph=normalize_project(Project.model_validate({'id':'compile_test','name':'compile',
      'nodes':[node('source','media',url='/api/assets/asset.png'),node('vae','comfy_vae_loader',vae_name='ae.safetensors'),
               node('encode','comfy_vae_encode'),node('decode','comfy_vae_decode'),node('save','comfy_save_image')],
      'edges':[edge('source','encode','out','pixels'),edge('vae','encode','vae','vae'),
               edge('encode','decode','samples','samples'),edge('vae','decode','vae','vae'),edge('decode','save','image','images')]}))
    result=compile_graph(graph,'save',{'source':'__TD_INPUT__source'})
    assert result['n_source']['inputs']['image']=='__TD_INPUT__source'
    assert result['n_decode']['inputs']['samples']==['n_encode',0]
    assert result['n_save']['inputs']['filename_prefix'].startswith('td_open/')
    with pytest.raises(ValueError):compile_graph(graph,'save',{})


def test_generic_comfy_class_selects_real_output_slot():
    graph=normalize_project(Project.model_validate({'id':'custom_test','name':'custom','nodes':[
        node('load','comfy_custom',class_type='CheckpointLoaderSimple',inputs_json='{"ckpt_name":"test.safetensors"}'),
        node('encode','comfy_text',text='hello'),node('save','comfy_custom',class_type='ExampleOutput',is_output=True,input_names='conditioning')],
        'edges':[edge('load','encode','out2','clip'),edge('encode','save','conditioning','in')]}))
    result=compile_graph(graph,'save',{})
    assert result['n_encode']['inputs']['clip']==['n_load',1]
    assert result['n_save']['inputs']['conditioning']==['n_encode',0]


def test_imported_workflow_reports_missing_classes_and_bad_output_slot():
    available={'Source':{'output':['IMAGE']},'SaveImage':{'output_node':True,'output':[]}}
    with pytest.raises(ValueError,match='缺少节点'):validate_workflow({'1':{'class_type':'Missing','inputs':{}}},available)
    with pytest.raises(ValueError,match='端口编号'):validate_workflow({'1':{'class_type':'Source','inputs':{}},'2':{'class_type':'SaveImage','inputs':{'images':['1',3]}}},available)
    with pytest.raises(ValueError,match='保存输出'):validate_workflow({'1':{'class_type':'Source','inputs':{}}},available)


def test_ranges_resume_real_bytes_then_validate_and_detect_tampering(tmp_path):
    # >8 MiB exercises bounded range workers, not the small serial fallback.
    content=(b'td-open-real-byte-range-test\0'*400000)[:9*1024*1024]
    hits=[]
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            start,end=map(int,self.headers['Range'][6:].split('-'))
            hits.append((start,end));data=content[start:end+1]
            self.send_response(206);self.send_header('Content-Range',f'bytes {start}-{end}/{len(content)}');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
        def log_message(self,*_):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    asset={'id':'range','directory':'weights','filename':'model.bin','size':len(content),'sha256':hashlib.sha256(content).hexdigest(),
           'url':f'http://127.0.0.1:{server.server_port}/model'}
    folder=tmp_path/'weights';folder.mkdir();partial=folder/'model.bin.part'
    prefix=12345;partial.write_bytes(content[:prefix])
    try:
        result=download_asset(asset,tmp_path)
        assert (folder/'model.bin').read_bytes()==content
        assert result['sha256']==asset['sha256']
        assert any(start==prefix for start,_ in hits)
        old=len(hits);download_asset(asset,tmp_path);assert len(hits)==old
        target=folder/'model.bin';target.write_bytes(b'x'+content[1:])
        with pytest.raises(ValueError,match='校验'):download_asset(asset,tmp_path)
    finally:server.shutdown();server.server_close();thread.join(timeout=2)


def test_sparse_download_progress_counts_verified_ranges_not_file_length(tmp_path):
    partial=tmp_path/'weights.part'
    with partial.open('wb') as file:file.truncate(1000000)
    partial.with_suffix('.part.ranges.json').write_text(json.dumps({'prefix':100,'chunk_size':1000,'completed':[100,1100]}))
    assert partial_bytes(partial,1000000)==2100


def test_local_routes_are_available_without_ml_libraries_and_reject_path_or_config_abuse(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        manifest=client.get('/api/local-ai/manifest').json()
        assert len(manifest['profiles'])==7
        assert client.get('/api/local-ai/jobs').json()==[]
        assert client.get('/api/local-ai/jobs/not-a-job').status_code==422
        assert client.get('/api/local-ai/logs/arbitrary-file').status_code==422
        assert client.post('/api/local-ai/settings',json={'url':'https://example.com','vram_limit_gb':24}).status_code==422
        assert client.post('/api/local-ai/settings',json={'url':'http://127.0.0.1:8189','vram_limit_gb':48}).status_code==422
        assert client.post('/api/local-ai/generate',json={'profile_id':'missing','parameters':{}}).status_code==422
        project={'id':'manual_only','name':'manual','nodes':[node('image','local_image')],'edges':[]}
        evaluated=client.post('/api/evaluate',json={'project':project}).json()
        assert 'image' in evaluated['skipped']
        assert '手动' in evaluated['skip_reasons']['image']
        assert client.get('/api/local-ai/jobs').json()==[]


def test_mcp_local_generation_queues_validated_model_and_reads_or_cancels_exact_job(monkeypatch):
    import asyncio
    from backend import mcp_server
    calls=[]
    async def request(method,path,payload=None):
        calls.append((method,path,payload));return {'id':'a'*32,'status':'queued'}
    monkeypatch.setattr(mcp_server,'app_request',request)
    result=asyncio.run(mcp_server.run_local_model('flux-klein-4b',{'prompt':'robot'},{}))
    assert result['status']=='queued'
    assert calls[-1][2]['metadata']['origin']=='mcp'
    asyncio.run(mcp_server.get_local_model_job('a'*32))
    asyncio.run(mcp_server.cancel_local_model_job('a'*32))
    assert calls[-1]==('POST','/api/local-ai/jobs/'+'a'*32+'/cancel',{})
    count=len(calls)
    with pytest.raises(ValueError):asyncio.run(mcp_server.run_local_model('unknown',{},{}))
    with pytest.raises(ValueError):asyncio.run(mcp_server.cancel_local_model_job('../other'))
    assert len(calls)==count
