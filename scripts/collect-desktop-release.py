"""Collect only verified native installers, reports, screenshots and checksums."""
import hashlib
import json
from pathlib import Path
import shutil
import sys


def collect(source: Path, output: Path, run: dict):
    assert run["name"] == "Build desktop installers" and run["conclusion"] == "success"
    output.mkdir(parents=True, exist_ok=True)
    platforms = {"windows-x64": ["TD-Open-0.6.0-win-x64.exe"],
                 "macos-arm64": ["TD-Open-0.6.0-mac-arm64.dmg", "TD-Open-0.6.0-mac-arm64.zip"],
                 "macos-x64": ["TD-Open-0.6.0-mac-x64.dmg", "TD-Open-0.6.0-mac-x64.zip"]}
    summaries = {}
    for platform, filenames in platforms.items():
        artifact = source / ("TD-Open-" + platform)
        report = artifact / "build/desktop/verification/native-smoke.json"
        data = json.loads(report.read_text(encoding="utf-8"))
        assert data["passed"] and data["backendExited"] and data["installerValidated"]
        assert data["webgl2"] and data["audioPeak"] > .5 and data["operators"] >= 751
        summaries[platform] = data
        shutil.copy2(report, output / ("verification-" + platform + ".json"))
        shutil.copy2(report.with_suffix(".png"), output / ("desktop-" + platform + ".png"))
        for name in filenames:
            installer = artifact / "dist/desktop" / name
            assert installer.is_file() and installer.stat().st_size > 50 * 1024**2
            shutil.copy2(installer, output / name)
    (output / "VALIDATION.json").write_text(json.dumps({"source_commit": run["head_sha"], "build_url": run["html_url"],
        "platforms": summaries}, indent=2, ensure_ascii=False), encoding="utf-8")
    lines = []
    for path in sorted(output.iterdir()):
        if path.is_file() and path.name != "SHA256SUMS.txt":
            with path.open("rb") as handle: digest = hashlib.file_digest(handle, "sha256").hexdigest()
            lines.append(digest + "  " + path.name)
    (output / "SHA256SUMS.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("Collected", len(lines), "verified release assets")


if __name__ == "__main__": collect(Path(sys.argv[1]), Path(sys.argv[2]), json.loads(Path(sys.argv[3]).read_text()))
