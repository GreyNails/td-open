"""Local API tutorial fixture. Returns procedural test media, never AI output.

Run from the repository root: .venv/bin/python examples/api/mock_provider.py
This program does not call external services or write user configuration.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import math
import struct
import wave
import zlib

from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="TD Open local API tutorial — not an AI model")


def png_fixture() -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    width, height = 96, 64
    pixels = b"".join(b"\x00" + b"".join(bytes((90 + x, 40 + y * 2, 220 - x)) for x in range(width)) for y in range(height))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b"")


def wav_fixture() -> bytes:
    output = io.BytesIO()
    rate = 22050
    with wave.open(output, "wb") as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(rate)
        file.writeframes(b"".join(struct.pack("<h", round(4000 * math.sin(2 * math.pi * 440 * index / rate))) for index in range(rate)))
    return output.getvalue()


def glb_fixture() -> bytes:
    vertices = struct.pack("<9f", -1, -1, 0, 1, -1, 0, 0, 1, 0)
    document = {
        "asset": {"version": "2.0", "generator": "TD Open tutorial fixture, not AI"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "material": 0}]}],
        "materials": [{"doubleSided": True, "pbrMetallicRoughness": {"baseColorFactor": [0.6, 0.3, 0.9, 1], "metallicFactor": 0, "roughnessFactor": 0.8}}],
        "buffers": [{"byteLength": len(vertices)}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(vertices), "target": 34962}],
        "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3", "min": [-1, -1, 0], "max": [1, 1, 0]}],
    }
    encoded = json.dumps(document, separators=(",", ":")).encode()
    encoded += b" " * (-len(encoded) % 4)
    chunks = struct.pack("<II", len(encoded), 0x4E4F534A) + encoded + struct.pack("<II", len(vertices), 0x004E4942) + vertices
    return struct.pack("<4sII", b"glTF", 2, 12 + len(chunks)) + chunks


class Prompt(BaseModel):
    model: str = "demo-fixture"
    prompt: str = Field(min_length=1, max_length=100000)
    options: dict = Field(default_factory=dict)


class Chat(BaseModel):
    model: str
    messages: list[dict] = Field(min_length=1, max_length=10)
    stream: bool = False


@app.get("/health")
def health():
    return {"status": "ok", "demo": True, "notice": "Procedural tutorial fixtures; no AI, no external calls."}


@app.post("/v1/chat/completions")
def chat(body: Chat):
    message = str(body.messages[-1].get("content", ""))[:120]
    text = "本地接入演练成功（非 AI 生成）。收到提示词：" + message
    # The studio assistant expects a JSON proposal. Return an explicit no-op.
    if '"command_examples"' in message or '"command_examples"' in str(body.messages[-1].get("content", "")):
        text = json.dumps({"reply": "演练服务没有语言模型，不会推断图修改；连接格式已验证。", "commands": []}, ensure_ascii=False)
    return {"choices": [{"message": {"role": "assistant", "content": text}}], "demo": True}


@app.post("/v1/images/generations")
def image(body: Prompt):
    return {"data": [{"b64_json": base64.b64encode(png_fixture()).decode()}], "demo": True}


@app.post("/generate/music")
def music(body: Prompt):
    return {"audio_base64": base64.b64encode(wav_fixture()).decode(), "mime_type": "audio/wav", "demo": True}


@app.post("/generate/3d")
def model(body: Prompt):
    return {"model_base64": base64.b64encode(glb_fixture()).decode(), "mime_type": "model/gltf-binary", "demo": True}


@app.post("/generate/async")
def pending(body: Prompt):
    return {"task_id": "demo-only-task", "status": "processing", "demo": True}


if __name__ == "__main__":
    import uvicorn
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=9010)
    args = parser.parse_args()
    print("TD Open 接入演练：仅返回测试素材，不是 AI 模型，不调用收费 API。", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=args.port)
