#!/usr/bin/env python3
"""Read-only audit for PcbToJson v0.9.3 ANTI/THERMAL BBOX records."""
import argparse
import collections
import json
from pathlib import Path


def audit(data):
    pins = {p.get('id') for p in data.get('pins', [])}
    vias = {v.get('id') for v in data.get('vias', [])}
    layers = {l['allegro_layer'] for l in data.get('layers', [])}
    kinds = collections.Counter()
    shapes = collections.Counter()
    layer_kinds = collections.Counter()
    duplicates = []
    invalid = []
    missing_owner = []
    seen = set()
    records = data.get('padstack_diagnostics', [])
    for i, d in enumerate(records):
        owner = d.get('owner_id')
        owner_type = d.get('owner_type')
        kind = d.get('kind')
        layer = d.get('layer')
        key = (owner_type, owner, layer, kind)
        if key in seen:
            duplicates.append({'index': i, 'key': key})
        seen.add(key)
        size = d.get('size') or []
        pos = d.get('position') or []
        if (kind not in ('ANTI', 'THERMAL') or layer not in layers or
            len(size) != 2 or not all(isinstance(v, (float, int)) and v > 0 for v in size) or
            len(pos) != 2 or not all(isinstance(v, (float, int)) for v in pos) or
            d.get('shape') in (None, 'NULL')):
            invalid.append(i)
        if owner not in (pins if owner_type == 'pin' else vias if owner_type == 'via' else set()):
            missing_owner.append(i)
        kinds[(owner_type, kind)] += 1
        shapes[(kind, str(d.get('shape')))] += 1
        layer_kinds[(layer, kind)] += 1
    return {
        'total': len(records),
        'kind_counts': {f'{a}/{b}': n for (a, b), n in sorted(kinds.items())},
        'shape_counts': {f'{a}/{b}': n for (a, b), n in sorted(shapes.items())},
        'layer_kind_counts': {f'{a}/{b}': n for (a, b), n in sorted(layer_kinds.items())},
        'duplicates_count': len(duplicates), 'duplicate_examples': duplicates[:20],
        'invalid_count': len(invalid), 'invalid_examples': invalid[:20],
        'missing_owner_count': len(missing_owner), 'missing_owner_examples': missing_owner[:20],
        'status': 'needs_allegro_geometry_verification' if not (duplicates or invalid or missing_owner) else 'structure_errors',
        'note': 'Positive-size bounding boxes do not prove ANTI clearance or THERMAL spoke geometry, polarity, or film effects.'
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('json_file', type=Path)
    parser.add_argument('--output', type=Path, default=Path('padstack_audit.json'))
    args = parser.parse_args()
    data = json.loads(args.json_file.read_text(encoding='utf-8'))
    report = audit(data)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in report.items() if k in ('total', 'kind_counts', 'duplicates_count', 'invalid_count', 'missing_owner_count', 'status')}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
