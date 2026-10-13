"""Shared operator manifest and the local Python execution extension API."""

import importlib
import json
from pathlib import Path
import pkgutil
from collections.abc import Callable
from typing import Any

from backend.data_runtime import STATELESS_TYPES

NODE_TYPES: dict[str, dict[str, Any]] = {}
NODE_EVALUATORS: dict[str, Callable] = {}


def port(id: str, kind: str, label: str = "") -> dict:
    return {"id": id, "kind": kind, "label": label or id}


def parameter(key: str, label: str, default: Any, type: str = "number", **kw) -> dict:
    return {"key": key, "label": label, "type": type, "default": default, **kw}


def register_operator(spec: dict, evaluator: Callable | None = None) -> None:
    """Register a trusted local plugin. evaluator(params, inputs, time) returns JSON."""
    key = spec["type"]
    if key in NODE_TYPES:
        raise ValueError(f"Operator already registered: {key}")
    spec.setdefault("inputs", [])
    spec.setdefault("outputs", [])
    spec.setdefault("params", [])
    spec.setdefault("runtime", "server" if evaluator else "browser")
    spec["defaults"] = {p["key"]: p["default"] for p in spec["params"]}
    NODE_TYPES[key] = spec
    if evaluator:
        NODE_EVALUATORS[key] = evaluator



# The editor schema is the source of truth. The checked-in JSON keeps backend
# startup independent of Node/npm, including source ZIP and Python-only installs.
# Regenerate after editing catalog.ts or nodes/*Catalog.ts using:
#   node scripts/sync-catalog.mjs
SERVER_BUILTINS = STATELESS_TYPES | {"constant", "lfo", "math"}
for _spec in json.loads(Path(__file__).with_name("operator_catalog.json").read_text(encoding="utf-8")):
    if _spec["type"].startswith("ai_") or _spec["type"] == "mcp_tool":
        _spec["runtime"] = "provider"
    elif _spec["type"] in SERVER_BUILTINS:
        _spec["runtime"] = "server"
    register_operator(_spec)


def load_plugins() -> None:
    """Local Python plugins are trusted code; restart the server after adding one."""
    import backend.plugins
    for module in pkgutil.iter_modules(backend.plugins.__path__):
        if not module.name.startswith("_"):
            importlib.import_module(f"backend.plugins.{module.name}")


load_plugins()
