"""Stage a native, relocatable desktop runtime without copying private user data.

Run on each target OS/architecture after frontend npm ci/build. Electron's package
contains this tree as read-only resources; all runtime writes go to userData.
"""
from pathlib import Path
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
STAGE = ROOT / "build/desktop/resources"
CACHE = ROOT / ".cache/desktop-build"
PYTHON = "3.11.14"
NODE = "24.22.0"
SYSTEM = {"Windows": "win", "Darwin": "darwin", "Linux": "linux"}[platform.system()]
ARCH = "arm64" if platform.machine().lower() in ("aarch64", "arm64") else "x64"


def command(*args, env=None, cwd=ROOT):
    print("Run:", " ".join(map(str, args)), flush=True)
    subprocess.run(list(map(str, args)), cwd=cwd, env=env, check=True)


def download(url, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        return
    print("Download:", url, flush=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    with urllib.request.urlopen(url, timeout=120) as response, temporary.open("wb") as output:
        shutil.copyfileobj(response, output)
    os.replace(temporary, destination)


def copy_tree(source, target):
    assert target.resolve().is_relative_to(STAGE.resolve()) and not target.is_symlink()
    if target.exists(): shutil.rmtree(target)  # Replace only generated staging copies.
    shutil.copytree(source, target, symlinks=True,
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store"))


def node_tar_filter(member, destination):
    # Python 3.11.5's data_filter resolves relative symlinks against the archive
    # root instead of their containing directory. Validate these explicitly.
    if member.issym():
        target = Path(destination) / Path(member.name).parent / member.linkname
        if Path(member.linkname).is_absolute() or not target.resolve().is_relative_to(Path(destination).resolve()):
            raise ValueError("Unsafe Node archive symlink")
        return tarfile.tar_filter(member, destination).replace(uid=None, gid=None, uname=None, gname=None)
    return tarfile.data_filter(member, destination)


def icons():
    from PIL import Image, ImageDraw
    target = ROOT / "desktop/assets"
    target.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGBA", (1024, 1024))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((24, 24, 1000, 1000), radius=216, fill="#c0e88e")
    draw.line([(332, 352), (332, 540), (690, 540), (690, 704)], fill="#283724", width=58)
    draw.line([(512, 540), (512, 726)], fill="#283724", width=58)
    for x, y in [(332, 320), (690, 720), (512, 752)]:
        draw.rounded_rectangle((x-98, y-88, x+98, y+88), radius=28, fill="#283724")
        draw.rounded_rectangle((x-49, y-39, x+49, y+39), radius=10, fill="#c0e88e")
    image.save(target / "icon.png")
    image.save(target / "icon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    image.save(target / "icon.icns")


def collect_notices():
    target = STAGE / "licenses"
    target.mkdir(exist_ok=True)
    # Preserve full notices of bundled JavaScript dependencies, including
    # dependencies whose code Vite has inlined into the browser application.
    for group in ("frontend", "desktop"):
        source = ROOT / group / "node_modules"
        for item in source.rglob("*"):
            if item.is_file() and item.name.upper().startswith(("LICENSE", "COPYING", "NOTICE", "THIRD_PARTY", "THIRD-PARTY")):
                destination = target / group / item.relative_to(source)
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(item, destination)
    shutil.copy2(ROOT / "THIRD_PARTY_NOTICES.md", target / "THIRD_PARTY_NOTICES.md")
    (target / "RUNTIMES.txt").write_text(
        "Python: PSF license; complete distribution notices are retained under ../python.\n"
        "Node.js: MIT and bundled component licenses; see ../node/LICENSE.\n"
        "Chromium: BSD and third-party notices retained under ../browsers.\n"
        "Electron: MIT and Chromium notices included alongside the application executable.\n"
        "FFmpeg: unmodified imageio-ffmpeg 0.6.0 binary, GPL components may be enabled.\n"
        "Upstream binary and build recipes: https://github.com/imageio/imageio-binaries\n"
        "FFmpeg corresponding upstream sources: https://ffmpeg.org/releases/\n"
        "imageio-ffmpeg source: https://github.com/imageio/imageio-ffmpeg/tree/v0.6.0\n"
        "The bundled executable is invoked as a separate process; TD Open's MIT license does not replace its license.\n",
        encoding="utf-8")


def main():
    STAGE.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    environment = {**os.environ, "UV_CACHE_DIR": str(CACHE / "uv-cache"),
                   "UV_PYTHON_INSTALL_DIR": str(STAGE / "python"), "UV_PYTHON_BIN_DIR": str(CACHE / "python-bin"),
                   "PIP_CACHE_DIR": str(CACHE / "pip"), "PYTHONUTF8": "1", "PYTHONDONTWRITEBYTECODE": "1"}
    command(sys.executable, "-m", "uv", "python", "install", PYTHON, env=environment)
    python = Path(subprocess.check_output([sys.executable, "-m", "uv", "python", "find", PYTHON, "--managed-python"], env=environment, text=True).strip())
    assert python.resolve().is_relative_to((STAGE / "python").resolve())
    command(sys.executable, "-m", "uv", "pip", "install", "--python", python, "--break-system-packages",
            "-r", ROOT / "requirements.lock", "-r", ROOT / "desktop/requirements-runtime.txt", env=environment)

    archive_name = f"node-v{NODE}-{SYSTEM}-{ARCH}." + ("zip" if SYSTEM == "win" else "tar.gz")
    archive = CACHE / archive_name
    checksums = CACHE / f"node-{NODE}-SHASUMS256.txt"
    download(f"https://nodejs.org/dist/v{NODE}/SHASUMS256.txt", checksums)
    download(f"https://nodejs.org/dist/v{NODE}/{archive_name}", archive)
    expected = next(line.split()[0] for line in checksums.read_text().splitlines() if line.split()[-1] == archive_name)
    with archive.open("rb") as handle:
        assert hashlib.file_digest(handle, "sha256").hexdigest() == expected, "Node archive SHA256 mismatch"
    unpack = CACHE / "node-unpacked"
    if SYSTEM == "win":
        with zipfile.ZipFile(archive) as handle:
            for name in handle.namelist():
                assert (unpack / name).resolve().is_relative_to(unpack.resolve())
            handle.extractall(unpack)
    else:
        with tarfile.open(archive) as handle:
            handle.extractall(unpack, filter=node_tar_filter)
    copy_tree(unpack / f"node-v{NODE}-{SYSTEM}-{ARCH}", STAGE / "node")
    node = STAGE / "node" / ("node.exe" if SYSTEM == "win" else "bin/node")

    application = STAGE / "application"
    for name in ("backend", "examples"):
        copy_tree(ROOT / name, application / name)
    copy_tree(ROOT / "frontend/dist", application / "frontend/dist")
    (application / "scripts").mkdir(exist_ok=True)
    shutil.copy2(ROOT / "scripts/web-render.mjs", application / "scripts/web-render.mjs")
    for name in ("@playwright/test", "playwright", "playwright-core"):
        copy_tree(ROOT / "frontend/node_modules" / name, application / "frontend/node_modules" / name)
    for name in ("LICENSE", "THIRD_PARTY_NOTICES.md"):
        shutil.copy2(ROOT / name, application / name)
    browser_env = {**environment, "PLAYWRIGHT_BROWSERS_PATH": str(STAGE / "browsers")}
    command(node, application / "frontend/node_modules/playwright/cli.js", "install", "chromium", env=browser_env)
    # Resolve the actual browser selected by this pinned Playwright installation.
    chromium = Path(subprocess.check_output([str(node), "-e",
        "console.log(require('./frontend/node_modules/playwright').chromium.executablePath())"],
        cwd=application, env=browser_env, text=True).strip())
    assert chromium.is_file()

    ffmpeg_source = Path(subprocess.check_output([str(python), "-c", "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"], text=True, env=environment).strip())
    tools = STAGE / "tools"
    tools.mkdir(exist_ok=True)
    ffmpeg = tools / ("ffmpeg.exe" if SYSTEM == "win" else "ffmpeg")
    shutil.copy2(ffmpeg_source, ffmpeg)
    ffmpeg.chmod(0o755)
    manifest = {name: str(value.relative_to(STAGE)).replace("\\", "/") for name, value in
                {"python": python, "node": node, "chromium": chromium, "ffmpeg": ffmpeg}.items()}
    manifest.update(platform=SYSTEM, architecture=ARCH, python_version=PYTHON, node_version=NODE)
    (STAGE / "runtime.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    icons()
    collect_notices()
    # Strict allowlist: neither API keys nor user projects/model weights are staged.
    assert not (application / "data").exists()
    command(python, "-c", "import fastapi,mcp,httpx,websockets,psutil,serial; print('Bundled Python imports OK')", env=environment)
    print(json.dumps(manifest, indent=2), flush=True)


if __name__ == "__main__":
    main()
