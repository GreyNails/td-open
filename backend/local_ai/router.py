from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from backend.models import Project
from .manager import LocalAIManager
from .registry import ASSETS, PROFILES


class Model(BaseModel):
    model_config=ConfigDict(extra='forbid')


class InstallRequest(Model):
    profile_ids: list[str]=Field(default_factory=list,max_length=30)
    environment: bool=True


class SettingsRequest(Model):
    url: str='http://127.0.0.1:8189'
    gpu: int=Field(default=0,ge=0,le=64)
    vram_limit_gb: float=Field(default=24,ge=4,le=24)
    managed: bool=True
    download_source:Literal['auto','official']='auto'


class GenerateRequest(Model):
    profile_id: str | None=None
    parameters: dict=Field(default_factory=dict)
    inputs: dict[str,str]=Field(default_factory=dict)
    workflow: dict | None=None
    project: Project | None=None
    node_id: str | None=None
    metadata: dict=Field(default_factory=dict)


def public_job(job: dict) -> dict:
    return {key:value for key,value in job.items() if key not in ('workflow','project','inputs','parameters')}


def create_local_ai_router(manager: LocalAIManager) -> APIRouter:
    router=APIRouter(prefix='/api/local-ai',tags=['Local models and ComfyUI'])

    def call(function,*args,**kwargs):
        try:return function(*args,**kwargs)
        except FileNotFoundError as error:raise HTTPException(404,str(error)) from None
        except (ValueError,PermissionError) as error:raise HTTPException(422,str(error)) from None
        except TimeoutError as error:raise HTTPException(504,str(error)) from None
        except Exception as error:raise HTTPException(503,str(error)[-3000:]) from None

    @router.get('/status')
    def status():
        result=call(manager.status)
        result['jobs']=[public_job(job) for job in result['jobs']]
        return result

    @router.get('/manifest')
    def manifest():return {'profiles':list(PROFILES.values()),'assets':ASSETS}

    @router.post('/settings')
    def settings(body: SettingsRequest):return call(manager.configure,body.model_dump())

    @router.post('/install')
    def install(body: InstallRequest):return public_job(call(manager.install,body.profile_ids,body.environment))

    @router.post('/start')
    def start():return call(manager.start)

    @router.post('/stop')
    def stop():return call(manager.stop)

    @router.get('/jobs')
    def jobs():return [public_job(job) for job in call(manager.list_jobs)]

    @router.get('/jobs/{job_id}')
    def job(job_id: str):return public_job(call(manager.job,job_id))

    @router.get('/jobs/{job_id}/workflow')
    def workflow(job_id: str):
        result=call(manager.job,job_id)
        if not result.get('workflow'):raise HTTPException(404,'工作流尚未生成')
        return result['workflow']

    @router.post('/jobs/{job_id}/cancel')
    def cancel(job_id: str):return public_job(call(manager.cancel,job_id))

    @router.get('/logs/{filename}')
    def logs(filename: str):return {'text':call(manager.log_tail,filename)}

    @router.get('/object-info')
    def object_info():return call(lambda:manager.request('GET','/object_info').json())

    @router.get('/files/{folder}')
    def files(folder: Literal['checkpoints','diffusion_models','text_encoders','vae','loras','controlnet','upscale_models','model_patches','clip_vision']):
        directory=manager.models_dir/folder
        if not directory.exists():return []
        rows=[]
        for path in directory.rglob('*'):
            if path.is_file() and not path.is_symlink() and path.suffix in ('.safetensors','.ckpt','.pth','.pt','.bin'):
                rows.append(str(path.relative_to(directory)))
            if len(rows)>=5000:break
        return sorted(rows)

    @router.post('/generate')
    def generate(body: GenerateRequest):
        if len(body.inputs)>50 or len(body.parameters)>100:raise HTTPException(422,'输入或参数过多')
        workflow=body.workflow
        metadata=body.metadata
        if body.project is not None:
            if not body.node_id:raise HTTPException(422,'图执行需要 node_id')
            from backend.graph import require_valid
            from .compiler import compile_graph
            project=call(require_valid,body.project)
            # Filenames are resolved after queuing by the manager; marker strings
            # refer only to inputs uploaded through TD Open's asset endpoint.
            workflow=call(compile_graph,project,body.node_id,{key:'__TD_INPUT__'+key for key in body.inputs})
            metadata={**metadata,'project_id':project.id,'node_id':body.node_id}
        result=call(manager.submit,body.profile_id,body.parameters,body.inputs,workflow,metadata)
        return public_job(result)

    return router
