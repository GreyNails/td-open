"""TD Open's small ComfyUI extension (MIT). No model or vendor source is bundled."""
from pathlib import Path
import os
import warnings

import folder_paths
import torch


class TDOpenDemucs:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required':{'audio':('AUDIO',),'model_name':(['955717e8-8726e21a.th'],),
                            'segment':('FLOAT',{'default':4.0,'min':1.0,'max':7.0}),
                            'shifts':('INT',{'default':0,'min':0,'max':2})}}

    RETURN_TYPES=('AUDIO','AUDIO','AUDIO','AUDIO')
    RETURN_NAMES=('vocals','drums','bass','other')
    FUNCTION='separate'
    CATEGORY='TD Open/audio'

    def separate(self,audio,model_name,segment,shifts):
        from demucs.pretrained import get_model
        from demucs.apply import apply_model
        import comfy.model_management
        import torchaudio.functional

        root=Path(os.environ.get('TD_LOCAL_AI_ROOT',str(Path(folder_paths.models_dir).parent)))
        weights=root/'models/demucs'/model_name
        if model_name!='955717e8-8726e21a.th' or not weights.is_file():
            raise ValueError('请在 TD Open 模型中心安装 Demucs 官方权重')
        # The official Demucs checkpoint contains its architecture, not only tensors.
        # This opt-in is scoped to the single curated checkpoint load and restored.
        old=os.environ.get('TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD')
        os.environ['TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD']='1'
        try:
            with warnings.catch_warnings():
                warnings.simplefilter('ignore',UserWarning)
                model=get_model('955717e8',repo=weights.parent)
        finally:
            if old is None:os.environ.pop('TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD',None)
            else:os.environ['TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD']=old
        waveform=audio['waveform'].detach().float().cpu()
        if waveform.ndim!=3 or waveform.shape[0]!=1:raise ValueError('Demucs 预设每次处理一条音频')
        sample_rate=int(audio['sample_rate'])
        if sample_rate!=model.samplerate:
            waveform=torchaudio.functional.resample(waveform,sample_rate,model.samplerate)
        wav=waveform[0]
        if wav.shape[0]==1:wav=wav.repeat(2,1)
        wav=wav[:model.audio_channels]
        if wav.shape[-1]>model.samplerate*600:raise ValueError('请把超过十分钟的音频分段处理')
        reference=wav.mean(0)
        mean=reference.mean()
        deviation=reference.std().clamp_min(1e-7)
        mixture=(wav-mean)/deviation
        device=comfy.model_management.get_torch_device()
        model.eval()
        with torch.inference_mode():
            result=apply_model(model,mixture[None],device=device,split=True,shifts=shifts,segment=segment,overlap=.25,progress=True)[0].cpu()
        result=result*deviation+mean
        model.to('cpu')
        if torch.cuda.is_available():torch.cuda.empty_cache()
        return tuple({'waveform':result[model.sources.index(name)][None], 'sample_rate':int(model.samplerate)}
                     for name in self.RETURN_NAMES)


class TDOpenSaveWAV:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required':{'audio':('AUDIO',),'filename_prefix':('STRING',{'default':'td_open/audio'})}}

    RETURN_TYPES=()
    FUNCTION='save'
    OUTPUT_NODE=True
    CATEGORY='TD Open/audio'

    def save(self,audio,filename_prefix):
        import soundfile
        folder,name,counter,subfolder,_=folder_paths.get_save_image_path(filename_prefix,folder_paths.get_output_directory())
        output=[]
        for index,wave in enumerate(audio['waveform']):
            filename=f'{name}_{counter+index:05}_.wav'
            soundfile.write(Path(folder)/filename,wave.detach().float().cpu().numpy().T,int(audio['sample_rate']),subtype='PCM_16')
            output.append(dict(filename=filename,subfolder=subfolder,type='output'))
        return {'ui':{'audio':output}}


class TDOpenCleanMesh:
    """Keep the generated object's main connected surface; never synthesize geometry."""
    @classmethod
    def INPUT_TYPES(cls):
        return {'required':{'mesh':('MESH',)}}

    RETURN_TYPES=('MESH',)
    FUNCTION='clean'
    CATEGORY='TD Open/3d'

    def clean(self,mesh):
        import trimesh
        from comfy_extras.nodes_save_3d import get_mesh_batch_item,pack_variable_mesh_batch
        vertices,faces=[],[]
        for index in range(mesh.vertices.shape[0]):
            v,f,*_=get_mesh_batch_item(mesh,index)
            generated=trimesh.Trimesh(v.detach().cpu().numpy(),f.detach().cpu().numpy(),process=True)
            generated.remove_unreferenced_vertices()
            components=generated.split(only_watertight=False)
            if not len(components):raise ValueError('模型没有生成可用的三维表面，请换用主体清晰的参考图片')
            main=max(components,key=lambda part:len(part.faces))
            vertices.append(torch.as_tensor(main.vertices.copy(),dtype=v.dtype,device=v.device))
            faces.append(torch.as_tensor(main.faces.copy(),dtype=f.dtype,device=f.device))
        return (pack_variable_mesh_batch(vertices,faces),)


NODE_CLASS_MAPPINGS={'TDOpenDemucs':TDOpenDemucs,'TDOpenSaveWAV':TDOpenSaveWAV,'TDOpenCleanMesh':TDOpenCleanMesh}
NODE_DISPLAY_NAME_MAPPINGS={'TDOpenDemucs':'TD Open: Demucs Four Stems','TDOpenSaveWAV':'TD Open: Save WAV'}

# Metrics stay local and let the host record actual allocator peaks per run.
from aiohttp import web
from server import PromptServer


@PromptServer.instance.routes.get('/td-open/metrics')
async def td_open_metrics(request):
    if not torch.cuda.is_available():return web.json_response({'cuda':False})
    return web.json_response({'cuda':True,'peak_allocated_mib':torch.cuda.max_memory_allocated()/1024**2,
                              'peak_reserved_mib':torch.cuda.max_memory_reserved()/1024**2,
                              'allocated_mib':torch.cuda.memory_allocated()/1024**2})


@PromptServer.instance.routes.post('/td-open/metrics/reset')
async def td_open_reset_metrics(request):
    if torch.cuda.is_available():torch.cuda.reset_peak_memory_stats()
    return web.json_response({'reset':True})
