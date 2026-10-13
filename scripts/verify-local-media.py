"""Check real generated files after browser-local-ai-live.mjs (run with ML environment)."""
from pathlib import Path
import json
import numpy as np
import soundfile as sf
import trimesh
import av
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
report=json.loads((ROOT/'data/artifacts/local-ai-live-results.json').read_text())
checks=[]
for run in report['runs']:
    outputs=[]
    for output in run['outputs']:
        path=ROOT/'.cache/local-ai-qa/assets'/output['url'].split('/')[-1]
        item={'kind':output['kind'],'bytes':path.stat().st_size}
        if output['kind']=='image':
            pixels=np.asarray(Image.open(path).convert('RGB'));item.update(width=pixels.shape[1],height=pixels.shape[0],std=float(pixels.std()))
            assert pixels.std()>5,'Blank generated image'
        elif output['kind']=='audio':
            waveform,rate=sf.read(path,always_2d=True);item.update(sample_rate=rate,channels=waveform.shape[1],duration=len(waveform)/rate,rms=float(np.sqrt(np.mean(waveform**2))),peak=float(np.max(np.abs(waveform))))
            assert np.isfinite(waveform).all() and len(waveform)>rate and item['rms']>1e-7,'Invalid or silent WAV'
        elif output['kind']=='3d':
            scene=trimesh.load(path);mesh=scene.to_mesh();item.update(vertices=len(mesh.vertices),faces=len(mesh.faces),bounds=mesh.bounds.tolist(),components=len(mesh.split(only_watertight=False)))
            assert len(mesh.faces)>100 and np.isfinite(mesh.vertices).all() and min(mesh.extents)>.01,'Invalid GLB'
        elif output['kind']=='video':
            with av.open(str(path)) as container:
                stream=container.streams.video[0];frames=[frame.to_ndarray(format='rgb24') for frame in container.decode(stream)]
                item.update(frames=len(frames),fps=float(stream.average_rate),width=frames[0].shape[1],height=frames[0].shape[0],motion=float(np.mean(np.abs(frames[-1].astype(float)-frames[0].astype(float)))))
            assert len(frames)==17 and item['motion']>.2,'Invalid or static MP4'
            Image.fromarray(frames[0]).save(ROOT/'data/artifacts/local-video-first.png');Image.fromarray(frames[-1]).save(ROOT/'data/artifacts/local-video-last.png')
        outputs.append(item)
    checks.append({'profile_id':run['profile_id'],'passed':True,'outputs':outputs})
result={'checks':checks,'all_passed':all(x['passed'] for x in checks)}
(ROOT/'data/artifacts/local-ai-media-validation.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
