"""Resumable streaming downloads of pinned, curated weights, with SHA-256 checks."""
from __future__ import annotations

import hashlib
import concurrent.futures
import json
import os
import time
import threading
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable


class Cancelled(Exception):
    pass


def partial_bytes(path:Path,total:int)->int:
    journal=path.with_suffix(path.suffix+'.ranges.json')
    if journal.is_file():
        try:
            state=json.loads(journal.read_text())
            return min(total,state['prefix']+sum(min(state['chunk_size'],total-start) for start in state['completed']))
        except (ValueError,KeyError,OSError):return 0
    return min(total,path.stat().st_size) if path.is_file() else 0


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        result=super().redirect_request(request,fp,code,message,headers,newurl)
        if result and urllib.parse.urlsplit(request.full_url).netloc != urllib.parse.urlsplit(newurl).netloc:
            result.remove_header('Authorization')
        return result


def _open(request, timeout=60):
    return urllib.request.build_opener(SafeRedirect()).open(request,timeout=timeout)


def parallel_download(asset: dict, partial: Path, token: str, progress: Callable, cancelled: Callable) -> None:
    """Bounded range workers. A separate journal distinguishes holes from completed bytes."""
    total=asset['size']
    journal=partial.with_suffix(partial.suffix+'.ranges.json')
    if journal.is_file():
        state=json.loads(journal.read_text())
        if state['url']!=asset['url'] or state['total']!=total:raise ValueError('续传记录不属于当前固定模型版本')
    else:
        state={'url':asset['url'],'total':total,'prefix':partial.stat().st_size if partial.is_file() else 0,
               'chunk_size':4*1024*1024,'completed':[]}
        if state['prefix']>total:raise ValueError('续传文件超过预期长度')
    def save():
        temporary=journal.with_suffix('.tmp')
        temporary.write_text(json.dumps(state))
        os.replace(temporary,journal)
    save()
    endpoints=[]
    if asset.get('repo') and not asset.get('no_mirror'):
        endpoints.append('https://modelscope.cn/models/'+asset['repo']+'/resolve/master/'+asset['path'])
    endpoints.append(asset['url'] + ('&' if '?' in asset['url'] else '?') + 'download=true' if asset['url'].startswith('https://huggingface.co/') else asset['url'])
    resolved=None
    for endpoint in endpoints:
        headers={'Range':'bytes=0-0','User-Agent':'TD-Open-Local-AI/0.5'}
        if token and endpoint.startswith('https://huggingface.co/'):headers['Authorization']='Bearer '+token
        for attempt in range(2):
            try:
                with _open(urllib.request.Request(endpoint,headers=headers),timeout=20) as response:
                    if response.status==206 and response.headers.get('Content-Range')==f'bytes 0-0/{total}':
                        response.read(1)
                        resolved=response.geturl()
                if resolved:break
            except urllib.error.HTTPError as error:
                if endpoint.startswith('https://huggingface.co/') and error.code in (401,403):raise PermissionError('模型需要账户授权，请查看手动安装说明') from None
                if error.code in (404,410):break
            except (OSError,urllib.error.URLError):pass
        if resolved:break
    if resolved is None:raise ConnectionError('下载源没有提供有效续传范围；可重试或手动下载官方权重')
    lock=threading.RLock()
    aborted=threading.Event()
    completed=set(state['completed'])
    chunks={start:min(start+state['chunk_size'],total)-1 for start in range(state['prefix'],total,state['chunk_size'])}
    inflight={}
    def done_bytes():return state['prefix']+sum(chunks[k]-k+1 for k in completed)+sum(inflight.values())
    descriptor=os.open(partial,os.O_CREAT|os.O_WRONLY,0o600)
    progress(done_bytes(),total)
    def fetch(start):
        end=chunks[start]
        for attempt in range(8):
            if cancelled() or aborted.is_set():raise Cancelled('下载已取消，分块续传记录已保留')
            try:
                req=urllib.request.Request(resolved,headers={'Range':f'bytes={start}-{end}','User-Agent':'TD-Open-Local-AI/0.5'})
                with _open(req,timeout=45) as response:
                    if response.status!=206 or response.headers.get('Content-Range')!=f'bytes {start}-{end}/{total}':
                        raise IOError('服务器没有返回请求的分块范围')
                    offset=start
                    while offset<=end:
                        if cancelled() or aborted.is_set():raise Cancelled('下载已取消，分块续传记录已保留')
                        data=response.read(min(1024*1024,end-offset+1))
                        if not data:raise IOError('分块下载中断')
                        if hasattr(os,'pwrite'):os.pwrite(descriptor,data,offset)
                        else:
                            with lock:
                                os.lseek(descriptor,offset,os.SEEK_SET);os.write(descriptor,data)
                        offset+=len(data)
                        with lock:
                            inflight[start]=offset-start
                            progress(done_bytes(),total)
                with lock:
                    inflight.pop(start,None);completed.add(start);state['completed']=sorted(completed)
                    os.fsync(descriptor);save();progress(done_bytes(),total)
                return
            except (OSError,urllib.error.URLError) as error:
                with lock:inflight.pop(start,None)
                if attempt==7:raise ConnectionError('分块下载失败，重试会从已完成的分块继续') from error
                time.sleep(min(2**attempt,10))
        raise ConnectionError('无法完成下载')
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            futures=[pool.submit(fetch,start) for start in chunks if start not in completed]
            try:
                for future in concurrent.futures.as_completed(futures):future.result()
            except BaseException:
                aborted.set()
                for future in futures:future.cancel()
                raise
    finally:os.close(descriptor)
    if len(completed)!=len(chunks):raise ConnectionError('下载尚未完整')
    journal.unlink(missing_ok=True)


