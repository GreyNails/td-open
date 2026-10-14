"""Isolated Chromium snapshots and explicitly supplied browser actions."""
import asyncio
import json
import os
from pathlib import Path
import shutil
from uuid import uuid4
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ConfigDict
from backend.process_runtime import ProcessOutputLimit, run_bounded_process
from backend.storage import ROOT
from backend.paths import RESOURCE_ROOT


class WebAction(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    type: str
    selector: str = Field(default="", max_length=1024)
    value: str = Field(default="", max_length=10000)
    x: float = Field(default=0, ge=-100000, le=100000)
    y: float = Field(default=0, ge=-100000, le=100000)


class WebRenderRequest(BaseModel):
    url: str = Field(default="", max_length=4096)
    html: str = Field(default="", max_length=200000)
    width: int = Field(default=640, ge=16, le=2048)
    height: int = Field(default=360, ge=16, le=2048)
    delay: int = Field(default=100, ge=0, le=3000)
    actions: list[WebAction] = Field(default_factory=list, max_length=32)


def create_web_router(data_dir: Path):
    router = APIRouter(prefix="/api/web-render", tags=["Web Render"])
    slots = asyncio.Semaphore(2)
    exports = data_dir.resolve() / "exports"
    if exports.is_symlink(): raise ValueError("Export directory cannot be a symbolic link")
    exports.mkdir(parents=True, exist_ok=True)
    temporary = ROOT / ".cache" / "tmp"; temporary.mkdir(parents=True, exist_ok=True)

    @router.post("/capture")
    async def capture(request: WebRenderRequest):
        if not request.html and urlsplit(request.url).scheme not in ("http", "https"):
            raise HTTPException(422, "网页地址必须以 http:// 或 https:// 开头")
        if any(action.type not in ("click", "fill", "scroll") for action in request.actions):
            raise HTTPException(422, "网页操作仅支持 click / fill / scroll")
        if any(action.type != "scroll" and not action.selector for action in request.actions):
            raise HTTPException(422, "click / fill 操作需要 selector")
        node = ROOT / ".tools/node-v22.21.1-linux-x64/bin/node"
        executable = os.environ.get("TD_NODE_BINARY") or (str(node) if node.exists() else shutil.which("node"))
        if not executable: raise HTTPException(503, "Web Render 需要 Node.js 和 Playwright Chromium")
        name = uuid4().hex + ".png"; path = exports / name
        payload = request.model_dump(); payload["output"] = str(path)
        env = {key: value for key, value in os.environ.items() if key.upper() in ("PATH", "LANG", "LC_ALL", "SYSTEMROOT", "TD_CHROMIUM", "PLAYWRIGHT_BROWSERS_PATH", "HOME", "TEMP", "TMP")}
        # Chromium's POSIX SingletonSocket has a ~100-byte pathname limit.
        # A relative temp root keeps sockets short even in long/Chinese userData
        # paths, while all files remain in this workspace's private cache.
        env["TMPDIR"] = "."
        if os.name == "nt": env.update(TEMP=str(temporary), TMP=str(temporary))
        try:
            async with slots:
                code, out, error = await run_bounded_process(executable, str(RESOURCE_ROOT / "scripts/web-render.mjs"),
                    payload=json.dumps(payload).encode(), env=env, cwd=str(temporary), timeout=25,
                    stdout_limit=16384, stderr_limit=65536)
            if code: raise HTTPException(422, "Chromium 网页渲染失败：" + error.decode(errors="replace")[-1600:])
            try: metadata = json.loads(out)
            except (ValueError, UnicodeError): raise HTTPException(502, "网页渲染未返回有效信息")
            if not isinstance(metadata, dict) or not path.is_file(): raise HTTPException(502, "网页渲染未产生图片")
            return {**metadata, "image_url": "/api/exports/" + name}
        except asyncio.TimeoutError:
            path.unlink(missing_ok=True); raise HTTPException(408, "网页加载超时")
        except ProcessOutputLimit:
            path.unlink(missing_ok=True); raise HTTPException(413, "网页渲染进程输出超过限制")
        except BaseException:
            path.unlink(missing_ok=True); raise
    return router
