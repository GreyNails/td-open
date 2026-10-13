#!/usr/bin/env python3
"""Build an honest per-reference capability inventory from the executable catalog.

Run sync-catalog first. Counts describe mappings, never TouchDesigner equivalence.
The original screenshot audit is preferred; the saved report provides a portable
fallback so downstream contributors can regenerate this file without private data.
"""
from __future__ import annotations
from collections import Counter, defaultdict
import csv
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / 'backend/operator_catalog.json'
DOCUMENT = ROOT / 'docs/reference-capabilities.json'
ARTIFACTS = ROOT / 'data/artifacts'


def normal(name: str) -> str:
    return re.sub(r'\s+', ' ', re.sub(r' (TOP|CHOP|SOP|DAT|MAT|COMP)$', '', name)).strip().casefold()


def unique(values):
    return list(dict.fromkeys(str(value) for value in values if value))


def main():
    original = ARTIFACTS / 'ref-feature-audit.json'
    if original.exists(): baseline = json.loads(original.read_text())['entries']
    elif DOCUMENT.exists(): baseline = json.loads(DOCUMENT.read_text())['entries']
    else: raise SystemExit('Missing screenshot reference inventory: data/artifacts/ref-feature-audit.json or docs/reference-capabilities.json')
    specs = json.loads(CATALOG.read_text()); by_type = {s['type']: s for s in specs}
    lookup = defaultdict(list)
    for spec in specs:
        reference = spec.get('reference') or {}
        family = reference.get('family', spec['family'])
        name = reference.get('name', spec['english'])
        lookup[family, normal(name)].append(spec)
    geometry = ROOT / 'docs/geometry-capabilities.json'
    geometry_entries = {(e['family'], e['reference_name']): e for e in json.loads(geometry.read_text()).get('entries', [])} if geometry.exists() else {}
    browser_artifact = ARTIFACTS / 'reference-top-browser-check.json'
    verified_top = {e['type'] for e in json.loads(browser_artifact.read_text()).get('operators', []) if e.get('ok')} if browser_artifact.exists() else set()
    labels = {'executable_subset':'可运行子集', 'existing_related_subset':'已有相关子集，原缺口未宣称全部消除', 'external_adapter_required':'需要外部SDK/设备适配器，未内置原生实现', 'not_implemented':'未找到对应可执行实现'}
    entries = []
    for old in baseline:
        family, name = old['family'], old['reference_name']
        matches = lookup.get((family, normal(name)), [])
        direct = bool(matches)
        if not matches: matches = [by_type[key] for key in old.get('baseline_local_nodes', old.get('local_nodes', [])) if key in by_type]
        # Merge domain review mappings for legitimate older aliases such as Line SOP.
        review = geometry_entries.get((family, name), {})
        if not matches: matches = [by_type[key] for key in review.get('node_types', []) if key in by_type]
        bridges = [s for s in matches if s.get('reference', {}).get('level') == 'bridge']
        runnable = [s for s in matches if s not in bridges]
        status = 'executable_subset' if direct and runnable else 'existing_related_subset' if runnable else 'external_adapter_required' if bridges else 'not_implemented'
        descriptions = unique(s.get('description') for s in matches)
        limitations = unique(s.get('reference', {}).get('note') for s in matches)
        if review.get('limitations'): limitations.append(review['limitations'])
        if not direct and matches:
            limitations.append('从原0.3审查的相关节点或领域审查关联；有相关能力不代表同名节点和完整原语义已还原。')
            gap = old.get('baseline_gap', old.get('gap'))
            if gap: limitations.append('原审查差距（未因关联自动视为解决）：' + gap)
        if status == 'external_adapter_required':
            limitations.append('只有真实数据交换接口和依赖说明；原生设备/商业SDK驱动没有随项目实现或验证，不能计为已补全。')
        elif status != 'not_implemented':
            limitations.append('独立开放实现；不承诺.toe/.tox兼容、TouchDesigner全部参数、Python对象API或GPU精度/性能等价。')
        else: limitations.append('当前目录和原审查关联均没有可执行路径。')
        if family == 'COMP' and name in ('Button','Field','List','OP Viewer','Parameter','Slider','Table','Text','Widget','Window','Annotate','Select'):
            limitations.append('目前使用浏览器参数控件与Canvas预览，不包含原生桌面窗口管理或完整Panel层级、交互事件与样式系统。')
        if family == 'COMP' and name == 'Time':
            has_rate = any(p['key'] == 'rate' for spec in matches for p in spec.get('params', []))
            limitations.append('具有真实内部时间域、rate/offset/loop变换；不含完整原软件时间组件界面和时间切片调度。' if has_rate else '当前目录仍是时间显示面板；不能把面板预览视为完整时间域。')
        if family == 'COMP' and name == 'Animation':
            limitations.append('支持当前目录注明的关键帧/插值子集；不含完整DCC曲线编辑器、所有切线控制与TD动画组件API。')
        if family == 'COMP' and name == 'Replicator':
            limitations.append('内部网络实例数量、作用域和输出类型以当前节点说明为准；不等同于原TD复制回调和所有组件实例机制。')
        if family == 'DAT' and name.endswith('Execute'):
            limitations.append('事件采样/事件表输出不等同于自动执行任意Python回调；Python脚本需显式手动运行。')
        checks = []
        if any(s['type'] in verified_top for s in matches): checks.append('data/artifacts/reference-top-browser-check.json：具体节点在真实Chromium执行，原生设备除外')
        if any(s['type'].startswith('ref_') and s.get('reference', {}).get('level') == 'bridge' for s in matches): checks.append('tests/test_io_runtime.py：通用桥接协议验证；没有对该硬件SDK进行实机验证')
        entries.append({'family':family,'reference_name':name,'status':status,'status_label':labels[status],
            'localTypes':unique(s['type'] for s in matches),'descriptions':descriptions,'limitations':unique(limitations),
            'complete_touchdesigner_equivalence':False,'native_driver_included':False if bridges and not runnable else None,
            'verification':checks,'source_image':old.get('source_image'),
            'baseline_status':old.get('baseline_status',old.get('status')),
            'baseline_local_nodes':old.get('baseline_local_nodes',old.get('local_nodes',[])),
            'baseline_gap':old.get('baseline_gap',old.get('gap',''))})
    counts = dict(Counter(e['status'] for e in entries))
    families = {family:{'total':sum(e['family']==family for e in entries),**dict(Counter(e['status'] for e in entries if e['family']==family))} for family in ['COMP','TOP','CHOP','SOP','MAT','DAT']}
    try: commit = subprocess.check_output(['git','rev-parse','HEAD'], cwd=ROOT, text=True).strip()
    except (OSError, subprocess.CalledProcessError): commit = None
    result = {'generated_at':datetime.now(timezone.utc).isoformat(),'base_commit':commit,'catalog_nodes':len(specs),
        'scope':'ref六张截图的531个可见项；不代表TouchDesigner最新版完整目录。',
        'method':'逐项匹配当前catalog reference元数据、英文名和原审查明确关联。每项均记录实际子集和限制；外部bridge未计为原生实现。数量不是兼容率，注册节点不证明全部原软件语义。',
        'warning':'executable_subset只表示存在所描述的执行路径，不表示完整复刻；existing_related_subset保留原审查缺口；硬件桥接仍需要未内置的驱动/SDK。',
        'total_reference_entries':len(entries),'counts':counts,'families':families,'entries':entries}
    DOCUMENT.parent.mkdir(parents=True, exist_ok=True); ARTIFACTS.mkdir(parents=True, exist_ok=True)
    for path in (DOCUMENT, ARTIFACTS / 'ref-feature-followup.json'):
        path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    lines = ['# 参考节点逐项进度', '',
        f'本次检查六张参考截图的 {len(entries)} 项，项目目录有 {len(specs)} 个入口。节点数量与完整兼容率不是一回事。', '',
        '**可运行子集**表示已有所描述的实际算法；**相关子集**表示沿用已有节点但保留差距；**外部依赖**表示只有数据桥接，原生驱动未内置。', '',
        '| 参考族 | 截图条目 | 可运行子集 | 相关子集 | 外部依赖 |',
        '| --- | ---: | ---: | ---: | ---: |']
    for family, values in families.items():
        lines.append(f"| {family} | {values['total']} | {values.get('executable_subset', 0)} | {values.get('existing_related_subset', 0)} | {values.get('external_adapter_required', 0)} |")
    lines += ['', '每个条目的实现和限制保存在 [完整 JSON 清单](reference-capabilities.json)，算法参数见 [节点手册](NODES.md)。', '',
        '## 仍需要外部 SDK / 设备的条目', '',
        '这些条目尚不能宣称补全。驱动开发使用 [I/O 适配器接口](IO_PROTOCOLS.md)；节点没有收到实际数据时会显示依赖错误。', '',
        '| 族 | 参考名称 | 当前入口 |', '| --- | --- | --- |']
    for entry in entries:
        if entry['status'] == 'external_adapter_required':
            lines.append(f"| {entry['family']} | {entry['reference_name']} | " + ', '.join(f'`{t}`' for t in entry['localTypes']) + ' |')
    lines += ['', '## 保留原差距的相关实现', '', '| 族 | 参考名称 | 本项目实现 | 原审查差距 |', '| --- | --- | --- | --- |']
    for entry in entries:
        if entry['status'] == 'existing_related_subset':
            gap = entry['baseline_gap'].replace('|', '／').replace('\n', ' ')
            lines.append(f"| {entry['family']} | {entry['reference_name']} | " + ', '.join(f'`{t}`' for t in entry['localTypes']) + f' | {gap} |')
    lines += ['', '此外，截图没有列出的文件兼容、POP、完整参数系统、专业音视频与演出同步等差距仍见 [功能矩阵](FEATURE_MATRIX.md)。', '',
        '复现：`node scripts/sync-catalog.mjs` 后运行 `.venv/bin/python scripts/audit-reference-capabilities.py`。不需要分发用户提供的截图。', '']
    (ROOT / 'docs/REFERENCE_COVERAGE.md').write_text('\n'.join(lines))
    with (ARTIFACTS / 'ref-feature-followup.csv').open('w',encoding='utf-8-sig',newline='') as handle:
        writer=csv.DictWriter(handle,fieldnames=['family','reference_name','status','status_label','localTypes','limitations','baseline_status'])
        writer.writeheader()
        for entry in entries: writer.writerow({key:' | '.join(entry[key]) if isinstance(entry[key],list) else entry[key] for key in writer.fieldnames})
    print(json.dumps({'catalog':len(specs),'references':len(entries),'counts':counts,'unmapped':[[e['family'],e['reference_name']] for e in entries if e['status']=='not_implemented']},ensure_ascii=False,indent=2))


if __name__ == '__main__': main()
