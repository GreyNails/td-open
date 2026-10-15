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
    output = ROOT / "build/desktop/verification"
    output.mkdir(parents=True, exist_ok=True)
    installed = ROOT / ".cache/desktop-install/安装验证 with spaces"
    installer_tested = False
    if not args.executable and system == "Windows":
        installer = next((ROOT / "dist/desktop").glob("*.exe"))
        subprocess.run([str(installer), "/S", "/D=" + str(installed)], check=True, timeout=180)
        args.executable = installed / "TD Open.exe"
        installer_tested = True
    elif not args.executable and system == "Darwin":
        installer = next((ROOT / "dist/desktop").glob("*.dmg"))
        volume = ROOT / ".cache/desktop-install/volume"
        volume.mkdir(parents=True, exist_ok=True)
        subprocess.run(["hdiutil", "attach", str(installer), "-nobrowse", "-readonly", "-mountpoint", str(volume)], check=True, timeout=90)
        try:
            assert (volume / "Applications").is_symlink()
            installed.mkdir(parents=True, exist_ok=True)
            subprocess.run(["ditto", str(volume / "TD Open.app"), str(installed / "TD Open.app")], check=True, timeout=120)
        finally:
            subprocess.run(["hdiutil", "detach", str(volume)], check=True, timeout=60)
        subprocess.run(["codesign", "--verify", "--deep", "--strict", str(installed / "TD Open.app")], check=True, timeout=90)
        args.executable = installed / "TD Open.app/Contents/MacOS/TD Open"
        installer_tested = True
    candidates = {"Windows": "win-unpacked/TD Open.exe", "Darwin": "mac*/TD Open.app/Contents/MacOS/TD Open",
                  "Linux": "linux-unpacked/td-open-desktop"}
    executable = args.executable or next((ROOT / "dist/desktop").glob(candidates[system]), None)
    if not executable or not executable.is_file(): raise RuntimeError("Packaged executable not found")
    report = output / "native-smoke.json"
    env = {**os.environ, "TD_DESKTOP_SMOKE_REPORT": str(report),
           "TD_DESKTOP_USER_DATA": str(ROOT / ".cache/desktop-smoke/用户数据 with spaces")}
    command = [str(executable.resolve())]
    if system == "Linux": command += ["--no-sandbox", "--ozone-platform=headless"]
    # Hosted Mac VMs expose different GPU backends from physical Macs. Try the
    # normal runtime first, then explicit ANGLE modes; never waive WebGL checks.
    modes = ["default", "gl", "swiftshader", "swiftshader-webgl"] if system == "Darwin" else ["swiftshader"]
    for mode in modes:
        report.unlink(missing_ok=True)
        env["TD_DESKTOP_SMOKE_ANGLE"] = mode
        with (output / ("launcher-" + mode + ".log")).open("w", encoding="utf-8") as log:
            process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
            try: process.wait(timeout=240)
            except subprocess.TimeoutExpired:
                parent = psutil.Process(process.pid)
                for child in parent.children(recursive=True):
                    try: child.kill()
                    except psutil.NoSuchProcess: pass
                process.kill(); process.wait()
                raise RuntimeError("Packaged GUI timed out; see launcher logs and userData logs")
        if not report.is_file(): raise RuntimeError("GUI produced no smoke report; see launcher logs")
        result = json.loads(report.read_text(encoding="utf-8"))
        if result.get("passed"): break
        (output / ("failed-" + mode + ".json")).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        if result.get("webgl2") is not False: raise RuntimeError(json.dumps(result, ensure_ascii=False))
    else: raise RuntimeError("All GPU modes failed: " + json.dumps(result, ensure_ascii=False))
    result["smokeAngle"] = mode
    for _ in range(50):
        if not psutil.pid_exists(result["backendPID"]): break
        time.sleep(.1)
    else: raise RuntimeError("Desktop left its Python backend running after exit")
    if process.returncode != 0: raise RuntimeError(f"Desktop exited {process.returncode}")
    result["backendExited"] = True
    result["installerValidated"] = installer_tested
    result["nativeOS"] = platform.platform()
    report.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(report.read_text(encoding="utf-8"))


if __name__ == "__main__": main()
