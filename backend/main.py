"""HTTP entry point. Run from the repository root: python -m backend.main."""

import mimetypes
from contextlib import asynccontextmanager
import os
from pathlib import Path
import re
import tempfile
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse

from backend.catalog import NODE_TYPES
from backend.graph import GraphError, apply_commands, normalize_project, require_valid, validate_graph
from backend.models import CommandRequest, EvaluateRequest, Project
from backend.runtime import evaluate
from backend.storage import ROOT, ProjectStore
from backend.paths import RESOURCE_ROOT

MAX_UPLOAD_BYTES = 100 * 1024 * 1024
ALLOWED_ASSETS = {
    ".png": "image", ".jpg": "image", ".jpeg": "image", ".webp": "image", ".gif": "image", ".avif": "image",
    ".mp4": "video", ".webm": "video", ".mov": "video",
    ".mp3": "audio", ".wav": "audio", ".ogg": "audio", ".m4a": "audio", ".flac": "audio",
    ".glb": "3d", ".gltf": "3d", ".obj": "3d", ".stl": "3d", ".fbx": "3d",
}
ALLOWED_EXPORTS = {".wav": "audio/wav",".png": "image/png", ".webm": "video/webm", ".json": "application/json"}


def create_app(data_dir: Path | None = None, include_integrations: bool = True) -> FastAPI:
    # Multipart uploads spill beyond 1 MB. Keep those temporary bytes inside the
    # repository even when launched directly with uvicorn instead of start.sh.
    temporary_dir = ROOT / ".cache" / "tmp"
    temporary_dir.mkdir(parents=True, exist_ok=True)
    tempfile.tempdir = str(temporary_dir)
    os.environ["TMPDIR"] = str(temporary_dir)
    @asynccontextmanager
    async def lifespan(application):
        try:
            yield
        finally:
            application.state.local_ai.shutdown()
    app = FastAPI(title="TD Open API", version="0.5.1", description="Local-first visual programming workspace", lifespan=lifespan)
    if os.environ.get("TD_DESKTOP_TOKEN"):
        from backend.desktop_access import DesktopAccess
        app.add_middleware(DesktopAccess, token=os.environ["TD_DESKTOP_TOKEN"])
    store = ProjectStore(data_dir)
    app.state.store = store
    from backend.local_ai.manager import LocalAIManager
    from backend.local_ai.router import create_local_ai_router
    local_ai_root = os.environ.get('TD_LOCAL_AI_DIR')
    local_ai = LocalAIManager(store.data_dir, (ROOT / local_ai_root).resolve() if local_ai_root else None)
    app.state.local_ai = local_ai
    app.include_router(create_local_ai_router(local_ai))
    from backend.io_runtime import create_io_router
    app.include_router(create_io_router(store.data_dir))
    from backend.script_runtime import create_script_router
    app.include_router(create_script_router(store.data_dir))
    from backend.web_runtime import create_web_router
    app.include_router(create_web_router(store.data_dir))

    @app.middleware("http")
    async def local_origin_guard(request: Request, call_next):
        # Browsers must use the same origin: a random website cannot spend local API keys.
        origin = request.headers.get("origin")
        if origin and request.method not in ("GET", "HEAD", "OPTIONS"):
            from urllib.parse import urlsplit
            source = urlsplit(origin)
            if source.netloc != request.headers.get("host"):
                return JSONResponse(status_code=403, content={"detail": "仅允许同源浏览器请求"})
        length = request.headers.get("content-length")
        try:
            limit = MAX_UPLOAD_BYTES + 1024 * 1024 if request.url.path in ("/api/upload", "/api/artifacts") else 8 * 1024 * 1024
            if length and int(length) > limit:
                return JSONResponse(status_code=413, content={"detail": "请求体过大"})
        except ValueError:
            return JSONResponse(status_code=400, content={"detail": "无效的 Content-Length"})
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.exception_handler(GraphError)
    async def graph_error(request: Request, exc: GraphError):
        return JSONResponse(status_code=422, content={"detail": str(exc), "errors": exc.errors})

    @app.exception_handler(RequestValidationError)
    async def request_error(request: Request, exc: RequestValidationError):
        # Do not echo rejected request bodies (provider requests may contain keys).
        errors = [{"loc": list(e["loc"]), "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
        return JSONResponse(status_code=422, content={"detail": errors})

    @app.get("/api/health")
    def health():
        return {"status": "ok", "version": "0.5.1", "operators": len(NODE_TYPES), "data_dir": str(store.data_dir)}

    @app.get("/api/catalog")
    def catalog():
        return {"nodes": list(NODE_TYPES.values()), "families": ["COMP", "TOP", "CHOP", "SOP", "MAT", "DAT", "AI", "OUT"]}

    @app.get("/api/projects")
    def list_projects():
        return store.list()

    @app.get("/api/examples")
    def list_examples():
        return store.list_examples()

    @app.get("/api/examples/{example_id}", response_model=Project)
    def get_example(example_id: str):
        try:
            return normalize_project(store.get_example(example_id))
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="案例不存在") from None
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/projects", response_model=Project)
    def save_project(project: Project):
        project = require_valid(project)
        try:
            return store.save(project)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/projects/{project_id}", response_model=Project)
    def get_project(project_id: str):
        try:
            return normalize_project(store.get(project_id))
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="项目不存在") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.delete("/api/projects/{project_id}")
    def delete_project(project_id: str):
        try:
            store.delete(project_id)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="项目不存在") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"deleted": project_id}

    @app.post("/api/validate")
    def validate(project: Project):
        project = normalize_project(project)
        errors = validate_graph(project)
        # Return schema defaults as well: importers must not keep incomplete raw
        # JSON after the server has validated its normalized representation.
        return {"valid": not errors, "errors": errors, "project": project}

    @app.post("/api/commands")
    def commands(request: CommandRequest):
        result = apply_commands(request.project, request.commands)
        return {"project": result, "applied": len(request.commands)}

    @app.post("/api/evaluate")
    def evaluate_project(request: EvaluateRequest):
        return evaluate(request.project, request.time)

    @app.post("/api/upload")
    async def upload(file: UploadFile = File(...)):
        original = Path((file.filename or "asset").replace("\\", "/")).name
        suffix = Path(original).suffix.lower()
        if suffix not in ALLOWED_ASSETS:
            await file.close()
            raise HTTPException(status_code=415, detail="支持常用图片、视频、音频及 GLB / glTF / OBJ / STL 文件")
        filename = f"{uuid4().hex}{suffix}"
        path = store.assets_dir / filename
        size = 0
        try:
            with path.open("xb") as handle:
                while chunk := await file.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_UPLOAD_BYTES:
                        raise HTTPException(status_code=413, detail="资源不能超过 100 MB")
                    handle.write(chunk)
            if size == 0:
                raise HTTPException(status_code=400, detail="资源文件为空")
        except BaseException:
            path.unlink(missing_ok=True)
            raise
        finally:
            await file.close()
        return {"url": f"/api/assets/{filename}", "name": original, "kind": ALLOWED_ASSETS[suffix], "size": size}

    @app.get("/api/assets/{filename}")
    def asset(filename: str):
        if Path(filename).name != filename or "\\" in filename:
            raise HTTPException(status_code=400, detail="无效的资源路径")
        path = store.assets_dir / filename
        if not path.is_file() or path.is_symlink():
            raise HTTPException(status_code=404, detail="资源不存在")
        media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        # Unknown/SVG content is downloaded, never rendered as active same-origin HTML.
        if path.suffix.lower() not in ALLOWED_ASSETS:
            return FileResponse(path, media_type="application/octet-stream", filename=path.name)
        return FileResponse(path, media_type=media_type)

    @app.post("/api/artifacts")
    async def save_artifact(file: UploadFile = File(...)):
        original = Path((file.filename or "export").replace("\\", "/")).name
        suffix = Path(original).suffix.lower()
        if suffix not in ALLOWED_EXPORTS:
            await file.close()
            raise HTTPException(status_code=415, detail="导出文件仅支持 PNG、WebM 和 JSON")
        filename = f"{uuid4().hex}{suffix}"
        path = store.exports_dir / filename
        size = 0
        try:
            with path.open("xb") as handle:
                while chunk := await file.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_UPLOAD_BYTES:
                        raise HTTPException(status_code=413, detail="导出文件不能超过 100 MB")
                    handle.write(chunk)
            if size == 0:
                raise HTTPException(status_code=400, detail="导出文件为空")
        except BaseException:
            path.unlink(missing_ok=True)
            raise
        finally:
            await file.close()
        return {"url": f"/api/exports/{filename}", "name": original, "size": size}

    @app.get("/api/exports/{filename}")
    def exported_artifact(filename: str):
        if not re.fullmatch(r"[a-f0-9]{32}\.(png|webm|wav|json)", filename):
            raise HTTPException(status_code=404, detail="导出文件不存在")
        path = store.exports_dir / filename
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(store.exports_dir.resolve()):
            raise HTTPException(status_code=404, detail="导出文件不存在")
        return FileResponse(path, media_type=ALLOWED_EXPORTS[path.suffix], filename=filename)

    if include_integrations:
        try:
            from backend.integrations import ConfigStore, router
        except ModuleNotFoundError as exc:
            if exc.name != "backend.integrations":
                raise
        else:
            app.state.integration_store = ConfigStore(store.data_dir / "config")
            app.include_router(router)

    @app.get("/api/{path:path}", include_in_schema=False)
    def unknown_api(path: str):
        raise HTTPException(status_code=404, detail="API 不存在")

    frontend = RESOURCE_ROOT / "frontend" / "dist"
    # check_dir=False lets the frontend be built after the Python process starts.
    @app.get("/", include_in_schema=False)
    def index():
        if (frontend / "index.html").is_file():
            return FileResponse(frontend / "index.html")
        return JSONResponse({"message": "前端尚未构建。请运行 scripts/setup.sh。", "docs": "/docs"})

    @app.get("/{path:path}", include_in_schema=False)
    def static_or_index(path: str):
        candidate = (frontend / path).resolve()
        if not candidate.is_relative_to(frontend.resolve()):
            raise HTTPException(status_code=404)
        if candidate.is_file():
            return FileResponse(candidate)
        if (frontend / "index.html").is_file() and "." not in Path(path).name:
            return FileResponse(frontend / "index.html")
        raise HTTPException(status_code=404)

    return app


def configured_data_dir() -> Path | None:
    configured = os.environ.get("TD_DATA_DIR")
    if not configured:
        return None
    directory = (ROOT / configured).resolve()
    if not directory.is_relative_to(ROOT):
        raise ValueError("TD_DATA_DIR 必须位于 td_open 项目目录内，例如 .cache/browser-data")
    return directory


app = create_app(data_dir=configured_data_dir())

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host=os.environ.get("TD_HOST", "127.0.0.1"), port=int(os.environ.get("TD_PORT", "8765")))
