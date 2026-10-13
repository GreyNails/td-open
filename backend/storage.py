"""Atomic filesystem persistence with an explicit project-root boundary."""

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import tempfile

from backend.models import Project

ROOT = Path(__file__).resolve().parents[1]
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$")


class ProjectStore:
    def __init__(self, data_dir: Path | None = None):
        self.data_dir = (data_dir or ROOT / "data").resolve()
        self.projects_dir = self.data_dir / "projects"
        self.assets_dir = self.data_dir / "assets"
        self.exports_dir = self.data_dir / "exports"
        self.projects_dir.mkdir(parents=True, exist_ok=True)
        self.assets_dir.mkdir(parents=True, exist_ok=True)
        self.exports_dir.mkdir(parents=True, exist_ok=True)

    def path(self, project_id: str) -> Path:
        if not ID_RE.fullmatch(project_id):
            raise ValueError("无效的项目 ID")
        path = self.projects_dir / f"{project_id}.json"
        if path.is_symlink():
            raise ValueError("项目文件不能是符号链接")
        return path

    def save(self, project: Project) -> Project:
        path = self.path(project.id)
        serialized = project.model_dump_json(indent=2)
        fd, temporary = tempfile.mkstemp(prefix=".project-", suffix=".tmp", dir=self.projects_dir)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(serialized)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        return project

    def get(self, project_id: str) -> Project:
        return Project.model_validate_json(self.path(project_id).read_text(encoding="utf-8"))

    def delete(self, project_id: str) -> None:
        self.path(project_id).unlink()

    def list(self) -> list[dict]:
        result = []
        for path in self.projects_dir.glob("*.json"):
            try:
                if path.is_symlink():
                    continue
                project = Project.model_validate_json(path.read_text(encoding="utf-8"))
                result.append({"id": project.id, "name": project.name, "version": project.version,
                               "node_count": len(project.nodes), "edge_count": len(project.edges),
                               "updated_at": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()})
            except (ValueError, OSError, json.JSONDecodeError):
                continue
        return sorted(result, key=lambda item: item["updated_at"], reverse=True)
