"""stdio entry point for external AI clients controlling the installed desktop.

The generated MCP config includes only paths. Resolve the current short-lived
desktop session each time, so no API key/token is copied into client configs.
"""
import argparse
import json
import os
from pathlib import Path
import runpy
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--session", required=True, type=Path)
    args = parser.parse_args()
    try: session = json.loads(args.session.read_text(encoding="utf-8"))
    except (OSError, ValueError): parser.exit(1, "Please open TD Open before connecting its MCP server.\n")
    port, token = session.get("port"), session.get("token")
    if not isinstance(port, int) or not 1024 <= port <= 65535 or not isinstance(token, str):
        parser.exit(1, "Invalid desktop session; restart TD Open.\n")
    os.environ["TD_OPEN_APP_URL"] = f"http://127.0.0.1:{port}"
    os.environ["TD_DESKTOP_TOKEN"] = token
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    runpy.run_module("backend.mcp_server", run_name="__main__")


if __name__ == "__main__": main()
