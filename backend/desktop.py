"""Owned desktop backend. Port zero avoids conflicts; stdin controls lifetime."""
import json
import os
import socket
import sys
import threading
import time
from pathlib import Path


def main():
    import uvicorn
    from backend.main import app
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    # Reuse this workspace's port so Chromium retains local UI preferences.
    port_file = Path(os.environ["TD_WORKSPACE_DIR"]) / ".desktop-port"
    try:
        preferred = int(port_file.read_text())
        if not 1024 <= preferred <= 65535: preferred = 0
    except (OSError, ValueError): preferred = 0
    try: listener.bind(("127.0.0.1", preferred))
    except OSError: listener.bind(("127.0.0.1", 0))
    port_file.write_text(str(listener.getsockname()[1]))
    listener.listen(128)
    listener.setblocking(False)
    os.environ["TD_OPEN_APP_URL"] = f"http://127.0.0.1:{listener.getsockname()[1]}"
    session_file = port_file.with_name(".desktop-session.json")
    if session_file.is_symlink(): raise RuntimeError("Desktop session cannot be a symlink")
    with os.fdopen(os.open(session_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w", encoding="utf-8") as session:
        json.dump({"port": listener.getsockname()[1], "pid": os.getpid(), "token": os.environ["TD_DESKTOP_TOKEN"]}, session)
    session_file.chmod(0o600)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", log_level="warning", access_log=False))

    def parent_pipe():
        # A normal quit and an unexpected parent crash both close this pipe.
        sys.stdin.buffer.readline()
        server.should_exit = True

    def announce():
        while not server.started and not server.should_exit:
            time.sleep(.025)
        if server.started:
            print(json.dumps({"event": "ready", "port": listener.getsockname()[1], "pid": os.getpid()}), flush=True)

    threading.Thread(target=parent_pipe, daemon=True).start()
    threading.Thread(target=announce, daemon=True).start()
    try:
        # asyncio subprocesses need the Proactor loop on Windows. Bypass uvicorn's
        # platform loop chooser, while retaining the normal web launcher unchanged.
        import asyncio
        if sys.platform == "win32":
            asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
        asyncio.run(server.serve(sockets=[listener]))
    finally:
        listener.close()
        session_file.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
