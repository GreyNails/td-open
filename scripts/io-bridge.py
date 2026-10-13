#!/usr/bin/env python3
"""Forward actual SDK output (NDJSON stdin) or a project image to an I/O bridge."""
import argparse
import base64
import json
import mimetypes
from pathlib import Path
import re
import sys

import httpx


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--channel", required=True)
    parser.add_argument("--server", default="http://127.0.0.1:8765")
    parser.add_argument("--image", help="Image path relative to this project's data directory")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,96}", args.channel): parser.error("invalid channel name")
    with httpx.Client(base_url=args.server.rstrip("/"), timeout=10) as client:
        def send(value):
            result = client.post("/api/io/bridge/" + args.channel, json={"value": value})
            result.raise_for_status()
            print(json.dumps(result.json()), file=sys.stderr)
        if args.image:
            root = (Path(__file__).resolve().parents[1] / "data").resolve()
            path = (root / args.image).resolve()
            if not path.is_relative_to(root): parser.error("image must be inside project data/")
            mime = mimetypes.guess_type(path.name)[0]
            if not mime or not mime.startswith("image/"): parser.error("expected an image file")
            if path.stat().st_size > 750_000: parser.error("image must fit in the 1 MiB base64 bridge payload")
            send({"mime": mime, "data": base64.b64encode(path.read_bytes()).decode()})
        else:
            for line in sys.stdin:
                if line.strip(): send(json.loads(line))


if __name__ == "__main__": main()
