"""Separate immutable application resources from the writable user workspace."""
import os
from pathlib import Path

RESOURCE_ROOT = Path(__file__).resolve().parents[1]
# Set only by the desktop launcher. Web/source installations retain their paths.
WORKSPACE_ROOT = Path(os.environ.get("TD_WORKSPACE_DIR", str(RESOURCE_ROOT))).resolve()

