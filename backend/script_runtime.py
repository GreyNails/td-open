"""Manually triggered local Python callbacks. Trusted code, not a security sandbox."""
from __future__ import annotations
import asyncio
import hashlib
import json
import os
from pathlib import Path
import sys
import secrets
import time

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field, JsonValue
from backend.process_runtime import ProcessOutputLimit, run_bounded_process


class ScriptRequest(BaseModel):
    code: str = Field(min_length=1, max_length=100000)
    inputs: dict[str, JsonValue] = Field(default_factory=dict)
    time: float = Field(default=0, allow_inf_nan=False)


WORKER = '''import contextlib, io, json, math, sys, traceback
from pathlib import Path
# Resource limits contain accidental loops/large allocations; this remains
# trusted Python with the account's filesystem/network permissions.
try:
    import resource
    resource.setrlimit(resource.RLIMIT_CPU, (9, 10))
    resource.setrlimit(resource.RLIMIT_AS, (2 * 1024**3, 2 * 1024**3))
except (ImportError, ValueError, OSError): pass
class TailLog(io.TextIOBase):
    def __init__(self): self.tail = ""
    def write(self, value):
        self.tail = (self.tail + value[-10000:])[-10000:]
        return len(value)
    def getvalue(self): return self.tail
request = json.loads(sys.stdin.read())
log = TailLog()
try:
    namespace = {"__name__": "td_open_script", "__file__": sys.argv[1]}
    with contextlib.redirect_stdout(log), contextlib.redirect_stderr(log):
        exec(compile(Path(sys.argv[1]).read_text(encoding="utf-8"), sys.argv[1], "exec"), namespace)
        callback = namespace.get("cook")
        if not callable(callback): raise ValueError("Define cook(inputs, time) in your Python script")
        result = callback(request.get("inputs", {}), request.get("time", 0))
    print(json.dumps({"value": result, "log": log.getvalue()}, allow_nan=False))
except BaseException:
    print(json.dumps({"error": traceback.format_exc(limit=8), "log": log.getvalue()}))
'''


def create_script_router(data_dir: Path) -> APIRouter:
    router = APIRouter(prefix="/api/scripts", tags=["Python scripts"])
    script_dir = data_dir.resolve() / "scripts"
    if script_dir.is_symlink(): raise ValueError("Script directory cannot be a symbolic link")
    script_dir.mkdir(parents=True, exist_ok=True)
    temporary = script_dir / ".tmp"; temporary.mkdir(exist_ok=True)
    worker = script_dir / "_td_worker.py"
    if worker.is_symlink(): raise ValueError("Script worker cannot be a symbolic link")
    worker.write_text(WORKER, encoding="utf-8")
    slots = asyncio.Semaphore(2)
    intents: dict[str, tuple[float, str]] = {}

    def local_client(connection: Request):
        if not connection.client or connection.client.host not in ("127.0.0.1", "::1", "testclient"):
            raise HTTPException(403, "Python 脚本仅允许通过本机连接执行")
        return connection.client.host

    @router.post("/intent")
    async def intent(connection: Request, response: Response):
        client = local_client(connection)
        now = time.monotonic()
        for token, (expires, _) in list(intents.items()):
            if expires <= now: intents.pop(token, None)
        if len(intents) >= 256: raise HTTPException(429, "待运行脚本请求过多")
        token = secrets.token_urlsafe(32)
        intents[token] = (now + 30, client)
        response.headers["Cache-Control"] = "no-store"
        return {"token": token, "expires_in": 30}

    @router.post("/run")
    async def run(request: ScriptRequest, connection: Request):
        client = local_client(connection)
        token = connection.headers.get("x-td-script-intent", "")
        approval = intents.pop(token, None)
        if not approval or approval[0] <= time.monotonic() or approval[1] != client:
            raise HTTPException(403, "请点击手动运行；脚本需要有效的一次性运行令牌")
        payload = json.dumps({"inputs": request.inputs, "time": request.time}, allow_nan=False).encode()
        if len(payload) > 6 * 1024 * 1024: raise HTTPException(413, "脚本输入超过 6 MB")
        digest = hashlib.sha256(request.code.encode()).hexdigest()
        source = script_dir / (digest + ".py")
        if source.is_symlink(): raise HTTPException(400, "脚本路径不能是符号链接")
        async with slots:
            source.write_text(request.code, encoding="utf-8")
            env = {k: v for k, v in os.environ.items() if k in ("PATH", "LANG", "LC_ALL", "SYSTEMROOT")}
            env["TMPDIR"] = str(temporary)
            try:
                code, output, error = await run_bounded_process(sys.executable, "-I", str(worker.resolve()), str(source.resolve()),
                    payload=payload, cwd=str(script_dir), env=env, timeout=10)
            except asyncio.TimeoutError: raise HTTPException(408, "Python 脚本执行超过 10 秒")
            except ProcessOutputLimit: raise HTTPException(413, "脚本输出超过大小限制（JSON 8 MB / 进程错误 64 KB）")
        if code: raise HTTPException(422, error.decode(errors="replace")[-3000:] or "Python 进程退出或超过资源限制")
        try: result = json.loads(output)
        except (ValueError, UnicodeError): raise HTTPException(422, "脚本未返回有效 JSON")
        if not isinstance(result, dict): raise HTTPException(422, "脚本未返回结果对象")
        if "error" in result: raise HTTPException(422, result["error"])
        if "value" not in result: raise HTTPException(422, "脚本结果缺少 value")
        # Save each run's bounded console output alongside its source.
        log_path = script_dir / (digest + ".log")
        if not log_path.is_symlink(): log_path.write_text(str(result.get("log", ""))[-10000:], encoding="utf-8")
        return result
    return router
