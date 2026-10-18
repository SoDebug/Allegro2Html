#!/usr/bin/env python3
"""Read-only quality audit for v0.9.2 drill definitions. Never merges/modifies PCB JSON."""
import argparse, json
from collections import Counter
from pathlib import Path


def audit(doc):
    stats = {'vias': len(doc.get('vias', [])), 'pins': len(doc.get('pins', [])),
             'via_drills_present': 0, 'pin_drills_present': 0,
             'via_round_positive': 0, 'via_slot_candidates': 0,
             'via_missing_or_zero_drill': 0, 'through_pins_missing_or_zero_drill': 0,
             'drill_by_padstack': {}, 'warnings': []}
    sizes = Counter()
    for group in ('vias', 'pins'):
        for obj in doc.get(group, []):
            drill = obj.get('drill') or {}
            if isinstance(drill, dict) and drill:
                stats['via_drills_present' if group == 'vias' else 'pin_drills_present'] += 1
            dia = drill.get('diameter')
            size = drill.get('size') or []
            w = size[0] if len(size)>0 else None
            h = size[1] if len(size)>1 else None
            usable = (isinstance(dia,(int,float)) and dia>0) or (isinstance(w,(int,float)) and w>0 and isinstance(h,(int,float)) and h>0)
            if group=='vias':
                if not usable: stats['via_missing_or_zero_drill'] += 1
                elif w and h and abs(w-h)>1e-6: stats['via_slot_candidates'] += 1
                else: stats['via_round_positive'] += 1
                if usable: sizes[(str(obj.get('padstack')),dia,w,h)] += 1
            elif obj.get('through') and not usable:
                stats['through_pins_missing_or_zero_drill'] += 1
    stats['drill_by_padstack'] = {str(k):n for k,n in sizes.most_common(50)}
    if stats['via_missing_or_zero_drill']:
        stats['warnings'].append('Some vias lack usable drill geometry; do not infer diameter.')
    if stats['via_slot_candidates']:
        stats['warnings'].append('Slots are approximated as rounded rectangles, not drill manufacturing contours.')
    stats['status'] = 'needs_allegro_geometry_verification'
    return stats

if __name__=='__main__':
    pa=argparse.ArgumentParser();pa.add_argument('json');pa.add_argument('--output');args=pa.parse_args()
    result=audit(json.loads(Path(args.json).read_text(encoding='utf-8')))
    output=json.dumps(result,ensure_ascii=False,indent=2)
    if args.output:Path(args.output).write_text(output,encoding='utf-8')
    print(output)
