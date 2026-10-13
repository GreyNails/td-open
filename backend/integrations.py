"""Provider adapters and MCP clients. Credentials never leave server-side storage.

No adapter executes generated code. Chat produces graph commands for review; the
caller chooses whether to apply them through the graph API.
"""
from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import json
import os
import re
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urljoin, urlsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.catalog import NODE_TYPES
from backend.models import Project

ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = ROOT / "data" / "config"
MAX_GENERATED_ASSET_BYTES = 100 * 1024 * 1024
router = APIRouter(prefix="/api", tags=["AI and MCP"])
Capability = Literal["text", "image", "music", "3d"]
SECRET_FIELDS = {"api_key", "apikey", "token", "access_token", "authorization", "password", "secret"}
SAFE_ACTIONS = {"add_node", "set_param", "remove_node", "connect", "disconnect", "rename_project"}


def validate_endpoint(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("地址必须是 http:// 或 https:// URL")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("地址不能包含用户名、密码、查询参数或片段；请使用 API Key / Token 字段")
    return value.rstrip("/")


def redact(value: Any, secrets: tuple[str, ...] = ()) -> Any:
    if isinstance(value, dict):
        return {key: "[redacted]" if key.lower() in SECRET_FIELDS else redact(item, secrets) for key, item in value.items()}
    if isinstance(value, list):
        return [redact(item, secrets) for item in value]
    if isinstance(value, str):
        for secret in secrets:
            if secret:
                value = value.replace(secret, "[redacted]")
    return value


class ProviderConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(default_factory=lambda: uuid.uuid4().hex, pattern=r"^[A-Za-z0-9_-]{1,80}$")
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["openai", "http"] = "openai"
    base_url: str
    api_key: str | None = Field(default=None, max_length=8192, repr=False)
    model: str = Field(default="", max_length=200)
    capability: Capability = "text"
    path: str | None = Field(default=None, max_length=500)
    body_template: dict[str, Any] | None = None

    _validate_url = field_validator("base_url")(validate_endpoint)

    @field_validator("path")
    @classmethod
    def safe_path(cls, value: str | None) -> str | None:
        if value and (not value.startswith("/") or value.startswith("//") or "?" in value or "#" in value or ".." in value):
            raise ValueError("path 应为相对接口路径，例如 /generate")
        return value

    @field_validator("body_template")
    @classmethod
    def no_template_credentials(cls, value: Any) -> Any:
        def check(item: Any) -> None:
            if isinstance(item, dict):
                if any(str(key).lower() in SECRET_FIELDS for key in item):
                    raise ValueError("密钥请填写在 API Key 字段，不要放入请求模板")
                for child in item.values():
                    check(child)
            elif isinstance(item, list):
                for child in item:
                    check(child)
        check(value)
        return value


class MCPConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(default_factory=lambda: uuid.uuid4().hex, pattern=r"^[A-Za-z0-9_-]{1,80}$")
    name: str = Field(min_length=1, max_length=120)
    url: str
    token: str | None = Field(default=None, max_length=8192, repr=False)
    allowed_tools: list[str] | None = None

    _validate_url = field_validator("url")(validate_endpoint)


class ConfigStore:
    """Small atomic private JSON store, suitable for the single-process local app."""

    def __init__(self, directory: Path = CONFIG_DIR):
        self.directory = Path(directory)
        self.lock = threading.RLock()

    def _read(self, category: str) -> list[dict[str, Any]]:
        path = self.directory / f"{category}.json"
        if not path.exists():
            return []
        try:
            os.chmod(path, 0o600)
            result = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(result, list):
                raise ValueError("not a list")
            return result
        except (OSError, ValueError) as exc:
            raise HTTPException(500, "连接配置无法读取，请检查 data/config 文件") from exc

    def list(self, category: str, masked: bool = True) -> list[dict[str, Any]]:
        with self.lock:
            rows = self._read(category)
            return [self.mask(row) for row in rows] if masked else rows

    @staticmethod
    def mask(row: dict[str, Any]) -> dict[str, Any]:
        secrets = tuple(row.get(key) or "" for key in ("api_key", "token"))
        result = redact({key: value for key, value in row.items() if key not in {"api_key", "token"}}, secrets)
        if "api_key" in row:
            result["has_api_key"] = bool(row.get("api_key"))
        if "token" in row:
            result["has_token"] = bool(row.get("token"))
        return result

    def get(self, category: str, item_id: str) -> dict[str, Any]:
        for row in self.list(category, masked=False):
            if row["id"] == item_id:
                return row
        raise HTTPException(404, "未找到连接配置，请先在连接中心添加服务")

    def save(self, category: str, item: BaseModel) -> dict[str, Any]:
        with self.lock:
            rows = self._read(category)
            old = next((row for row in rows if row["id"] == item.id), {})
            new = item.model_dump()
            # Omitting a credential preserves it; an explicit empty string clears it.
            for field in ("api_key", "token"):
                if field in new and new[field] is None:
                    new[field] = old.get(field)
            rows = [row for row in rows if row["id"] != item.id] + [new]
            self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
            os.chmod(self.directory, 0o700)
            handle, temporary = tempfile.mkstemp(prefix=f".{category}-", dir=self.directory)
            try:
                with os.fdopen(handle, "w", encoding="utf-8") as stream:
                    os.chmod(temporary, 0o600)
                    json.dump(rows, stream, ensure_ascii=False, indent=2)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, self.directory / f"{category}.json")
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
            return self.mask(new)


