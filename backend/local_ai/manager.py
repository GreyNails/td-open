from __future__ import annotations

import concurrent.futures
import json
import os
import platform
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.parse
import uuid
from pathlib import Path
from typing import Callable
from contextlib import contextmanager

import httpx

from .download import Cancelled, download_asset, partial_bytes
VALIDATION=json.loads(Path(__file__).with_name('validation.json').read_text())

from .registry import ASSETS, PROFILES, RUNTIME, get_profile, profile_assets

ROOT = Path(__file__).resolve().parents[2]
TERMINAL = {'succeeded', 'failed', 'cancelled', 'interrupted'}
EXTENSIONS = {'.png':'image','.jpg':'image','.jpeg':'image','.webp':'image','.gif':'image',
              '.wav':'audio','.flac':'audio','.mp3':'audio','.ogg':'audio','.opus':'audio',
              '.mp4':'video','.webm':'video','.glb':'3d','.gltf':'3d','.obj':'3d','.stl':'3d'}


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name('.' + path.name + '.' + uuid.uuid4().hex)
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.replace(temporary, path)


def hardware() -> dict:
    gpus = []
    try:
        result = subprocess.run(['nvidia-smi','--query-gpu=index,name,memory.total,memory.free,driver_version',
                                 '--format=csv,noheader,nounits'], capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            for line in result.stdout.strip().splitlines():
                index, name, total, free, driver = [part.strip() for part in line.split(',')]
                gpus.append(dict(index=int(index),name=name,total_mib=int(total),free_mib=int(free),driver=driver))
    except (OSError, subprocess.TimeoutExpired, ValueError): pass
    ram = 0
    try:
        ram = os.sysconf('SC_PAGE_SIZE') * os.sysconf('SC_PHYS_PAGES')
    except (AttributeError, OSError, ValueError): pass
    return dict(platform=platform.system(),python=platform.python_version(),gpus=gpus,ram_bytes=ram,
                disk_free_bytes=shutil.disk_usage(ROOT).free,architecture=platform.machine(),
                automatic_install_supported=platform.system() in ('Linux','Windows') and bool(gpus))


class LocalAIManager:
    def __init__(self, data_dir: Path, runtime_dir: Path | None = None):
        self.data_dir = Path(data_dir).resolve()
        self.root = Path(runtime_dir or self.data_dir / 'local-ai').resolve()
        if not self.root.is_relative_to(ROOT): raise ValueError('本地 AI 文件必须位于 td_open 项目目录内')
        self.models_dir = self.root / 'models'
        self.runtime = self.root / 'runtimes' / 'comfyui'
        self.env_dir = self.root / 'envs' / 'comfy'
        self.logs = self.root / 'logs'
        self.jobs_dir = self.data_dir / 'local-ai-jobs'
        self.config_path = self.root / 'settings.json'
        self.worker = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix='td-local-generation')
        self.installer = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix='td-local-install')
        self.lock = threading.RLock()
        self.cancel_events: dict[str, threading.Event] = {}
        self.live_jobs: set[str] = set()
        self.current_job: str | None = None
        self.process: subprocess.Popen | None = None
        self.closing = False
        self.sockets = {}
        self._hardware_cache: tuple[float, dict] | None = None

    @property
    def python(self) -> Path:
        return self.env_dir / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')

    def settings(self) -> dict:
        gpus=self.hw()['gpus']
        gpu=max(gpus,key=lambda g:g['free_mib']) if gpus else None
        defaults = dict(url='http://127.0.0.1:8189', gpu=gpu['index'] if gpu else 0,
                        vram_limit_gb=min(24,gpu['total_mib']/1024) if gpu else 24, managed=True,download_source='auto')
        if self.config_path.is_file(): defaults.update(json.loads(self.config_path.read_text()))
        return defaults

    def configure(self, settings: dict) -> dict:
        self.assert_idle()
        url = urllib.parse.urlsplit(settings['url'])
        if url.scheme != 'http' or url.hostname not in ('127.0.0.1','localhost','::1') or url.username or url.query or url.fragment or url.path not in ('','/'):
            raise ValueError('本地 ComfyUI 地址应为回环 HTTP 地址，例如 http://127.0.0.1:8189；远程服务请使用 SSH 转发')
        if not 4 <= settings['vram_limit_gb'] <= 24: raise ValueError('显存上限应为 4–24 GiB')
        atomic_json(self.config_path, settings)
        return settings

    def request(self, method: str, path: str, **kwargs):
        with httpx.Client(timeout=httpx.Timeout(60, connect=5), trust_env=False) as client:
            result = client.request(method, self.settings()['url'].rstrip('/') + path, **kwargs)
        if result.status_code >= 400:
            try: body = result.json()
            except ValueError: body = {}
            text = json.dumps(body, ensure_ascii=False)[:3000]
            raise RuntimeError(f'ComfyUI HTTP {result.status_code}: {text or result.reason_phrase}')
        return result

    def online(self) -> bool:
        try:
            return self.request('GET','/system_stats').status_code == 200
        except (httpx.HTTPError, RuntimeError): return False

    def hw(self) -> dict:
        if not self._hardware_cache or time.time() - self._hardware_cache[0] > 15:
            self._hardware_cache = (time.time(), hardware())
        return self._hardware_cache[1]

    def status(self) -> dict:
        hw = self.hw()
        profiles = []
        for profile in PROFILES.values():
            files = []
            validation=next((r for r in VALIDATION['runs'] if r['profile_id']==profile['id']),None)
            for key in profile['assets']:
                asset = ASSETS[key]
                path = self.models_dir / asset['directory'] / asset['filename']
                size = path.stat().st_size if path.is_file() else 0
                complete = bool(size and size == asset['size'])
                verified = False
                try:
                    stamp = json.loads(path.with_suffix(path.suffix + '.verified.json').read_text())
                    verified = complete and stamp['size'] == size and stamp['mtime_ns'] == path.stat().st_mtime_ns and stamp['sha256'] == asset['sha256']
                except (OSError, ValueError, KeyError): pass
                part = path.with_suffix(path.suffix + '.part')
                files.append({**asset, 'installed':complete,'verified':verified,
                              'downloaded_bytes':size or partial_bytes(part,asset['size']),
                              'local_path':str(path.relative_to(ROOT))})
            profiles.append({**profile,'validation':validation,'files':files,'installed':all(f['installed'] for f in files),
                             'verified':all(f['verified'] for f in files),'download_bytes':sum(max(0,f['size']-f['downloaded_bytes']) for f in files if not f['installed']),
                             'recommended':any(gpu['total_mib'] >= profile['vram_gb'] * 1024 for gpu in hw['gpus'])})
        return dict(hardware=hw,profiles=profiles,settings=self.settings(),runtime_online=self.online(),
                    environment_ready=(self.env_dir/'ready.json').is_file(),runtime_revision=RUNTIME['revision'],
                    storage=str(self.root.relative_to(ROOT)),jobs=self.list_jobs())

    def assert_idle(self) -> None:
        if self.current_job: raise ValueError('当前有本地任务正在运行，请等待完成或取消后再修改环境')
        path=self.root/'execution.lock'
        if os.name!='nt' and path.exists():
            import fcntl
            with path.open('r+') as file:
                try:fcntl.flock(file,fcntl.LOCK_EX|fcntl.LOCK_NB)
                except BlockingIOError:raise ValueError('另一工作台进程正在运行模型，请等待该任务结束') from None
                finally:
                    try:fcntl.flock(file,fcntl.LOCK_UN)
                    except OSError:pass

    @contextmanager
    def execution_lease(self,job_id:str):
        self.root.mkdir(parents=True,exist_ok=True)
        with (self.root/'execution.lock').open('a+b') as file:
            if os.name=='nt':
                import msvcrt
                file.write(b'0');file.flush()
            else:import fcntl
            while True:
                if self.cancelled(job_id):raise Cancelled('排队任务已取消')
                try:
                    if os.name=='nt':file.seek(0);msvcrt.locking(file.fileno(),msvcrt.LK_NBLCK,1)
                    else:fcntl.flock(file,fcntl.LOCK_EX|fcntl.LOCK_NB)
                    break
                except OSError:
                    self.update(job_id,message='等待当前模型完成 · 共享显卡队列')
                    time.sleep(1)
            try:yield
            finally:
                if os.name=='nt':file.seek(0);msvcrt.locking(file.fileno(),msvcrt.LK_UNLCK,1)
                else:fcntl.flock(file,fcntl.LOCK_UN)

    def _job_path(self, job_id: str) -> Path:
        if not re.fullmatch(r'[a-f0-9]{32}', job_id): raise ValueError('无效的任务 ID')
        return self.jobs_dir / (job_id + '.json')

    def job(self, job_id: str) -> dict:
        with self.lock:
            path = self._job_path(job_id)
            if not path.is_file(): raise FileNotFoundError('本地任务不存在')
            job = json.loads(path.read_text())
            if job['status'] not in TERMINAL and job_id not in self.live_jobs:
                if job.get('prompt_id') and job['kind'] == 'generate':
                    self.live_jobs.add(job_id)
                    self.cancel_events[job_id] = threading.Event()
                    self.worker.submit(self._resume, job_id)
                else:
                    job.update(status='interrupted',message='应用重启使任务中断；已下载内容保留，点击重试可以续传')
                    atomic_json(path, job)
            return job

    def list_jobs(self) -> list[dict]:
        if not self.jobs_dir.exists(): return []
        paths = sorted(self.jobs_dir.glob('*.json'), key=lambda p:p.stat().st_mtime, reverse=True)[:30]
        rows = []
        for path in paths:
            try: rows.append(self.job(path.stem))
            except (OSError, ValueError): pass
        return rows

    def update(self, job_id: str, **changes) -> dict:
        with self.lock:
            path = self._job_path(job_id)
            job = json.loads(path.read_text())
            job.update(changes, updated_at=time.time())
            atomic_json(path, job)
            return job

    def new_job(self, kind: str, **data) -> dict:
        job_id = uuid.uuid4().hex
        job = dict(id=job_id,kind=kind,status='queued',progress=0,message='等待执行',created_at=time.time(),updated_at=time.time(),**data)
        with self.lock:
            self.cancel_events[job_id] = threading.Event()
            self.live_jobs.add(job_id)
            atomic_json(self._job_path(job_id), job)
        return job

    def cancelled(self, job_id: str) -> bool:
        return self.closing or self.cancel_events[job_id].is_set()

    def _run_command(self, job_id: str, command: list[str], logfile: Path, cwd: Path | None = None) -> None:
        env = {**os.environ,'TMPDIR':str(ROOT/'.cache/tmp'),'PIP_CACHE_DIR':str(ROOT/'.cache/pip-local-ai'),
               'HF_HOME':str(self.root/'cache/huggingface'),'TORCH_HOME':str(self.root/'cache/torch'),
               'XDG_CACHE_HOME':str(self.root/'cache'),'PYTHONDONTWRITEBYTECODE':'1'}
        logfile.parent.mkdir(parents=True, exist_ok=True)
        with logfile.open('ab') as output:
            process = subprocess.Popen(command,cwd=cwd or ROOT,env=env,stdout=output,stderr=output,
                                       start_new_session=os.name!='nt')
            while process.poll() is None:
                if self.cancelled(job_id):
                    if os.name != 'nt': os.killpg(process.pid, signal.SIGTERM)
                    else: process.terminate()
                    try: process.wait(timeout=15)
                    except subprocess.TimeoutExpired: process.kill(); process.wait()
                    raise Cancelled('安装已取消，已下载文件保留')
                time.sleep(.5)
            if process.returncode:
                tail = logfile.read_text(errors='replace')[-2200:]
                raise RuntimeError('安装命令失败，请查看日志：' + str(logfile.relative_to(ROOT)) + '\n' + tail)

    def install_environment(self, job_id: str) -> None:
        if (self.env_dir/'ready.json').is_file() and (self.runtime/'main.py').is_file():
            self.sync_plugin()
            return
        hw = self.hw()
        if not hw['automatic_install_supported']:
            raise ValueError('一键 CUDA 安装目前支持 Linux/Windows + NVIDIA。其他平台请按文档手动安装 ComfyUI 并连接本地服务')
        if shutil.which('git') is None: raise ValueError('请先安装 Git，再重试一键安装')
        self.logs.mkdir(parents=True, exist_ok=True)
        self.update(job_id,message='安装独立 Python / CUDA 环境',progress=2)
        if not (self.runtime/'.git').is_dir():
            self.runtime.parent.mkdir(parents=True, exist_ok=True)
            self._run_command(job_id,['git','clone',RUNTIME['repository'],str(self.runtime)],self.logs/'install-runtime.log')
        revision = subprocess.check_output(['git','-C',str(self.runtime),'rev-parse','HEAD'],text=True).strip()
        if revision != RUNTIME['revision']:
            self._run_command(job_id,['git','-C',str(self.runtime),'fetch','--depth','1','origin',RUNTIME['revision']],self.logs/'install-runtime.log')
            self._run_command(job_id,['git','-C',str(self.runtime),'checkout','--detach',RUNTIME['revision']],self.logs/'install-runtime.log')
        if not self.python.exists():
            self._run_command(job_id,[sys.executable,'-m','venv',str(self.env_dir)],self.logs/'install-env.log')
        self._run_command(job_id,[str(self.python),'-m','pip','install','--no-cache-dir','--upgrade','pip'],self.logs/'install-env.log')
        command = [str(self.python),'-m','pip','install','--no-cache-dir',
                   'torch=='+RUNTIME['torch'],'torchvision=='+RUNTIME['torchvision'],'torchaudio=='+RUNTIME['torchaudio'],
                   '--index-url','https://download.pytorch.org/whl/'+RUNTIME['cuda'],'--extra-index-url','https://pypi.org/simple']
        self._run_command(job_id,command,self.logs/'install-torch.log')
        core_requirements=self.env_dir/'requirements.core.txt'
        core_requirements.write_text('\n'.join(line for line in (self.runtime/'requirements.txt').read_text().splitlines()
                                               if not line.startswith(('comfyui-workflow-templates','comfyui-embedded-docs')))+'\n')
        command=[str(self.python),'-m','pip','install','--no-cache-dir','-r',str(core_requirements),
                 'demucs==4.0.1','soundfile','rotary-embedding-torch','trimesh',
                 '-c',str(Path(__file__).with_name('requirements.lock'))]
        if self.settings().get('download_source')=='auto':
            try:self._run_command(job_id,command+['--index-url','https://pypi.tuna.tsinghua.edu.cn/simple'],self.logs/'install-comfy.log')
            except RuntimeError:self._run_command(job_id,command+['--index-url','https://pypi.org/simple'],self.logs/'install-comfy.log')
        else:self._run_command(job_id,command+['--index-url','https://pypi.org/simple'],self.logs/'install-comfy.log')
        extension = self.runtime/'custom_nodes/ComfyUI-MelBandRoFormer'
        if not (extension/'.git').is_dir():
            self._run_command(job_id,['git','clone','https://github.com/kijai/ComfyUI-MelBandRoFormer.git',str(extension)],self.logs/'install-extension.log')
        self._run_command(job_id,['git','-C',str(extension),'fetch','--depth','1','origin','92c86854e6654f4aacc97484471af95c98ea16d4'],self.logs/'install-extension.log')
        self._run_command(job_id,['git','-C',str(extension),'checkout','--detach','92c86854e6654f4aacc97484471af95c98ea16d4'],self.logs/'install-extension.log')
        plugin = self.runtime/'custom_nodes/td_open_nodes'
        plugin.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(Path(__file__).with_name('comfy_nodes.py'),plugin/'__init__.py')
        self._run_command(job_id,[str(self.python),'-m','pip','check'],self.logs/'install-comfy.log')
        lock = subprocess.check_output([str(self.python),'-m','pip','freeze'],text=True)
        (self.env_dir/'requirements.installed.txt').write_text(lock)
        atomic_json(self.env_dir/'ready.json',dict(runtime_revision=RUNTIME['revision'],installed_at=time.time(),platform=hw['platform']))

    def sync_plugin(self) -> None:
        plugin=self.runtime/'custom_nodes/td_open_nodes'
        plugin.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(Path(__file__).with_name('comfy_nodes.py'),plugin/'__init__.py')

    def install(self, profile_ids: list[str], environment: bool = True) -> dict:
        assets = profile_assets(profile_ids)
        existing = self.list_jobs()
        if any(j['kind']=='install' and j['status'] not in TERMINAL for j in existing):
            raise ValueError('已有安装任务，等待完成或取消后再安装其他模型')
        needed = sum(max(0,a['size']-partial_bytes(self.models_dir/a['directory']/(a['filename']+'.part'),a['size']))
                     for a in assets if not (self.models_dir/a['directory']/a['filename']).is_file())
        reserve = 8*1024**3 + (0 if self.python.exists() else 8*1024**3)
        if shutil.disk_usage(ROOT).free < needed + reserve:
            raise ValueError(f'磁盘空间不足：需要约 {(needed+reserve)/1024**3:.1f} GiB（含环境及预留空间）；请按模型分别安装')
        job = self.new_job('install',profile_ids=profile_ids,environment=environment)
        self.installer.submit(self._install,job['id'],assets,environment)
        return job

    def _install(self, job_id: str, assets: list[dict], environment: bool) -> None:
        try:
            self.update(job_id,status='running',message='准备安装')
            if environment: self.install_environment(job_id)
            token_file = self.data_dir/'config/huggingface.token'
            token = os.environ.get('HF_TOKEN','') or (token_file.read_text().strip() if token_file.is_file() else '')
            total = sum(asset['size'] for asset in assets) or 1
            downloaded: dict[str,int] = {}
            last_update = [0.0]
            def report(asset: dict, done: int, size: int):
                with self.lock:
                    downloaded[asset['id']] = min(done,asset['size'])
                    now = time.time()
                    if now-last_update[0]>1 or done==size:
                        last_update[0] = now
                        self.update(job_id,progress=min(99,5+94*sum(downloaded.values())/total),
                                    message='下载并校验：'+asset['filename'],downloaded_bytes=sum(downloaded.values()),total_bytes=total)
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                futures=[pool.submit(download_asset,{**asset,'no_mirror':self.settings().get('download_source')=='official'},self.models_dir,token,
                                     lambda done,size,a=asset:report(a,done,size),lambda:self.cancelled(job_id)) for asset in assets]
                for future in concurrent.futures.as_completed(futures): future.result()
            if self.cancelled(job_id): raise Cancelled('安装已取消')
            self.update(job_id,status='succeeded',progress=100,message='环境与权重就绪，可运行本地节点')
        except Cancelled as error: self.update(job_id,status='cancelled',message=str(error))
        except Exception as error: self.update(job_id,status='failed',message=str(error)[-4000:])
        finally: self.live_jobs.discard(job_id)

    def start(self) -> dict:
        with self.lock:
            if self.online(): return dict(online=True,url=self.settings()['url'])
            if not self.settings()['managed']: raise ValueError('外部 ComfyUI 未连接，请按手动说明启动该服务')
            if not (self.env_dir/'ready.json').is_file(): raise ValueError('请先一键安装运行环境，或按手动文档完成环境检查')
            settings = self.settings()
            self.sync_plugin()
            if not self.config_path.is_file():atomic_json(self.config_path,settings)
            url = urllib.parse.urlsplit(settings['url'])
            if url.hostname not in ('127.0.0.1','localhost'): raise ValueError('托管服务请使用 IPv4 回环地址')
            self.root.mkdir(parents=True,exist_ok=True)
            self.logs.mkdir(parents=True,exist_ok=True)
            for folder in ('input','output','temp','user','cache','custom_nodes'): (self.root/folder).mkdir(exist_ok=True)
            env = {**os.environ,'CUDA_VISIBLE_DEVICES':str(settings['gpu']),'TD_LOCAL_AI_ROOT':str(self.root),
                   'TD_LOCAL_AI_VRAM_GB':str(settings['vram_limit_gb']),
                   'HF_HOME':str(self.root/'cache/huggingface'),'TORCH_HOME':str(self.root/'cache/torch'),
                   'XDG_CACHE_HOME':str(self.root/'cache'),'TMPDIR':str(ROOT/'.cache/tmp'),
                   'TRITON_CACHE_DIR':str(self.root/'cache/triton'),'CUDA_CACHE_PATH':str(self.root/'cache/cuda'),
                   'TORCHINDUCTOR_CACHE_DIR':str(self.root/'cache/torchinductor'),'NUMBA_CACHE_DIR':str(self.root/'cache/numba'),
                   'MPLCONFIGDIR':str(self.root/'cache/matplotlib'),
                   'PYTHONDONTWRITEBYTECODE':'1','PYTHONUNBUFFERED':'1','TOKENIZERS_PARALLELISM':'false'}
            gpu = next((g for g in self.hw()['gpus'] if g['index']==settings['gpu']),None)
            if gpu is None: raise ValueError('未找到所选 NVIDIA GPU')
            reserve = max(1.5,gpu['total_mib']/1024-settings['vram_limit_gb']+1.5)
            command=[str(self.python),str(Path(__file__).with_name('comfy_bootstrap.py')),
                     '--listen','127.0.0.1','--port',str(url.port or 8189),'--base-directory',str(self.root),
                     '--models-directory',str(self.models_dir),'--disable-dynamic-vram','--lowvram',
                     '--reserve-vram',str(round(reserve,2)),'--preview-method','none','--offline',
                     '--disable-comfy-compiler','--disable-auto-launch','--cache-none']
            with (self.logs/'comfy-server.log').open('ab') as output:
                self.process=subprocess.Popen(command,cwd=self.runtime,env=env,stdout=output,stderr=output,
                                               start_new_session=os.name!='nt')
            atomic_json(self.root/'server.json',dict(pid=self.process.pid,url=settings['url'],started_at=time.time()))
        for _ in range(120):
            if self.online(): return dict(online=True,url=settings['url'],pid=self.process.pid)
            if self.process.poll() is not None:
                raise RuntimeError('ComfyUI 启动失败，请查看 '+str((self.logs/'comfy-server.log').relative_to(ROOT)))
            time.sleep(1)
        raise TimeoutError('ComfyUI 启动尚未完成，请查看启动日志后刷新状态')

    def stop(self) -> dict:
        self.assert_idle()
        pid_file = self.root/'server.json'
        if not pid_file.exists(): raise ValueError('当前服务不是 TD Open 启动的进程，请在原终端停止')
        pid = json.loads(pid_file.read_text())['pid']
        if os.name != 'nt':
            try:
                command = Path(f'/proc/{pid}/cmdline').read_bytes()
                if str(Path(__file__).with_name('comfy_bootstrap.py')).encode() not in command:
                    raise ValueError('进程身份不匹配，未停止服务')
                os.kill(pid,signal.SIGTERM)
                deadline=time.monotonic()+15
                while time.monotonic()<deadline:
                    try:
                        state=Path(f'/proc/{pid}/stat').read_text().split(') ',1)[1].split()[0]
                    except FileNotFoundError:break
                    if state=='Z':break
                    time.sleep(.1)
                else:raise TimeoutError('停止服务尚未完成，请稍后重试')
            except FileNotFoundError: pass
        elif self.process and self.process.pid==pid: self.process.terminate()
        else: raise ValueError('请在启动 ComfyUI 的终端停止服务')
        pid_file.unlink(missing_ok=True)
        return dict(stopped=True)

    def cancel(self, job_id: str) -> dict:
        job = self.job(job_id)
        if job['status'] in TERMINAL: return job
        self.cancel_events[job_id].set()
        if job.get('prompt_id'):
            try:
                self.request('POST','/queue',json={'delete':[job['prompt_id']]})
                self.request('POST','/interrupt',json={'prompt_id':job['prompt_id']})
            except (httpx.HTTPError, RuntimeError): pass
        return self.update(job_id,message='正在取消当前任务')

    def log_tail(self, filename: str) -> str:
        allowed = {'comfy-server.log','install-runtime.log','install-env.log','install-torch.log','install-comfy.log','install-extension.log'}
        if filename not in allowed: raise ValueError('无效的日志名称')
        path=self.logs/filename
        if not path.is_file(): return '日志尚未创建'
        with path.open('rb') as file:
            file.seek(max(0,path.stat().st_size-18000))
            return file.read().decode('utf-8',errors='replace')

    def submit(self, profile_id: str | None, parameters: dict, inputs: dict[str,str], workflow: dict | None = None,
               metadata: dict | None = None) -> dict:
        if workflow is None:
            profile = get_profile(profile_id or '')
            missing = [a for a in profile_assets([profile['id']]) if not (self.models_dir/a['directory']/a['filename']).is_file()]
            if missing and self.settings()['managed']: raise ValueError('模型权重未安装，请打开本地模型中心一键安装：'+profile['name'])
        if len(json.dumps(workflow or parameters)) > 4*1024*1024: raise ValueError('工作流不能超过 4 MB')
        job=self.new_job('generate',profile_id=profile_id,parameters=parameters,inputs=inputs,workflow=workflow,
                         metadata=metadata or {},outputs=[])
        self.worker.submit(self._generate,job['id'])
        return job

    def _input(self, source: str, job_id: str) -> str:
        if not source.startswith('/api/assets/') and not source.startswith('/api/exports/'):
            raise ValueError('输入素材须先上传到 TD Open，使用 /api/assets/ 或 /api/exports/ 地址')
        parsed=urllib.parse.urlsplit(source)
        if parsed.query or parsed.fragment: raise ValueError('本地素材地址不能有查询参数')
        folder='assets' if source.startswith('/api/assets/') else 'exports'
        filename=source.rsplit('/',1)[-1]
        if not re.fullmatch(r'[a-f0-9]{32}\.[a-zA-Z0-9]+',filename): raise ValueError('无效的本地素材路径')
        original=self.data_dir/folder/filename
        if not original.is_file() or original.is_symlink(): raise ValueError('输入素材不存在')
        suffix=original.suffix.lower()
        if suffix not in EXTENSIONS: raise ValueError('不支持的输入素材类型')
        name=job_id+'_'+uuid.uuid4().hex[:8]+suffix
        if self.settings()['managed']:
            (self.root/'input').mkdir(parents=True,exist_ok=True)
            shutil.copyfile(original,self.root/'input'/name)
            return name
        with original.open('rb') as file:
            result=self.request('POST','/upload/image',files={'image':(name,file)},data={'overwrite':'true','type':'input'}).json()
        return result['name']

    def _generate(self, job_id: str) -> None:
        try:
            with self.execution_lease(job_id):self._generate_unlocked(job_id)
        except Cancelled as error:self.update(job_id,status='cancelled',message=str(error))
        except Exception as error:self.update(job_id,status='failed',message=str(error)[-4000:])
        finally:self.live_jobs.discard(job_id)

    def _generate_unlocked(self, job_id: str) -> None:
        self.current_job=job_id
        try:
            if self.cancelled(job_id): raise Cancelled('任务已取消')
            self.update(job_id,status='running',message='启动本地推理引擎',progress=1)
            self.start()
            job=json.loads(self._job_path(job_id).read_text())
            inputs={key:self._input(value,job_id) for key,value in job['inputs'].items() if value}
            from .workflows import build_workflow, validate_workflow
            workflow=job['workflow'] if job['workflow'] is not None else build_workflow(job['profile_id'],job['parameters'],inputs,job_id)
            def replace_input(value):
                if isinstance(value,str) and value.startswith('__TD_INPUT__'):
                    key=value[len('__TD_INPUT__'):]
                    if key not in inputs:raise ValueError('缺少工作流输入素材：'+key)
                    return inputs[key]
                if isinstance(value,dict):return {key:replace_input(child) for key,child in value.items()}
                if isinstance(value,list):return [replace_input(child) for child in value]
                return value
            workflow=replace_input(workflow)
            available=self.request('GET','/object_info').json()
            validate_workflow(workflow,available)
            if self.settings()['managed']:
                self.request('POST','/free',json={'unload_models':True,'free_memory':True})
                self.request('POST','/td-open/metrics/reset',json={})
            queued=self.request('POST','/prompt',json={'prompt':workflow,'client_id':'td-open-'+job_id}).json()
            if queued.get('node_errors'): raise ValueError('ComfyUI 节点验证失败：'+json.dumps(queued['node_errors'],ensure_ascii=False)[:3000])
            prompt_id=queued['prompt_id']
            self.update(job_id,prompt_id=prompt_id,message='模型正在运行',workflow=workflow,progress=5)
            self._monitor(job_id,prompt_id)
        except Cancelled as error:self.update(job_id,status='cancelled',message=str(error))
        except Exception as error:self.update(job_id,status='failed',message=str(error)[-4000:])
        finally:
            socket=self.sockets.pop(job_id,None)
            if socket:socket.close()
            self.current_job=None
            self.live_jobs.discard(job_id)

    def _resume(self, job_id: str) -> None:
        try:
            with self.execution_lease(job_id):self._resume_unlocked(job_id)
        except Cancelled as error:self.update(job_id,status='cancelled',message=str(error))
        except Exception as error:self.update(job_id,status='interrupted',message=str(error)[-3000:])
        finally:self.live_jobs.discard(job_id)

    def _resume_unlocked(self, job_id: str) -> None:
        self.current_job=job_id
        try:
            job=json.loads(self._job_path(job_id).read_text())
            self._monitor(job_id,job['prompt_id'])
        except Cancelled as error:self.update(job_id,status='cancelled',message=str(error))
        except Exception as error:self.update(job_id,status='interrupted',message='恢复任务失败：'+str(error)[-3000:])
        finally:
            socket=self.sockets.pop(job_id,None)
            if socket:socket.close()
            self.current_job=None
            self.live_jobs.discard(job_id)

    def _peak_memory(self) -> int:
        if not self.settings()['managed']:return 0
        pid_file=self.root/'server.json'
        if not pid_file.is_file(): return 0
        try:
            pid=json.loads(pid_file.read_text())['pid']
            result=subprocess.run(['nvidia-smi','--query-compute-apps=pid,used_memory','--format=csv,noheader,nounits'],capture_output=True,text=True,timeout=5)
            for line in result.stdout.splitlines():
                parts=line.split(',')
                if len(parts)==2 and parts[0].strip()==str(pid): return int(parts[1].strip())
        except (OSError,ValueError,KeyError,subprocess.TimeoutExpired):pass
        return 0

    def _monitor(self, job_id: str, prompt_id: str) -> None:
        begin=time.time()
        peak=0
        socket=None
        stage_progress=5
        stage='模型运行中'
        try:
            from websockets.sync.client import connect
            url=self.settings()['url'].replace('http://','ws://',1)+'/ws?clientId=td-open-'+job_id
            socket=connect(url,open_timeout=5,max_size=4*1024*1024,proxy=None)
            self.sockets[job_id]=socket
        except Exception:pass
        while time.time()-begin<3600:
            if self.cancelled(job_id):
                self.request('POST','/queue',json={'delete':[prompt_id]})
                self.request('POST','/interrupt',json={'prompt_id':prompt_id})
                raise Cancelled('任务已取消')
            peak=max(peak,self._peak_memory())
            if socket:
                try:
                    for _ in range(30):
                        message=socket.recv(timeout=.001)
                        if not isinstance(message,str):continue
                        event=json.loads(message);data=event.get('data',{})
                        if data.get('prompt_id') not in (None,prompt_id):continue
                        if event.get('type')=='progress' and data.get('max'):
                            stage_progress=5+90*data['value']/data['max']
                            stage=f"采样 {data['value']} / {data['max']}"
                        elif event.get('type')=='executing' and data.get('node'):
                            stage='执行节点 '+str(data['node'])
                except TimeoutError:pass
                except Exception:
                    socket.close();socket=None
            if peak>self.settings()['vram_limit_gb']*1024:
                self.request('POST','/interrupt',json={'prompt_id':prompt_id})
                raise RuntimeError('任务显存超过设置上限，已停止；请降低分辨率/时长或启用更小模型')
            history=self.request('GET','/history/'+urllib.parse.quote(prompt_id,safe='')).json().get(prompt_id)
            if history:
                status=history.get('status',{})
                messages=status.get('messages',[])
                errors=[entry[1] for entry in messages if entry[0] in ('execution_error','execution_interrupted')]
                if errors: raise RuntimeError('ComfyUI 执行失败：'+json.dumps(errors,ensure_ascii=False)[-3000:])
                if status.get('status_str')=='error': raise RuntimeError('ComfyUI 执行失败，请查看运行日志')
                if status.get('completed') or history.get('outputs'):
                    outputs=self._save_outputs(job_id,history['outputs'])
                    if not outputs: raise ValueError('工作流执行完成但没有可保存资源，请添加 SaveImage / SaveAudio / SaveVideo / SaveGLB 输出节点')
                    self.update(job_id,status='succeeded',progress=100,message='本地生成完成',outputs=outputs,
                                result_url=outputs[0]['url'],elapsed_seconds=round(time.time()-begin,2),peak_vram_mib=peak)
                    if self.settings()['managed']:
                        try:
                            metrics=self.request('GET','/td-open/metrics').json()
                            self.update(job_id,cuda_metrics=metrics)
                        except (httpx.HTTPError,RuntimeError):pass
                    if socket:socket.close()
                    return
            elapsed=time.time()-begin
            self.update(job_id,message=f'{stage} · 已用 {int(elapsed)} 秒',progress=stage_progress,elapsed_seconds=round(elapsed,2),peak_vram_mib=peak)
            time.sleep(2)
        self.request('POST','/interrupt',json={'prompt_id':prompt_id})
        if socket:socket.close()
        raise TimeoutError('本地推理超过一小时，任务已停止；请缩短时长或降低分辨率')

    def _save_outputs(self, job_id: str, raw: dict) -> list[dict]:
        references=[]
        def visit(value, node_id):
            if isinstance(value,dict):
                if isinstance(value.get('filename'),str): references.append((node_id,value))
                else:
                    for child in value.values(): visit(child,node_id)
            elif isinstance(value,list):
                for child in value:visit(child,node_id)
        for node_id,value in raw.items():visit(value,node_id)
        outputs=[]
        seen=set()
        assets=self.data_dir/'assets';assets.mkdir(parents=True,exist_ok=True)
        for node_id,ref in references:
            name=ref['filename']
            suffix=Path(name).suffix.lower()
            if suffix not in EXTENSIONS: continue
            subfolder=ref.get('subfolder','')
            if Path(name).name!=name or '\\' in name or '..' in Path(subfolder).parts or Path(subfolder).is_absolute():
                raise ValueError('ComfyUI 返回了无效的输出路径')
            key=(name,subfolder,ref.get('type','output'))
            if key in seen:continue
            seen.add(key)
            target=assets/(uuid.uuid4().hex+suffix)
            size=0
            try:
                with httpx.Client(timeout=120,trust_env=False) as client:
                    with client.stream('GET',self.settings()['url']+'/view',params={'filename':name,'subfolder':subfolder,'type':ref.get('type','output')}) as response:
                        response.raise_for_status()
                        with target.open('xb') as file:
                            for chunk in response.iter_bytes():
                                if self.cancelled(job_id):raise Cancelled('任务已取消')
                                size+=len(chunk)
                                if size>500*1024*1024:raise ValueError('单个生成资源超过 500 MB，请缩短生成时长或分段输出')
                                file.write(chunk)
                if not size:raise ValueError('ComfyUI 返回了空资源')
            except BaseException:
                target.unlink(missing_ok=True)
                raise
            outputs.append(dict(url='/api/assets/'+target.name,name=name,kind=EXTENSIONS[suffix],size=size,source_node=node_id))
        return outputs

    def shutdown(self) -> None:
        self.closing=True
        self.worker.shutdown(wait=False,cancel_futures=True)
        self.installer.shutdown(wait=False,cancel_futures=True)
