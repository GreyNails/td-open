"""Published examples must open with the same defaults and contracts as the UI."""
import json
from pathlib import Path

import pytest

from backend.catalog import NODE_TYPES
from backend.graph import validate_graph
from backend.models import Project
from backend.storage import ROOT

EXAMPLES = sorted((ROOT / 'examples').glob('*.tdopen.json'))

@pytest.mark.parametrize('path', EXAMPLES, ids=lambda path: path.stem)
def test_example_is_valid_complete_and_contains_only_declared_parameters(path: Path):
    project = Project.model_validate(json.loads(path.read_text()))
    assert validate_graph(project) == []
    outputs = [node for node in project.nodes if node.type == 'output']
    assert len(outputs) == 1
    contributing = {outputs[0].id}
    for _ in project.nodes:
        contributing.update(edge.source for edge in project.edges if edge.target in contributing)
        for node in project.nodes:
            if node.id in contributing and node.type in ("ref_top_op_viewer","ref_top_import_select"):
                operator_path = node.data.params.get("source", node.data.params.get("parent", ""))
                if isinstance(operator_path, str) and operator_path.startswith("/"):
                    contributing.add(operator_path.strip("/").split("/")[0])
    assert contributing == {node.id for node in project.nodes}
    for node in project.nodes:
        assert set(node.data.params) <= set(NODE_TYPES[node.type]['defaults'])
    if path.name != 'empty.tdopen.json':
        assert (ROOT / 'frontend/public/examples' / (path.name.replace('.tdopen.json', '.webp'))).is_file()