default_store = ConfigStore()


def get_store(request: Request) -> ConfigStore:
    return getattr(request.app.state, "integration_store", default_store)


def get_assets_dir(request: Request) -> Path:
    store = getattr(request.app.state, "store", None)
    return store.assets_dir if store else getattr(request.app.state, "assets_dir", ROOT / "data" / "assets")


class GenerateRequest(BaseModel):
    provider_id: str
    capability: Capability
    prompt: str = Field(min_length=1, max_length=100000)
    model: str | None = None
    parameters: dict[str, Any] = Field(default_factory=dict)


def render_template(value: Any, context: dict[str, Any]) -> Any:
    """Substitution only: no eval, executable expressions or environment access."""
    if isinstance(value, dict):
        return {key: render_template(item, context) for key, item in value.items()}
    if isinstance(value, list):
        return [render_template(item, context) for item in value]
    if isinstance(value, str):
        for key, replacement in context.items():
            placeholder = "{{" + key + "}}"
            if value == placeholder:
                return replacement
            value = value.replace(placeholder, str(replacement) if not isinstance(replacement, (dict, list)) else json.dumps(replacement, ensure_ascii=False))
    return value


async def post_json(url: str, body: dict[str, Any], api_key: str | None) -> Any:
    headers = {"Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(180, connect=15), follow_redirects=False) as client:
            response = await client.post(url, json=body, headers=headers)
        response.raise_for_status()
        return response.json()
    except httpx.HTTPStatusError as exc:
        # Remote error bodies may echo Authorization headers. Never return them.
        raise HTTPException(502, f"AI 服务返回 HTTP {exc.response.status_code}，请检查地址、模型、额度与密钥") from None
    except httpx.TimeoutException:
        raise HTTPException(504, "AI 服务请求超时，请重试或使用异步任务接口") from None
    except httpx.RequestError:
        raise HTTPException(502, "无法连接 AI 服务，请检查服务地址与网络") from None
    except ValueError:
        raise HTTPException(502, "AI 服务未返回有效 JSON；此适配器需要 JSON 响应") from None


def text_from_response(data: Any, depth: int = 0) -> str | None:
    if not isinstance(data, dict) or depth > 12:
        return None
    choices = data.get("choices")
    if isinstance(choices, list) and choices and isinstance(choices[0], dict):
        message = choices[0].get("message")
        content = message.get("content") if isinstance(message, dict) else choices[0].get("text")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            texts = [item["text"] for item in content if isinstance(item, dict) and isinstance(item.get("text"), str)]
            return "\n".join(texts) if texts else None
    for key in ("text", "output_text", "reply", "content"):
        if isinstance(data.get(key), str):
            return data[key]
    for key in ("data", "output", "result", "response", "content"):
        nested = data.get(key)
        if isinstance(nested, str):
            return nested
        if isinstance(nested, dict):
            text = text_from_response(nested, depth + 1)
            if text is not None:
                return text
        if isinstance(nested, list):
            texts = [text for item in nested[:100] if (text := text_from_response(item, depth + 1)) is not None]
            if texts:
                return "\n".join(texts)
    return None


def media_urls(data: Any, capability: Capability, base_url: str, local_urls: set[str] | None = None) -> list[str]:
    """Recognize common JSON wrappers without confusing 3D thumbnails with assets."""
    keys = {
        "image": ("image_url", "imageUrl", "images", "image"),
        "music": ("audio_url", "audioUrl", "music_url", "musicUrl", "audios", "audio", "music", "tracks"),
        "3d": ("model_urls", "model_url", "modelUrl", "glb", "gltf", "fbx", "obj", "models", "model"),
    }.get(capability, ())
    containers = (*keys, "url", "data", "output", "outputs", "result", "results", "response", "artifacts")
    urls: list[str] = []

    def walk(value: Any, depth: int = 0) -> None:
        if depth > 12 or len(urls) >= 50:
            return
        if isinstance(value, str):
            if local_urls and value in local_urls:
                if value not in urls:
                    urls.append(value)
                return
            if value.startswith("/") and not value.startswith("//"):
                value = urljoin(base_url + "/", value)
            try:
                parsed = urlsplit(value)
            except ValueError:
                return
            if parsed.scheme in {"http", "https"} and parsed.hostname and not parsed.username and not parsed.password:
                if value not in urls:
                    urls.append(value)
            elif re.match(r"^data:(?:image/(?:png|jpeg|webp|gif)|audio/[a-z0-9.+-]+|model/[a-z0-9.+-]+);base64,", value):
                if value not in urls:
                    urls.append(value)
        elif isinstance(value, list):
            for item in value[:100]:
                walk(item, depth + 1)
        elif isinstance(value, dict):
            for key in containers:
                if key in value:
                    walk(value[key], depth + 1)

    walk(data)
    return urls


def persist_returned_media(data: Any, capability: Capability, parameters: dict[str, Any], assets_dir: Path) -> tuple[Any, set[str]]:
    """Replace generated base64 with local assets and compact response metadata.

    Only returned bytes are persisted: remote HTTP URLs are never fetched. File
    names are random and extensions come from a MIME allowlist plus magic bytes.
    """
    formats = {"png": "image/png", "jpeg": "image/jpeg", "jpg": "image/jpeg", "webp": "image/webp", "gif": "image/gif", "wav": "audio/wav", "mp3": "audio/mpeg", "ogg": "audio/ogg", "flac": "audio/flac", "glb": "model/gltf-binary"}
    default_format = {"image": "png", "music": "mp3", "3d": "glb"}.get(capability, "png")
    default_mime = formats.get(str(parameters.get("output_format", default_format)), formats[default_format])
    suffixes = {"image/png": ".png", "image/jpeg": ".jpeg", "image/webp": ".webp", "image/gif": ".gif", "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/mpeg": ".mp3", "audio/mp3": ".mp3", "audio/ogg": ".ogg", "audio/flac": ".flac", "model/gltf-binary": ".glb"}
    written: list[Path] = []
    cached: dict[str, str] = {}
    total_bytes = 0

    def save(encoded: str, mime: str) -> str:
        nonlocal total_bytes
        suffix = suffixes.get(mime.lower())
        if suffix is None:
            raise HTTPException(502, "生成服务返回了不支持的内嵌媒体类型")
        if len(encoded) > ((MAX_GENERATED_ASSET_BYTES + 2) // 3) * 4 + 1024:
            raise HTTPException(413, "生成资源不能超过 100 MB")
        try:
            content = base64.b64decode(re.sub(r"\s+", "", encoded), validate=True)
        except (binascii.Error, ValueError):
            raise HTTPException(502, "生成服务返回的 base64 媒体数据无效") from None
        if not content:
            raise HTTPException(502, "生成服务返回了空媒体数据")
        if len(content) > MAX_GENERATED_ASSET_BYTES:
            raise HTTPException(413, "生成资源不能超过 100 MB")
        valid = {
            ".png": content.startswith(b"\x89PNG\r\n\x1a\n"),
            ".jpeg": content.startswith(b"\xff\xd8\xff"),
            ".webp": content.startswith(b"RIFF") and content[8:12] == b"WEBP",
            ".gif": content.startswith((b"GIF87a", b"GIF89a")),
            ".wav": content.startswith(b"RIFF") and content[8:12] == b"WAVE",
            ".mp3": content.startswith(b"ID3") or (len(content) >= 2 and content[0] == 0xFF and content[1] & 0xE0 == 0xE0),
            ".ogg": content.startswith(b"OggS"),
            ".flac": content.startswith(b"fLaC"),
            ".glb": len(content) >= 12 and content[:4] == b"glTF" and int.from_bytes(content[4:8], "little") == 2 and int.from_bytes(content[8:12], "little") == len(content),
        }[suffix]
        if not valid:
            raise HTTPException(502, "生成媒体的文件头与声明类型不匹配")
        digest = hashlib.sha256(content).hexdigest() + suffix
        if digest in cached:
            return cached[digest]
        total_bytes += len(content)
        if total_bytes > MAX_GENERATED_ASSET_BYTES:
            raise HTTPException(413, "本次生成资源总量不能超过 100 MB")
        assets_dir.mkdir(parents=True, exist_ok=True)
        filename = uuid.uuid4().hex + suffix
        path = assets_dir / filename
        with path.open("xb") as stream:
            written.append(path)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        cached[digest] = f"/api/assets/{filename}"
        return cached[digest]

    def walk(value: Any, depth: int = 0) -> Any:
        if depth > 24:
            raise HTTPException(502, "生成服务响应嵌套过深")
        if isinstance(value, str) and value.startswith("data:"):
            match = re.fullmatch(r"data:([^;,]+);base64,(.*)", value, re.DOTALL)
            if not match:
                raise HTTPException(502, "生成服务返回了不支持的 data URL")
            return save(match.group(2), match.group(1))
        if isinstance(value, dict):
            result = {}
            inline_url = None
            for key, item in value.items():
                if key in {"b64_json", "image_base64", "audio_base64", "model_base64"} and isinstance(item, str):
                    mime = value.get("mime_type", value.get("mimeType", default_mime))
                    inline_url = save(item, str(mime))
                else:
                    result[key] = walk(item, depth + 1)
            if inline_url:
                result["url"] = inline_url
            return result
        if isinstance(value, list):
            return [walk(item, depth + 1) for item in value]
        return value

    try:
        normalized = walk(data)
        return normalized, set(cached.values())
    except BaseException:
        for path in written:
            path.unlink(missing_ok=True)
        raise


def response_state(data: Any, depth: int = 0) -> tuple[str | None, str | None]:
    """Return an explicit remote state/job ID, never infer success from HTTP 200."""
    if not isinstance(data, dict) or depth > 12:
        return None, None
    status = data.get("status", data.get("state"))
    status = status.lower() if isinstance(status, str) else None
    if data.get("error") or status in {"error", "failed", "failure", "cancelled", "canceled", "rejected"}:
        raise HTTPException(502, "AI 服务报告生成失败，请在供应商控制台检查请求状态")
    task_id = next((str(data[key]) for key in ("task_id", "job_id", "request_id", "id") if isinstance(data.get(key), (str, int))), None)
    for key in ("data", "result", "response"):
        child_status, child_id = response_state(data.get(key), depth + 1)
        status = status or child_status
        task_id = task_id or child_id
    return status, task_id


async def generate_with_provider(provider: dict[str, Any], request: GenerateRequest, assets_dir: Path | None = None) -> dict[str, Any]:
    if provider["capability"] != request.capability:
        raise HTTPException(422, "该连接的能力与生成类型不匹配，请选择对应的连接")
    model = request.model or provider.get("model", "")
    if provider["kind"] == "openai":
        if request.capability not in {"text", "image"}:
            raise HTTPException(422, "音乐和 3D 生成请使用通用 HTTP 适配器配置供应商接口")
        if not model:
            raise HTTPException(422, "请在连接设置或请求中填写模型名称")
        body = dict(request.parameters)
        body["model"] = model
        if request.capability == "text":
            path = "/chat/completions"
            body["messages"] = [{"role": "user", "content": request.prompt}]
            body["stream"] = False
        else:
            path = "/images/generations"
            body["prompt"] = request.prompt
    else:
        path = provider.get("path") or "/generate"
        context = {"prompt": request.prompt, "model": model, "parameters": request.parameters, "capability": request.capability}
        template = provider.get("body_template")
        body = render_template(template, context) if template is not None else {**request.parameters, "prompt": request.prompt, "model": model}
    data = await post_json(provider["base_url"].rstrip("/") + path, body, provider.get("api_key"))
    remote_status, task_id = response_state(data)
    local_urls: set[str] = set()
    if request.capability != "text":
        try:
            data, local_urls = persist_returned_media(data, request.capability, request.parameters, assets_dir or ROOT / "data" / "assets")
        except OSError:
            raise HTTPException(500, "生成结果无法保存到本地资源目录，请检查磁盘空间和目录权限") from None
    data = redact(data, (provider.get("api_key") or "",))
    result: dict[str, Any] = {"provider_id": provider["id"], "capability": request.capability, "data": data}
    text = text_from_response(data)
    if text is not None:
        result["text"] = text
    urls = media_urls(data, request.capability, provider["base_url"], local_urls)
    if urls:
        result["url"] = urls[0]
        if len(urls) > 1:
            result["urls"] = urls
    if request.capability == "text" and "text" not in result:
        raise HTTPException(502, "服务响应中没有可识别的文本字段")
    if request.capability != "text" and "url" not in result:
        if provider["kind"] == "openai":
            raise HTTPException(502, "图片接口未返回可用的图片地址或 base64 数据")
        if task_id or remote_status in {"pending", "queued", "processing", "running", "submitted", "starting"}:
            result["status"] = "submitted"
            if task_id:
                result["task_id"] = redact(task_id, (provider.get("api_key") or "",))
            result["message"] = "服务返回了异步任务，尚未取得媒体地址；请在供应商侧查询任务结果。"
        else:
            result["status"] = "unrecognized"
            result["message"] = "服务已返回 JSON，但未识别到媒体地址或任务编号；请检查供应商响应结构。"
    return result


@router.get("/providers")
def list_providers(store: ConfigStore = Depends(get_store)) -> list[dict[str, Any]]:
    return store.list("providers")


@router.post("/providers")
def save_provider(config: ProviderConfig, store: ConfigStore = Depends(get_store)) -> dict[str, Any]:
    return store.save("providers", config)


@router.post("/ai/generate")
async def generate(request: GenerateRequest, store: ConfigStore = Depends(get_store), assets_dir: Path = Depends(get_assets_dir)) -> dict[str, Any]:
    return await generate_with_provider(store.get("providers", request.provider_id), request, assets_dir)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=12000)
    project: dict[str, Any] = Field(default_factory=dict)
    provider_id: str | None = None
    selected_node: str | None = None

    @field_validator("project")
    @classmethod
    def project_shape(cls, value: dict[str, Any]) -> dict[str, Any]:
        # Empty projects are useful for local help; supplied projects must conform
        # to the same schema as save/apply, rather than producing parser crashes.
        if not value:
            return value
        return Project.model_validate(value).model_dump(mode="json")


def local_chat(request: ChatRequest) -> dict[str, Any]:
    message = request.message.lower().strip()
    nodes = request.project.get("nodes", [])
    selected = next((node for node in nodes if node.get("id") == request.selected_node), None)
    commands: list[dict[str, Any]] = []
    reply = "本地指令模式：可用节点中文名称、英文名称或类型 ID 添加节点，例如「添加随机信号」「add JSON Select」；也支持「改成蓝色」「速度调为 0.5」「删除所选节点」。自由对话请在连接中心配置语言模型。"
    additions = [(r"噪声|(?<![a-z0-9_])noise(?![a-z0-9_])", "noise", "噪声"), (r"粒子|(?<![a-z0-9_])particles?(?![a-z0-9_])", "particles", "粒子"), (r"渐变|(?<![a-z0-9_])(?:ramp|gradient)(?![a-z0-9_])", "ramp", "渐变"), (r"模糊|(?<![a-z0-9_])blur(?![a-z0-9_])", "blur", "模糊"), (r"几何|立方体|(?<![a-z0-9_])(?:geometry|cube)(?![a-z0-9_])", "geometry", "几何体"), (r"文字|文本|(?<![a-z0-9_])text(?![a-z0-9_])", "text", "文字"), (r"振荡|(?<![a-z0-9_])lfo(?![a-z0-9_])", "lfo", "振荡器")]
    if re.search(r"删除|移除|delete|remove", message):
        if selected:
            commands = [{"op": "remove_node", "id": selected["id"]}]
            reply = "已准备删除所选节点及其连线。应用后可撤销。"
        else:
            reply = "请先选择要删除的节点。"
    elif re.search(r"添加|创建|新建|add|create", message):
        # Prefer the most specific registered name: "Noise CHOP" must not be
        # swallowed by "Noise", and IDs must not match inside another ID.
        candidates = []
        target_text = re.sub(r"^.*?(?:添加|创建|新建|(?<![a-z0-9_])add(?![a-z0-9_])|(?<![a-z0-9_])create(?![a-z0-9_]))\s*", "", message, count=1)
        for node_type, spec in NODE_TYPES.items():
            for name in (node_type, spec["label"], spec.get("english", "")):
                name = name.lower().strip()
                if not name:
                    continue
                pattern = re.escape(name)
                if name.isascii():
                    pattern = r"(?<![a-z0-9_])" + pattern + r"(?![a-z0-9_])"
                if re.search(pattern, target_text):
                    candidates.append((len(name), node_type, spec["label"]))
        if candidates:
            _, node_type, label = max(candidates, key=lambda item: item[0])
        else:
            match = next(((node_type, label) for pattern, node_type, label in additions if re.search(pattern, target_text)), None)
            node_type, label = match if match else (None, None)
        if node_type:
            commands = [{"op": "add_node", "id": f"{node_type}_{uuid.uuid4().hex[:8]}", "type": node_type, "label": label, "position": {"x": 120 + (len(nodes) % 4) * 240, "y": 120 + (len(nodes) // 4) * 150}}]
            reply = f"已准备添加{label}节点。可在应用后连接到兼容端口。"
    elif re.search(r"速度|speed", message):
        match = re.search(r"(?:速度|speed)[^\d+.-]*([-+]?(?:\d*\.\d+|\d+))", message)
        supported = {"noise", "particles", "lfo", "render"}
        target = selected if selected and selected.get("type") in supported else next((node for node in nodes if node.get("type") in supported), None)
        if match and target and target.get("type") in {"noise", "particles", "lfo", "render"}:
            key = "frequency" if target.get("type") == "lfo" else "speed"
            param = next(item for item in NODE_TYPES[target["type"]]["params"] if item["key"] == key)
            speed = max(param.get("min", -20.0), min(param.get("max", 20.0), float(match.group(1))))
            commands = [{"op": "set_param", "id": target["id"], "key": "frequency" if target.get("type") == "lfo" else "speed", "value": speed}]
            reply = f"已准备将 {target.get('data', {}).get('label', target['id'])} 的速度设为 {speed:g}。"
        else:
            reply = "请选择噪声或粒子节点，再输入「速度调为 0.5」。"
    else:
        colors = [(r"蓝|blue", "#527dff"), (r"紫|purple", "#a881ff"), (r"红|red", "#ff526e"), (r"绿|green", "#42d6a4"), (r"橙|orange", "#ff9c58"), (r"粉|pink", "#f472b6"), (r"白|white", "#ffffff")]
        for pattern, color in colors:
            if re.search(pattern, message):
                supported = {"particles", "ramp", "shape", "render", "color"}
                target = selected if selected and selected.get("type") in supported else next((node for node in nodes if node.get("type") in supported), None)
                if target and target.get("type") == "color":
                    hues = {"#527dff": 80, "#a881ff": 125, "#ff526e": 220, "#42d6a4": 0, "#ff9c58": 270, "#f472b6": 155, "#ffffff": 0}
                    commands = [{"op": "set_param", "id": target["id"], "key": "hue", "value": hues[color]}]
                    reply = "已准备调整色相，实际颜色取决于输入画面。"
                elif target and target.get("type") in supported:
                    key = "color2" if target.get("type") == "ramp" else "color"
                    commands = [{"op": "set_param", "id": target["id"], "key": key, "value": color}]
                    reply = "已准备调整节点颜色。"
                else:
                    reply = "请选择渐变、粒子、形状或 3D 渲染节点后调整颜色。噪声节点没有颜色参数。"
                break
    return {"reply": f"{reply}（本地指令解析）", "commands": commands, "mode": "local"}


def validate_chat_commands(commands: Any, project: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(commands, list) or len(commands) > 40:
        raise HTTPException(502, "AI 返回的命令格式不正确或数量过多")
    node_types = {node.get("id"): node.get("type") for node in project.get("nodes", [])}
    for command in commands:
        if not isinstance(command, dict) or not isinstance(command.get("op"), str) or command["op"] not in SAFE_ACTIONS:
            raise HTTPException(502, "AI 返回了不支持的操作；未执行任何更改")
        if "id" in command and not isinstance(command["id"], str):
            raise HTTPException(502, "AI 返回的节点或连线 ID 格式不正确")
        if command["op"] == "add_node" and (not isinstance(command.get("type"), str) or command["type"] not in NODE_TYPES):
            raise HTTPException(502, "AI 返回了未知节点类型；未执行任何更改")
        if command["op"] == "add_node":
            node_types[command.get("id")] = command["type"]
            params = command.get("params", {})
            if not isinstance(params, dict) or any(key not in NODE_TYPES[command["type"]]["defaults"] for key in params):
                raise HTTPException(502, "AI 返回了该节点不支持的参数")
        elif command["op"] == "set_param":
            spec = NODE_TYPES.get(node_types.get(command.get("id")), {})
            if not isinstance(command.get("key"), str) or command["key"] not in spec.get("defaults", {}):
                raise HTTPException(502, "AI 返回了该节点不支持的参数")
        if len(json.dumps(command, ensure_ascii=False)) > 16000:
            raise HTTPException(502, "AI 返回的节点参数过大")
    if commands:
        from .graph import apply_commands
        try:
            apply_commands(Project.model_validate(project), commands)
        except (ValueError, KeyError, TypeError) as exc:
            raise HTTPException(502, "AI 的图编辑未通过校验；请调整描述后重试") from exc
    return commands


@router.post("/chat")
async def chat(request: ChatRequest, store: ConfigStore = Depends(get_store)) -> dict[str, Any]:
    if not request.provider_id:
        return local_chat(request)
    provider = store.get("providers", request.provider_id)
    if provider["capability"] != "text":
        raise HTTPException(422, "对话操作需要选择语言模型连接")
    current_types = {node.get("type") for node in request.project.get("nodes", [])}
    terms = set(re.findall(r"[a-z0-9_]+|[\u4e00-\u9fff]{2,}", request.message.lower()))
    def score(item):
        key, spec = item
        words = f"{key} {spec.get('label','')} {spec.get('english','')}".lower()
        return (100 if key in current_types else 0) + sum(len(term) for term in terms if term in words)
    relevant = sorted(NODE_TYPES.items(), key=score, reverse=True)[:32]
    schemas = [{"type": key, "parameters": [{k:v for k,v in param.items() if k in ("key","type","min","max","options")} for param in spec["params"]], "inputs":spec["inputs"],"outputs":spec["outputs"]} for key,spec in relevant]
    instructions = {
        "role": "TD Open beginner-friendly node graph assistant. Answer in the user's language.",
        "output": {"reply": "brief explanation, do not claim changes were applied", "commands": []},
        "rules": ["Return only a JSON object. No markdown.", "Commands are proposals for user review, never executable code.", "Use only documented node types and operations. Do not invoke MCP, external tools, network or code.", "Use current node IDs. New IDs must be unique. Connect nodes only if useful. If unsure, explain and return no commands."],
        "node_types": schemas,
        "node_index": [[key,spec.get("family"),spec.get("label")] for key,spec in NODE_TYPES.items()],
        "command_examples": [
            {"op": "add_node", "type": "noise", "id": "noise_new", "label": "Noise", "params": {}, "position": {"x": 200, "y": 200}},
            {"op": "set_param", "id": "node_id", "key": "speed", "value": 0.5},
            {"op": "remove_node", "id": "node_id"},
            {"op": "connect", "source": "node_a", "target": "node_b"},
            {"op": "disconnect", "id": "edge_id"},
            {"op": "rename_project", "name": "My project"},
        ],
        "project": request.project,
        "selected_node": request.selected_node,
        "user_message": request.message,
    }
    generated = await generate_with_provider(provider, GenerateRequest(provider_id=provider["id"], capability="text", prompt=json.dumps(instructions, ensure_ascii=False)))
    text = generated.get("text", "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text).strip()
    try:
        parsed = json.loads(text)
        if not isinstance(parsed, dict) or not isinstance(parsed.get("reply"), str):
            raise ValueError("invalid response")
    except ValueError:
        raise HTTPException(502, "模型未返回可用的图编辑 JSON，请重试或切换模型") from None
    return {"reply": parsed["reply"], "commands": validate_chat_commands(parsed.get("commands", []), request.project), "mode": "ai"}


class MCPCallRequest(BaseModel):
    server_id: str
    name: str = Field(min_length=1, max_length=256)
    arguments: dict[str, Any] = Field(default_factory=dict)


async def mcp_request(config: dict[str, Any], name: str | None = None, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        from mcp import ClientSession
        from mcp.client.streamable_http import streamable_http_client
    except ImportError:
        raise HTTPException(503, "尚未安装 MCP SDK，请按 pyproject.toml 安装项目依赖 mcp==1.30.0") from None
    if name and config.get("allowed_tools") is not None and name not in config["allowed_tools"]:
        raise HTTPException(403, "此工具不在该连接的允许列表中")
    headers = {"Authorization": f"Bearer {config['token']}"} if config.get("token") else {}

    async def perform() -> dict[str, Any]:
        result_data: dict[str, Any] | None = None
        missing_tool = False
        async with httpx.AsyncClient(headers=headers, timeout=httpx.Timeout(90, connect=15), follow_redirects=False) as http_client, streamable_http_client(config["url"], http_client=http_client) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                listed = await session.list_tools()
                tools = [tool.model_dump(mode="json", by_alias=True) for tool in listed.tools]
                cursor = getattr(listed, "nextCursor", None)
                pages = 1
                while cursor:
                    if pages >= 50:
                        raise HTTPException(502, "MCP 工具列表分页过多")
                    listed = await session.list_tools(cursor=cursor)
                    tools.extend(tool.model_dump(mode="json", by_alias=True) for tool in listed.tools)
                    cursor = getattr(listed, "nextCursor", None)
                    pages += 1
                allowed = config.get("allowed_tools")
                if allowed is not None:
                    tools = [tool for tool in tools if tool["name"] in allowed]
                if name is None:
                    return {"tools": tools}
                if name not in {tool["name"] for tool in tools}:
                    missing_tool = True
                else:
                    result = await session.call_tool(name, arguments=arguments or {})
                    result_data = result.model_dump(mode="json", by_alias=True)
        # Raise after transport cleanup: anyio task groups otherwise wrap this
        # expected HTTP error in an ExceptionGroup and turn it into a generic 502.
        if missing_tool:
            raise HTTPException(404, "MCP 服务未提供该工具")
        return result_data or {}
    try:
        result = await asyncio.wait_for(perform(), timeout=100)
        return redact(result, (config.get("token") or "",))
    except HTTPException:
        raise
    except asyncio.TimeoutError:
        raise HTTPException(504, "MCP 服务请求超时") from None
    except Exception:
        # ExceptionGroup and provider errors can embed URLs/tokens; keep them private.
        raise HTTPException(502, "MCP 连接或工具调用失败，请检查 URL、Token、工具参数以及 Streamable HTTP 支持") from None


@router.get("/mcp/servers")
def list_mcp_servers(store: ConfigStore = Depends(get_store)) -> list[dict[str, Any]]:
    return store.list("mcp_servers")


@router.post("/mcp/servers")
def save_mcp_server(config: MCPConfig, store: ConfigStore = Depends(get_store)) -> dict[str, Any]:
    return store.save("mcp_servers", config)


@router.post("/mcp/servers/{server_id}/tools")
async def list_mcp_tools(server_id: str, store: ConfigStore = Depends(get_store)) -> dict[str, Any]:
    return await mcp_request(store.get("mcp_servers", server_id))


@router.post("/mcp/call")
async def call_mcp_tool(request: MCPCallRequest, store: ConfigStore = Depends(get_store)) -> dict[str, Any]:
    return await mcp_request(store.get("mcp_servers", request.server_id), request.name, request.arguments)
