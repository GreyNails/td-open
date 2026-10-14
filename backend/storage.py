"""Atomic filesystem persistence with an explicit project-root boundary."""

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import tempfile
from uuid import uuid4

from backend.models import Project
from backend.paths import RESOURCE_ROOT, WORKSPACE_ROOT

ROOT = WORKSPACE_ROOT
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$")


class ProjectStore:
    def __init__(self, data_dir: Path | None = None):
        self.data_dir = (data_dir or ROOT / "data").resolve()
        self.projects_dir = self.data_dir / "projects"
        self.assets_dir = self.data_dir / "assets"
        self.exports_dir = self.data_dir / "exports"
        self.examples_dir = self.data_dir / "examples"
        self.projects_dir.mkdir(parents=True, exist_ok=True)
        self.assets_dir.mkdir(parents=True, exist_ok=True)
        self.exports_dir.mkdir(parents=True, exist_ok=True)
        self.examples_dir.mkdir(parents=True, exist_ok=True)

    def path(self, project_id: str) -> Path:
        if not ID_RE.fullmatch(project_id):
            raise ValueError("无效的项目 ID")
        path = self.projects_dir / f"{project_id}.json"
        if path.is_symlink():
            raise ValueError("项目文件不能是符号链接")
        return path

    def save(self, project: Project) -> Project:
        # Example IDs are reserved. A caller saving a modified original always
        # receives a new project, including clients using HTTP or MCP directly.
        if project.id.startswith("example_") or self.is_example(project.id):
            source_id = project.id
            project = project.model_copy(deep=True)
            project.id = "project_" + uuid4().hex
            project.name = (project.name[:188] + " · 我的作品")[:200]
            project.settings.pop("is_example", None)
            project.settings["source_example_id"] = source_id
        if "is_example" in project.settings:
            project = project.model_copy(deep=True)
            project.settings.pop("is_example", None)
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
        if self.is_example(project_id):
            return self.get_example(project_id)
        return Project.model_validate_json(self.path(project_id).read_text(encoding="utf-8"))

    def delete(self, project_id: str) -> None:
        if self.is_example(project_id):
            raise ValueError("案例原件不能删除，请编辑自己的项目副本")
        self.path(project_id).unlink()

    def example_path(self, example_id: str) -> Path:
        self.path(example_id)  # Reuse the identifier / symlink boundary check.
        if example_id == "example_tidal-muse":
            ready = self.examples_dir / "tidal_muse_ready.json"
            if ready.is_file() and not ready.is_symlink():
                return ready
        local = self.examples_dir / (example_id + ".json")
        if local.is_file() and not local.is_symlink():
            return local
        if example_id.startswith("example_"):
            shipped = RESOURCE_ROOT / "examples" / (example_id[len("example_"):] + ".tdopen.json")
            if shipped.is_file() and not shipped.is_symlink():
                return shipped
        raise FileNotFoundError("案例不存在")

    def is_example(self, example_id: str) -> bool:
        try:
            self.example_path(example_id)
            return True
        except FileNotFoundError:
            return False

    def get_example(self, example_id: str) -> Project:
        project = Project.model_validate_json(self.example_path(example_id).read_text(encoding="utf-8"))
        project.settings["is_example"] = True
        return project

    def list_examples(self) -> list[dict]:
        ids = {"example_" + path.name.removesuffix(".tdopen.json")
               for path in (RESOURCE_ROOT / "examples").glob("*.tdopen.json") if not path.is_symlink()}
        ids.update(path.stem for path in self.examples_dir.glob("*.json") if not path.is_symlink())
        rows = []
        for identifier in sorted(ids):
            try:
                project = self.get_example(identifier)
                rows.append(dict(id=identifier, name=project.name, is_example=True,
                                 node_count=len(project.nodes), edge_count=len(project.edges)))
            except (ValueError, OSError):
                continue
        return rows

    def list(self) -> list[dict]:
        result = []
        paths = {path.stem: path for path in self.projects_dir.glob("*.json")}
        paths.update({path.stem: path for path in self.examples_dir.glob("*.json")})
        for path in paths.values():
            try:
                if path.is_symlink():
                    continue
                project = self.get(path.stem)
                result.append({"id": project.id, "name": project.name, "version": project.version,
                               "node_count": len(project.nodes), "edge_count": len(project.edges),
                               "updated_at": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(),
                               "is_example": self.is_example(project.id)})
            except (ValueError, OSError, json.JSONDecodeError):
                continue
        return sorted(result, key=lambda item: item["updated_at"], reverse=True)
