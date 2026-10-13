"""Example Python operator: a signal multiplier. No dynamic source code execution."""

from backend.catalog import parameter, port, register_operator


def scale(params: dict, inputs: dict, time: float):
    return float(inputs.get("in", 1)) * float(params.get("factor", 2))


register_operator(
    {
        "type": "python_scale",
        "label": "Python 倍率",
        "family": "CHOP",
        "description": "示例扩展：在本地 Python 后端将输入信号乘以倍率。",
        "inputs": [port("in", "CHOP", "输入")],
        "outputs": [port("out", "CHOP", "输出")],
        "params": [parameter("factor", "倍率", 2)],
    },
    evaluator=scale,
)