def checksum(path: Path, cancelled: Callable[[], bool] = lambda: False) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as file:
        while chunk := file.read(8 * 1024 * 1024):
            if cancelled(): raise Cancelled('任务已取消')
            digest.update(chunk)
    return digest.hexdigest()


def download_asset(asset: dict, models_dir: Path, token: str = '',
                   progress: Callable[[int, int], None] = lambda *_: None,
                   cancelled: Callable[[], bool] = lambda: False) -> dict:
    folder = models_dir / asset['directory']
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / asset['filename']
    if not target.resolve().is_relative_to(models_dir.resolve()):
        raise ValueError('模型文件不能位于模型目录之外')
    receipt = target.with_suffix(target.suffix + '.verified.json')
    expected = asset.get('sha256')
    prefix = asset.get('sha256_prefix')
    expected_size = asset.get('size')
    if target.is_file():
        stat = target.stat()
        if receipt.is_file():
            try:
                saved = json.loads(receipt.read_text())
                if saved['size'] == stat.st_size and saved['mtime_ns'] == stat.st_mtime_ns and (not expected or saved['sha256'] == expected):
                    progress(stat.st_size, stat.st_size)
                    return saved
            except (KeyError, ValueError, OSError): pass
        if not expected_size or stat.st_size == expected_size:
            actual = checksum(target, cancelled)
            if (not expected or actual == expected) and (not prefix or actual.startswith(prefix)):
                record = dict(size=stat.st_size, mtime_ns=stat.st_mtime_ns, sha256=actual, url=asset['url'])
                receipt.write_text(json.dumps(record, indent=2) + '\n')
                progress(stat.st_size, stat.st_size)
                return record
        raise ValueError('已有权重大小或校验值不符，请移动该文件后重试：' + str(target))
    partial = target.with_suffix(target.suffix + '.part')
    total = expected_size or asset.get('size', 0)
    if expected_size and expected_size>8*1024*1024:
        parallel_download(asset,partial,token,progress,cancelled)
        actual=checksum(partial,cancelled)
        if (expected and actual!=expected) or (prefix and not actual.startswith(prefix)):
            raise ValueError('权重 SHA-256 校验失败；请保留该文件供检查，移动 .part 文件后重新下载')
        os.replace(partial,target)
        stat=target.stat()
        record=dict(size=stat.st_size,mtime_ns=stat.st_mtime_ns,sha256=actual,url=asset['url'])
        receipt.write_text(json.dumps(record,indent=2)+'\n')
        progress(stat.st_size,stat.st_size)
        return record
    for attempt in range(8):
        if cancelled(): raise Cancelled('任务已取消，已下载部分保留，可重试续传')
        start = partial.stat().st_size if partial.exists() else 0
        if expected_size and start > expected_size:
            raise ValueError('下载临时文件超过预期大小：' + str(partial))
        if expected_size and start == expected_size: break
        headers = {'User-Agent': 'TD-Open-Local-AI/0.5'}
        if start: headers['Range'] = f'bytes={start}-'
        if token and asset['url'].startswith('https://huggingface.co/'):
            headers['Authorization'] = 'Bearer ' + token
        try:
            with _open(urllib.request.Request(asset['url'], headers=headers), timeout=60) as response:
                ranged = response.status == 206
                if ranged and not response.headers.get('Content-Range', '').startswith(f'bytes {start}-'):
                    raise ValueError('服务返回了不匹配的续传范围')
                if start and not ranged: start = 0
                length = response.headers.get('Content-Length')
                server_total = start + int(length) if length else total
                if expected_size and server_total and server_total != expected_size:
                    raise ValueError('远端权重大小与固定清单不符')
                total = server_total or total
                with partial.open('ab' if ranged and start else 'wb') as file:
                    received = start
                    while chunk := response.read(4 * 1024 * 1024):
                        if cancelled(): raise Cancelled('任务已取消，已下载部分保留，可重试续传')
                        file.write(chunk)
                        received += len(chunk)
                        if expected_size and received > expected_size: raise ValueError('下载超过预期大小')
                        progress(received, total)
                    file.flush()
                    os.fsync(file.fileno())
            if expected_size and partial.stat().st_size != expected_size:
                raise IOError('下载中断，准备续传')
            break
        except urllib.error.HTTPError as error:
            if error.code in (401, 403):
                raise PermissionError('权重需要账户授权，或下载源拒绝访问；请查看模型许可与手动下载说明') from None
            if error.code in (404, 410): raise ValueError('固定版本的权重地址不存在') from None
            if attempt == 7: raise ConnectionError(f'权重下载失败（HTTP {error.code}），已保留续传文件') from None
            time.sleep(min(2 ** attempt, 15))
        except (TimeoutError, OSError, urllib.error.URLError) as error:
            if attempt == 7: raise ConnectionError('权重下载连接失败，已保留续传文件；可重试或手动下载') from error
            time.sleep(min(2 ** attempt, 15))
    actual = checksum(partial, cancelled)
    if (expected and actual != expected) or (prefix and not actual.startswith(prefix)):
        raise ValueError('权重 SHA-256 校验失败，请移动 .part 文件后重新下载')
    os.replace(partial, target)
    stat = target.stat()
    record = dict(size=stat.st_size, mtime_ns=stat.st_mtime_ns, sha256=actual, url=asset['url'])
    receipt.write_text(json.dumps(record, indent=2) + '\n')
    progress(stat.st_size, stat.st_size)
    return record
