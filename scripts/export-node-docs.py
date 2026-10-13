"""Regenerate the reference tables from the shared operator schema."""
from collections import Counter
import json
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from backend.data_runtime import STATELESS_TYPES
from backend.channel_runtime import CHANNEL_STATELESS_TYPES

manifest = json.loads((ROOT / 'backend/operator_catalog.json').read_text())
p = ROOT / 'docs/NODES.md'
counts = Counter(n['family'] for n in manifest)
intro = f"# 节点手册\n\n当前目录含 {len(manifest)} 个节点入口：" + '、'.join(f"{count} {family}" for family, count in counts.items()) + "。其中 92 个入口需要外部 SDK/设备适配器，不计为内置原生功能。完整逐项映射见 [参考能力清单](reference-capabilities.json)。\n\n"
intro += "浏览器执行实际图像、采样、表格、几何与场景运算；Python 服务提供无状态数据求值、脚本与协议。节点使用同名创作概念，但不是 TouchDesigner 参数/数值/API 兼容声明。脚本必须手动运行，设备与音频权限必须显式启用。下表给出默认参数，范围与说明以界面或共享 JSON 目录为准。\n\n"
intro += "完整案例见 [案例索引](EXAMPLES.md)，实现边界见 [功能矩阵](FEATURE_MATRIX.md)，协议与外部驱动见 [I/O 指南](IO_PROTOCOLS.md)。\n\n"
def safe(value):
    return str(value).replace('|', '／').replace('\n', ' ↵ ').replace('`', '＇')
for family,count in Counter(n['family'] for n in manifest).items():
    intro += f'## {family}（{count} 个）\n\n| 名称 / 类型 ID | 输入 → 输出 | 运行位置 | 用途与默认参数 |\n| --- | --- | --- | --- |\n'
    for n in (n for n in manifest if n['family']==family):
        ports=lambda direction: '、'.join(f"{port['id']}:{port['kind']}" for port in n[direction]) or '—'
        runtime='手动本地 ComfyUI / 模型环境' if n['type'].startswith(('local_','comfy_')) else '外部适配器（未内置）' if n.get('reference', {}).get('level')=='bridge' else '手动 Python 服务' if n['type'].startswith('python_script_') else '协议服务' if n['type'].startswith('io_') else '服务' if family=='AI' or n['type']=='web_render_top' else '浏览器 / 服务端' if n['type'] in STATELESS_TYPES or n['type'] in CHANNEL_STATELESS_TYPES or n['type'] in {'lfo','constant','math','text'} else '浏览器'
        params='；'.join(f"`{parameter['key']}={safe(parameter['default'])}`" for parameter in n['params'])
        intro+=f"| {safe(n['label'])} / `{n['type']}` | {ports('inputs')} → {ports('outputs')} | {runtime} | {safe(n['description'])}"+(f'<br>{params}' if params else '')+' |\n'
    intro+='\n'
p.write_text(intro.rstrip() + "\n")
print(f'Updated node reference ({len(manifest)} nodes).')
