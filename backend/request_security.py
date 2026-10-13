"""Prevent automatic graph/network workers from calling privileged app APIs."""
import posixpath
import re
from urllib.parse import unquote, urlsplit

_SENSITIVE = re.compile(r"^/api/(scripts|commands|projects|providers|mcp|ai|io|chat|web-render|integrations|upload|artifacts|evaluate)(?:/|$)")


def canonical_url_path(url: str) -> str:
    path = urlsplit(url).path
    for _ in range(5):
        decoded = unquote(path)
        if decoded == path: break
        path = decoded
    path = path.replace("\\", "/")
    return posixpath.normpath("/" + path.lstrip("/"))


def reject_sensitive_app_url(url: str):
    if _SENSITIVE.match(canonical_url_path(url)):
        raise ValueError("Automatic HTTP requests cannot access privileged TD Open APIs; use explicit UI actions")
