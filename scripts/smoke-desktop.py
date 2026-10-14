"""Run the actual packaged GUI and require its integration report and clean exit."""
from pathlib import Path
import argparse
import json
import os
import platform
import subprocess
import time

import psutil

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--executable", type=Path)
    args = parser.parse_args()
    system = platform.system()
    candidates = {"Windows": "win-unpacked/TD Open.exe", "Darwin": "mac*/TD Open.app/Contents/MacOS/TD Open",
                  "Linux": "linux-unpacked/td-open-desktop"}
    executable = args.executable or next((ROOT / "dist/desktop").glob(candidates[system]), None)
    if not executable or not executable.is_file(): raise RuntimeError("Packaged executable not found")
    output = ROOT / "build/desktop/verification"
    output.mkdir(parents=True, exist_ok=True)
    report = output / "native-smoke.json"
    report.unlink(missing_ok=True)
    env = {**os.environ, "TD_DESKTOP_SMOKE_REPORT": str(report),
           "TD_DESKTOP_USER_DATA": str(ROOT / ".cache/desktop-smoke/用户数据 with spaces")}
    command = [str(executable.resolve())]
    if system == "Linux": command += ["--no-sandbox", "--ozone-platform=headless"]
    with (output / "launcher.log").open("w", encoding="utf-8") as log:
        process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
        try: process.wait(timeout=240)
        except subprocess.TimeoutExpired:
            parent = psutil.Process(process.pid)
            for child in parent.children(recursive=True):
                try: child.kill()
                except psutil.NoSuchProcess: pass
            process.kill(); process.wait()
            raise RuntimeError("Packaged GUI timed out; see launcher.log and userData logs")
    if not report.is_file(): raise RuntimeError("GUI produced no smoke report; see launcher.log")
    result = json.loads(report.read_text(encoding="utf-8"))
    if not result.get("passed"): raise RuntimeError(json.dumps(result, ensure_ascii=False))
    for _ in range(50):
        if not psutil.pid_exists(result["backendPID"]): break
        time.sleep(.1)
    else: raise RuntimeError("Desktop left its Python backend running after exit")
    if process.returncode != 0: raise RuntimeError(f"Desktop exited {process.returncode}")
    result["backendExited"] = True
    result["nativeOS"] = platform.platform()
    report.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(report.read_text(encoding="utf-8"))


if __name__ == "__main__": main()
