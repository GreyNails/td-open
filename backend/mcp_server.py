"""Expose a running TD Open application to MCP clients over stdio.

Run with ``python -m backend.mcp_server`` from the project directory. The HTTP
backend must already be running. No tools run shell commands or generated code.
"""
from __future__ import annotations

import os
import re
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP

from backend.graph import apply_commands as edit_graph
from backend.models import Project

APP_URL = os.environ.get("TD_OPEN_APP_URL", "http://127.0.0.1:8765").rstrip("/")
mcp = FastMCP("TD Open", instructions="Edit saved TD Open node graphs. Inspect operators and the project before changing it. apply_graph_commands defaults to a preview; set apply=true only when the user requests the edit. The local TD Open HTTP backend must be running.")


async def app_request(method: str, path: str, payload: Any = None) -> Any:
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
            headers = {"x-td-desktop-token": os.environ["TD_DESKTOP_TOKEN"]} if os.environ.get("TD_DESKTOP_TOKEN") else {}
            response = await client.request(method, APP_URL + path, json=payload, headers=headers)
            response.raise_for_status()
            return response.json()
    except httpx.HTTPStatusError as exc:
        raise ValueError(f"TD Open returned HTTP {exc.response.status_code}. Verify the project ID and graph commands.") from None
    except httpx.RequestError:
        raise ValueError("Cannot reach TD Open. Start the HTTP backend and verify TD_OPEN_APP_URL.") from None


def project_path(project_id: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", project_id):
        raise ValueError("Invalid project ID")
    return "/api/projects/" + project_id


@mcp.tool()
async def list_projects() -> Any:
    """List saved local projects. Read only."""
    return await app_request("GET", "/api/projects")


@mcp.tool()
async def get_project(project_id: str) -> dict[str, Any]:
    """Read the nodes, edges and parameters of a saved project."""
    return await app_request("GET", project_path(project_id))


@mcp.tool()
async def list_operators() -> Any:
    """List supported operators, their parameter names and typed ports."""
    return await app_request("GET", "/api/catalog")


@mcp.tool()
async def get_local_model_status() -> Any:
    """Inspect local GPU, installed model profiles and environment. Read only."""
    result=await app_request("GET", "/api/local-ai/status")
    return {**result,"profiles":[{key:value for key,value in profile.items() if key!="files"} for profile in result["profiles"]]}


@mcp.tool()
async def run_local_model(profile_id: str, parameters: dict[str, Any], inputs: dict[str, str] | None = None) -> Any:
    """Explicitly queue real local GPU inference when the user requests generation.
    Inspect get_local_model_status first. Inputs use uploaded /api/assets or
    /api/exports URLs: image, image2, mask, audio. Returns a job ID immediately.
    Poll get_local_model_job; save its result_url into a node with graph commands
    if requested. This does not automatically modify any saved project.
    """
    from backend.local_ai.registry import get_profile
    get_profile(profile_id)
    return await app_request("POST", "/api/local-ai/generate", {"profile_id":profile_id,"parameters":parameters,"inputs":inputs or {},"metadata":{"origin":"mcp"}})


def local_job_path(job_id: str) -> str:
    if not re.fullmatch(r"[a-f0-9]{32}",job_id):raise ValueError("Invalid local model job ID")
    return "/api/local-ai/jobs/"+job_id


@mcp.tool()
async def get_local_model_job(job_id: str) -> Any:
    """Read GPU task status, progress and real downloadable output URLs."""
    return await app_request("GET",local_job_path(job_id))


@mcp.tool()
async def cancel_local_model_job(job_id: str) -> Any:
    """Cancel the specified queued or running local model job when requested."""
    return await app_request("POST",local_job_path(job_id)+"/cancel",{})


@mcp.tool()
async def apply_graph_commands(project_id: str, commands: list[dict[str, Any]], apply: bool = False) -> dict[str, Any]:
    """Preview or apply graph edits atomically. Each command uses 'op':
    add_node(type,id?,params?,position?), set_param(id,key,value),
    remove_node(id), connect(source,target,sourceHandle?,targetHandle?),
    disconnect(id), rename_project(name). Defaults to preview, with no writes.
    Pass apply=true to save changes to the project. Editing an example creates
    a new project; use the returned project ID for subsequent edits. Open that
    project in the editor to see changes. This never executes generated code
    or remote MCP tools.
    """
    if len(commands) > 100:
        raise ValueError("At most 100 commands may be applied together")
    allowed = {"add_node", "set_param", "remove_node", "connect", "disconnect", "rename_project"}
    if any(command.get("op") not in allowed for command in commands):
        raise ValueError("Unsupported graph operation")
    current = Project.model_validate(await get_project(project_id))
    changed = edit_graph(current, commands).model_dump(mode="json")
    if apply:
        changed = await app_request("POST", "/api/projects", changed)
    return {"applied": apply, "project": changed, "message": "Project saved. Reload it in the editor." if apply else "Preview only. No changes saved."}


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
