"""Portable, versioned graph format shared by HTTP, MCP, and disk storage."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue


Identifier = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$")]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Position(Model):
    x: float = 0
    y: float = 0


class NodeData(Model):
    label: str = Field(default="", max_length=200)
    params: dict[str, JsonValue] = Field(default_factory=dict)


class Node(Model):
    id: Identifier
    type: str = Field(min_length=1, max_length=96)
    position: Position = Field(default_factory=Position)
    data: NodeData = Field(default_factory=NodeData)


class Edge(Model):
    id: Identifier
    source: Identifier
    target: Identifier
    sourceHandle: str | None = Field(default=None, max_length=96)
    targetHandle: str | None = Field(default=None, max_length=96)


class Project(Model):
    id: Identifier
    name: str = Field(min_length=1, max_length=200)
    version: Literal[1] = 1
    nodes: list[Node] = Field(default_factory=list, max_length=500)
    edges: list[Edge] = Field(default_factory=list, max_length=2000)
    settings: dict[str, JsonValue] = Field(default_factory=dict)


class CommandRequest(Model):
    project: Project
    commands: list[dict[str, JsonValue]] = Field(min_length=1, max_length=200)


class EvaluateRequest(Model):
    project: Project
    time: float = Field(default=0, ge=0)
