#!/usr/bin/env python3
"""The same installer and managed runtime used by the studio's one-click controls."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
os.environ.setdefault('TMPDIR',str(ROOT/'.cache/tmp'))
from backend.local_ai.manager import LocalAIManager, atomic_json, hardware, TERMINAL
from backend.local_ai.registry import PROFILES,RUNTIME


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['hardware','list','install','download','start','stop','configure','verify-environment'])
    parser.add_argument('--profile',action='append',default=[])
    parser.add_argument('--all',action='store_true')
    parser.add_argument('--data-dir',default='data')
    parser.add_argument('--gpu',type=int,default=0)
    parser.add_argument('--vram',type=float,default=24)
    parser.add_argument('--url',default='http://127.0.0.1:8189')
    parser.add_argument('--external',action='store_true')
    parser.add_argument('--register',action='store_true')
    args=parser.parse_args()
    data_dir=(ROOT/args.data_dir).resolve()
    if not data_dir.is_relative_to(ROOT):parser.error('--data-dir must be inside the repository')
    manager=LocalAIManager(data_dir)
    if args.action=='hardware':print(json.dumps(hardware(),ensure_ascii=False,indent=2));return
    if args.action=='list':
        for profile in manager.status()['profiles']:
            print(profile['id'],profile['name'],'ready' if profile['installed'] else 'not installed')
        return
    if args.action=='configure':
        print(manager.configure(dict(url=args.url,gpu=args.gpu,vram_limit_gb=args.vram,managed=not args.external,download_source='auto')));return
    if args.action=='start':print(manager.start());return
    if args.action=='stop':print(manager.stop());return
    if args.action=='verify-environment':
        code="import torch,torchvision,torchaudio,av,einops,safetensors,transformers,aiohttp,demucs,soundfile,rotary_embedding_torch,trimesh;print(torch.__version__,torch.cuda.is_available());assert torch.cuda.is_available()"
        subprocess.run([str(manager.python),'-c',code],check=True,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
        subprocess.run([str(manager.python),'-m','pip','check'],check=True)
        revision=subprocess.check_output(['git','-C',str(manager.runtime),'rev-parse','HEAD'],text=True).strip()
        if revision!=RUNTIME['revision']:raise ValueError('ComfyUI revision differs from the tested manifest')
        plugin=manager.runtime/'custom_nodes/td_open_nodes';plugin.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(ROOT/'backend/local_ai/comfy_nodes.py',plugin/'__init__.py')
        if args.register:
            atomic_json(manager.env_dir/'ready.json',dict(runtime_revision=revision,installed_at=time.time(),manual=True))
            lock=subprocess.check_output([str(manager.python),'-m','pip','freeze'],text=True)
            (manager.env_dir/'requirements.installed.txt').write_text(lock)
        print('Environment verification passed');return
    ids=list(PROFILES) if args.all else args.profile
    job=manager.install(ids,environment=args.action=='install')
    previous=''
    try:
        while True:
            result=manager.job(job['id'])
            message=f"{result['status']} {result.get('progress',0):.1f}% {result['message']}"
            if message!=previous:print(message,flush=True);previous=message
            if result['status'] in TERMINAL:
                if result['status']!='succeeded':raise RuntimeError(result['message'])
                return
            time.sleep(2)
    except KeyboardInterrupt:
        manager.cancel(job['id']);print('Cancelled; resumable files retained',flush=True)
        raise SystemExit(130)
    finally:manager.shutdown()


if __name__=='__main__':main()
