"""ComfyUI API-format graphs. These are real loaders/samplers/savers, not placeholders."""
from __future__ import annotations

import math
from typing import Any

from .registry import ASSETS, get_profile


class Graph:
    def __init__(self, job_id: str):
        self.nodes: dict[str, dict] = {}
        self.prefix = 'td_open/' + job_id

    def add(self, class_type: str, title: str = '', **inputs) -> list:
        key = str(len(self.nodes) + 1)
        self.nodes[key] = {'class_type': class_type, 'inputs': inputs, '_meta': {'title': title or class_type}}
        return [key, 0]

    def output(self, reference: list, index: int) -> list:
        return [reference[0], index]


def number(parameters: dict, key: str, default: float, low: float, high: float, integer: bool = False):
    value = parameters.get(key, default)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f'{key} 应为有限数值')
    if not low <= value <= high or (integer and int(value) != value):
        raise ValueError(f'{key} 应在 {low}–{high} 之间' + ('，且为整数' if integer else ''))
    return int(value) if integer else float(value)


def filename(key: str) -> str:
    return ASSETS[key]['filename']


def positive_text(parameters: dict, default: str = '') -> str:
    prompt = str(parameters.get('prompt', default)).strip()
    if not prompt: raise ValueError('请填写提示词 / 风格描述')
    if len(prompt) > 100000: raise ValueError('提示词过长')
    return prompt


def require_input(inputs: dict, key: str) -> str:
    if not inputs.get(key): raise ValueError('请上传或连接输入素材：' + key)
    return inputs[key]


