"""Regenerate the reference tables from the shared operator schema."""
from collections import Counter
import json
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from backend.data_runtime import STATELESS_TYPES

manifest = json.loads((ROOT / 'backend/operator_catalog.json').read_text())
p = ROOT / 'docs/NODES.md'
intro = p.read_text().split('## TOP（', 1)[0]
intro = intro.replace('99 个', '205 个').replace('50 TOP、24 CHOP、11 SOP、8 DAT', '97 TOP、46 CHOP、30 SOP、26 DAT').replace('全部 8 份示例', '全部 63 份工程（62 个案例 + 1 个空白）')
intro = intro.replace('`hold` 保存各自的历史状态', '`hold`、`spring`、`adsr`、`delay_chop`、窗口统计、迟滞与触发信号保存各自的历史状态')
intro = intro.replace('参数类型、默认值和可调范围以编辑器参数面板或', '下表列出参数默认值；类型、可调范围与说明以编辑器参数面板或')
footer = '完整案例见 [案例索引](EXAMPLES.md)。程序纹理、光学效果和大几何网络的执行边界见 [功能矩阵](FEATURE_MATRIX.md)。\n\n'
intro = intro.replace(footer, '') + footer
def safe(value):
    return str(value).replace('|', '／').replace('\n', ' ↵ ').replace('`', '＇')
for family,count in Counter(n['family'] for n in manifest).items():
    intro += f'## {family}（{count} 个）\n\n| 名称 / 类型 ID | 输入 → 输出 | 运行位置 | 用途与默认参数 |\n| --- | --- | --- | --- |\n'
    for n in (n for n in manifest if n['family']==family):
        ports=lambda direction: '、'.join(f"{port['id']}:{port['kind']}" for port in n[direction]) or '—'
        runtime='服务' if family=='AI' else '浏览器 / 服务端' if n['type'] in STATELESS_TYPES or n['type'] in {'lfo','constant','math','text'} else '浏览器'
        params='；'.join(f"`{parameter['key']}={safe(parameter['default'])}`" for parameter in n['params'])
        intro+=f"| {safe(n['label'])} / `{n['type']}` | {ports('inputs')} → {ports('outputs')} | {runtime} | {safe(n['description'])}"+(f'<br>{params}' if params else '')+' |\n'
    intro+='\n'
p.write_text(intro.rstrip() + "\n")
print(f'Updated node reference ({len(manifest)} nodes).')
