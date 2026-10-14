"""Install pinned source archives without requiring Git on end-user computers."""
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import zipfile

import httpx
from .download import Cancelled


def install_repository(repository: str, revision: str, destination: Path, cancelled) -> None:
    match = re.fullmatch(r"https://github.com/([\w.-]+/[\w.-]+?)(?:\.git)?", repository)
    if not match or not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("Runtime repository must have a pinned GitHub commit")
    receipt = destination / ".td-source.json"
    if receipt.is_file() and json.loads(receipt.read_text())["revision"] == revision:
        return
    if (destination / ".git").is_dir() and shutil.which("git"):
        import subprocess
        current = subprocess.check_output(["git", "-C", str(destination), "rev-parse", "HEAD"], text=True).strip()
        if current == revision:
            return
    if destination.exists() and any(destination.iterdir()):
        raise ValueError("已有不同版本的运行时代码，请先备份该目录再重新安装：" + str(destination))
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".td-source-", dir=destination.parent) as temporary:
        archive = Path(temporary) / "source.zip"
        url = f"https://codeload.github.com/{match[1]}/zip/{revision}"
        with httpx.Client(follow_redirects=True, timeout=120) as client, client.stream("GET", url) as response:
            response.raise_for_status()
            size = 0
            with archive.open("wb") as output:
                for chunk in response.iter_bytes(1024 * 1024):
                    if cancelled(): raise Cancelled("运行时下载已取消")
                    size += len(chunk)
                    if size > 300 * 1024**2: raise ValueError("Source archive exceeds 300 MiB")
                    output.write(chunk)
        unpack = Path(temporary) / "source"
        with zipfile.ZipFile(archive) as zipped:
            if sum(item.file_size for item in zipped.infolist()) > 1024**3:
                raise ValueError("Extracted source exceeds 1 GiB")
            for item in zipped.infolist():
                if not (unpack / item.filename).resolve().is_relative_to(unpack.resolve()):
                    raise ValueError("Unsafe source archive path")
                if (item.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError("Source archive cannot contain symbolic links")
            zipped.extractall(unpack)
        roots = list(unpack.iterdir())
        if len(roots) != 1 or not roots[0].is_dir(): raise ValueError("Unexpected source archive structure")
        if cancelled(): raise Cancelled("安装已取消")
        if destination.exists(): destination.rmdir()  # Only an empty directory is allowed above.
        os.replace(roots[0], destination)
        receipt.write_text(json.dumps({"repository": repository, "revision": revision}), encoding="utf-8")