def build_workflow(profile_id: str, parameters: dict, inputs: dict[str, str], job_id: str) -> dict:
    profile = get_profile(profile_id)
    p = {**profile['parameters'], **parameters}
    g = Graph(job_id)
    seed = number(p,'seed',42,0,2**53-1,True)
    if profile['category'] == 'image':
        width = number(p,'width',512,256,2048,True)
        height = number(p,'height',512,256,2048,True)
        if width % 16 or height % 16: raise ValueError('图片宽高须为 16 的倍数')
        flux = profile_id == 'flux-klein-4b'
        steps = number(p,'steps',4 if flux else 9,1,100,True)
        cfg = number(p,'cfg',1,0,20)
        model = g.add('UNETLoader',unet_name=filename('flux-klein' if flux else 'z-turbo'),weight_dtype='default')
        clip = g.add('CLIPLoader',clip_name=filename('qwen3'),type='flux2' if flux else 'lumina2',device='cpu')
        vae = g.add('VAELoader',vae_name=filename('flux-vae' if flux else 'z-vae'))
        if p.get('lora_name'):
            lora = g.add('LoraLoader',model=model,clip=clip,lora_name=str(p['lora_name']),
                         strength_model=number(p,'lora_strength',1,-3,3),strength_clip=number(p,'lora_strength',1,-3,3))
            model,clip = lora,g.output(lora,1)
        positive = g.add('CLIPTextEncode',clip=clip,text=positive_text(p))
        negative = g.add('ConditioningZeroOut',conditioning=positive)
        mode = p.get('mode','text-to-image')
        latent = g.add('EmptyFlux2LatentImage' if flux else 'EmptySD3LatentImage',width=width,height=height,batch_size=1)
        source_image = mask = None
        if mode == 'image-edit':
            if not flux: raise ValueError('参考图指令编辑请选择 FLUX.2 Klein 4B')
            for key in ('image','image2'):
                if key=='image': require_input(inputs,key)
                if inputs.get(key):
                    image = g.add('LoadImage',image=inputs[key])
                    image = g.add('ImageScaleToTotalPixels',image=image,upscale_method='lanczos',megapixels=width*height/1e6,resolution_steps=1)
                    reference = g.add('VAEEncode',pixels=image,vae=vae)
                    positive = g.add('ReferenceLatent',conditioning=positive,latent=reference)
        elif mode in ('image-to-image','inpaint'):
            if flux: raise ValueError('FLUX Klein 使用参考图指令编辑；常规重绘请选择 Z-Image')
            source_image = g.add('LoadImage',image=require_input(inputs,'image'))
            source_image = g.add('ImageScale',image=source_image,upscale_method='lanczos',width=width,height=height,crop='center')
            if mode == 'inpaint':
                mask_image = g.add('LoadImage',image=require_input(inputs,'mask'))
                mask_image = g.add('ImageScale',image=mask_image,upscale_method='nearest-exact',width=width,height=height,crop='center')
                mask = g.add('ImageToMask',image=mask_image,channel='red')
                latent = g.add('VAEEncodeForInpaint',pixels=source_image,vae=vae,mask=mask,grow_mask_by=8)
            else: latent = g.add('VAEEncode',pixels=source_image,vae=vae)
        elif mode != 'text-to-image': raise ValueError('不支持的图片任务模式')
        if flux:
            noise = g.add('RandomNoise',noise_seed=seed)
            sampler = g.add('KSamplerSelect',sampler_name='euler')
            sigmas = g.add('Flux2Scheduler',steps=steps,width=width,height=height)
            guider = g.add('CFGGuider',model=model,positive=positive,negative=negative,cfg=cfg)
            sampled = g.add('SamplerCustomAdvanced',noise=noise,guider=guider,sampler=sampler,sigmas=sigmas,latent_image=latent)
        else:
            model = g.add('ModelSamplingAuraFlow',model=model,shift=3)
            sampled = g.add('KSampler',model=model,positive=positive,negative=negative,latent_image=latent,
                            seed=seed,steps=steps,cfg=cfg,sampler_name='euler',scheduler='simple',
                            denoise=number(p,'denoise',1 if mode=='text-to-image' else .65,.01,1))
        image = g.add('VAEDecode',samples=sampled,vae=vae)
        if mask is not None:
            image = g.add('ImageCompositeMasked',destination=source_image,source=image,x=0,y=0,resize_source=False,mask=mask)
        g.add('SaveImage',images=image,filename_prefix=g.prefix+'/image')
    elif profile['category'] == 'music':
        duration=number(p,'duration',10,1,240)
        model=g.add('UNETLoader',unet_name=filename('ace-turbo'),weight_dtype='default')
        clip=g.add('DualCLIPLoader',clip_name1=filename('ace-text'),clip_name2=filename('ace-lm'),type='ace',device='cpu')
        vae=g.add('VAELoader',vae_name=filename('ace-vae'))
        positive=g.add('TextEncodeAceStepAudio1.5',clip=clip,tags=positive_text(p),lyrics=str(p.get('lyrics','[Instrumental]')),
                       seed=seed,bpm=number(p,'bpm',120,10,300,True),duration=duration,
                       timesignature=str(p.get('timesignature','4')),language=str(p.get('language','en')),
                       keyscale=str(p.get('keyscale','C major')),generate_audio_codes=bool(p.get('generate_audio_codes',False)),
                       cfg_scale=2,temperature=.85,top_p=.9,top_k=0,min_p=0)
        if inputs.get('audio'):
            audio=g.add('LoadAudio',audio=inputs['audio'])
            reference=g.add('VAEEncodeAudio',audio=audio,vae=vae)
            positive=g.add('ReferenceTimbreAudio',conditioning=positive,latent=reference)
        negative=g.add('ConditioningZeroOut',conditioning=positive)
        latent=g.add('EmptyAceStep1.5LatentAudio',seconds=duration,batch_size=1)
        model=g.add('ModelSamplingAuraFlow',model=model,shift=3)
        sampled=g.add('KSampler',model=model,positive=positive,negative=negative,latent_image=latent,seed=seed,
                      steps=number(p,'steps',8,1,100,True),cfg=number(p,'cfg',1,0,20),sampler_name='euler',scheduler='simple',denoise=1)
        audio=g.add('VAEDecodeAudio',samples=sampled,vae=vae)
        g.add('TDOpenSaveWAV',audio=audio,filename_prefix=g.prefix+'/music')
    elif profile['category'] == '3d':
        loaded=g.add('ImageOnlyCheckpointLoader',ckpt_name=filename('hy21'))
        model=g.add('ModelSamplingAuraFlow',model=loaded,shift=1)
        image=g.add('LoadImage',image=require_input(inputs,'image'))
        vision=g.add('CLIPVisionEncode',clip_vision=g.output(loaded,1),image=image,crop='center')
        conditioning=g.add('Hunyuan3Dv2Conditioning',clip_vision_output=vision)
        latent=g.add('EmptyLatentHunyuan3Dv2',resolution=4096,batch_size=1)
        sampled=g.add('KSampler',model=model,positive=conditioning,negative=g.output(conditioning,1),latent_image=latent,
                      seed=seed,steps=number(p,'steps',30,1,100,True),cfg=number(p,'cfg',5,0,20),sampler_name='euler',scheduler='normal',denoise=1)
        voxels=g.add('VAEDecodeHunyuan3D',samples=sampled,vae=g.output(loaded,2),num_chunks=8000,
                     octree_resolution=number(p,'resolution',128,32,256,True))
        mesh=g.add('VoxelToMesh',voxel=voxels,algorithm='surface net',threshold=number(p,'mesh_threshold',.6,-1,1))
        if p.get('clean_mesh',True):mesh=g.add('TDOpenCleanMesh',mesh=mesh)
        g.add('SaveGLB',mesh=mesh,filename_prefix=g.prefix+'/mesh')
    elif profile['category'] == 'stems':
        audio=g.add('LoadAudio',audio=require_input(inputs,'audio'))
        if profile_id=='demucs-4':
            stems=g.add('TDOpenDemucs',audio=audio,model_name=filename('demucs'),segment=number(p,'segment',4,1,7),
                        shifts=number(p,'shifts',0,0,2,True))
            names=['vocals','drums','bass','other']
            for index,name in enumerate(names):
                g.add('TDOpenSaveWAV',audio=g.output(stems,index),filename_prefix=g.prefix+'/'+name)
        else:
            model=g.add('MelBandRoFormerModelLoader',model_name=filename('mel'))
            stems=g.add('MelBandRoFormerSampler',model=model,audio=audio)
            for index,name in enumerate(('vocals','instrumental')):
                g.add('TDOpenSaveWAV',audio=g.output(stems,index),filename_prefix=g.prefix+'/'+name)
    elif profile['category'] == 'video':
        width=number(p,'width',512,256,1280,True)
        height=number(p,'height',320,256,1280,True)
        frames=number(p,'frames',17,5,121,True)
        if width%32 or height%32 or (frames-1)%4:raise ValueError('Wan 宽高须为 32 的倍数，帧数须为 4n+1')
        if width*height*frames>1280*704*81:raise ValueError('该分辨率与时长超出 24 GiB 默认工作量，请分段生成')
        model=g.add('UNETLoader',unet_name=filename('wan5b'),weight_dtype='default')
        clip=g.add('CLIPLoader',clip_name=filename('wan-t5'),type='wan',device='cpu')
        vae=g.add('VAELoader',vae_name=filename('wan-vae'))
        positive=g.add('CLIPTextEncode',clip=clip,text=positive_text(p))
        negative=g.add('CLIPTextEncode',clip=clip,text=str(p.get('negative_prompt','blurry, static, low quality, watermark')))
        image=g.add('LoadImage',image=inputs['image']) if inputs.get('image') else None
        latent_inputs=dict(vae=vae,width=width,height=height,length=frames,batch_size=1)
        if image:latent_inputs['start_image']=image
        latent=g.add('Wan22ImageToVideoLatent',**latent_inputs)
        model=g.add('ModelSamplingSD3',model=model,shift=8)
        sampled=g.add('KSampler',model=model,positive=positive,negative=negative,latent_image=latent,seed=seed,
                      steps=number(p,'steps',20,1,80,True),cfg=number(p,'cfg',5,0,20),sampler_name='uni_pc',scheduler='simple',denoise=1)
        images=g.add('VAEDecodeTiled',samples=sampled,vae=vae,tile_size=512,overlap=64,temporal_size=16,temporal_overlap=4)
        video=g.add('CreateVideo',images=images,fps=number(p,'fps',16,1,60))
        g.add('SaveVideo',video=video,filename_prefix=g.prefix+'/video',format='mp4',**{'format.codec':'h264'})
    else:raise ValueError('不支持的模型分类')
    return g.nodes


def validate_workflow(workflow: dict, available: dict) -> None:
    if not isinstance(workflow,dict) or not 1<=len(workflow)<=2500:
        raise ValueError('请使用 ComfyUI API 格式工作流（节点 ID → class_type / inputs），最多 2500 个节点')
    output=False
    for key,node in workflow.items():
        if not isinstance(key,str) or not isinstance(node,dict) or not isinstance(node.get('inputs'),dict):
            raise ValueError('无效的 ComfyUI API 工作流格式；普通界面 JSON 请先在 ComfyUI 中导出 API 格式')
        cls=node.get('class_type')
        if cls not in available:raise ValueError('ComfyUI 缺少节点：'+str(cls)+'；请按文档安装对应插件')
        if available[cls].get('output_node'):output=True
        for value in node['inputs'].values():
            if isinstance(value,list) and len(value)==2 and isinstance(value[0],str) and isinstance(value[1],int):
                if value[0] not in workflow:raise ValueError('工作流连接引用了不存在的节点：'+value[0])
                source=workflow[value[0]].get('class_type')
                count=len(available.get(source,{}).get('output',[]))
                if not 0<=value[1]<count:raise ValueError('工作流输出端口编号不正确：'+value[0])
    if not output:raise ValueError('工作流需要至少一个保存输出节点')
