"""Read installed Unity motion data. Never writes to the source installation."""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True
parser = argparse.ArgumentParser()
parser.add_argument('--installation', type=Path, default=Path(r'C:\Program Files (x86)\Hearthstone'))
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
evidence = root / '.tmp/card-motion-source'
evidence.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(args.installation / 'Assets_Extracted/tools'))
from inspect_bundles import unpack
from unity_tree import parse_file

clips = {}
sources = []
anchors = {}
clip_names = {'MulliganCardFlipDownToDeck', 'MulliganCardDeck2FlipDown',
              'MulliganCardFlipFromFaceDown', 'MulliganDeckShuffle1'}

def vector(value):
    return [value[k] for k in ('x', 'y', 'z', 'w') if k in value]

def safe(value):
    if isinstance(value, bytes):
        return list(value)
    if isinstance(value, float) and not math.isfinite(value):
        return 'step'
    if isinstance(value, dict):
        return {k: str(v) if k == 'm_PathID' else safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [safe(v) for v in value]
    return value

for name in ['essential_base_global-prefab-0.unity3d', 'essential_base_global-mesh-0.unity3d',
             'essential_base_qualityhigh_global-content-0.unity3d']:
    filename = args.installation / 'Data/Win' / name
    sources.append(dict(bundle=name, sha256=hashlib.sha256(filename.read_bytes()).hexdigest()))
    for cab, data in unpack(filename).items():
        if cab.endswith(('.resS', '.resource')):
            continue
        objects, externals = parse_file(data, {1, 4, 20, 74, 114})
        by_id = {o['path_id']: o for o in objects}
        selected = []
        for obj in objects:
            d = obj.get('data', {})
            label = d.get('m_Name', '')
            if obj['type'] == 74 and label in clip_names:
                tracks = []
                for key, prop in [('m_RotationCurves', 'quaternion'), ('m_PositionCurves', 'position'), ('m_ScaleCurves', 'scale')]:
                    for curve in d[key]:
                        keys = curve['curve']['m_Curve']
                        assert all(k.get('weightedMode', 0) == 0 for k in keys)
                        tracks.append(dict(path=curve['path'], property=prop, keys=[dict(
                            time=k['time'], value=vector(k['value']),
                            inSlope=vector(k['inSlope']), outSlope=vector(k['outSlope'])) for k in keys]))
                clips[label] = dict(duration=max(k['time'] for t in tracks for k in t['keys']),
                                    sampleRate=d['m_SampleRate'], tracks=tracks,
                                    source=dict(bundle=name, pathId=str(obj['path_id'])))
            if obj['type'] == 1 and any(s in label.lower() for s in ('drawcard', 'mulligan', 'zonedeck', 'fatigue')):
                components = [by_id.get(c['component']['m_PathID'], {}) for c in d['m_Component']]
                selected.append(dict(name=label, pathId=str(obj['path_id']), components=components))
                for comp in components:
                    if comp.get('type') == 4:
                        anchors[label] = {k: vector(v) for k, v in comp['data'].items() if k in ('m_LocalPosition', 'm_LocalRotation', 'm_LocalScale')}
            if obj['type'] == 114 and any(s in json.dumps(d, default=str).lower() for s in ('drawcard', 'carddraw', 'handtodeck')):
                selected.append(dict(pathId=str(obj['path_id']), component=d))
        (evidence / (name + '.json')).write_text(json.dumps(safe(dict(cab=cab, externals=externals, objects=selected)), indent=2))
result = safe(dict(sources=sources, anchors=anchors, clips=clips))
(evidence / 'curves.json').write_text(json.dumps(result, indent=2))
(root / 'src/scenes/match/presentation/card-motion-authored.json').write_text(json.dumps(safe(dict(sources=sources, clips=clips)), indent=2) + '\n')
print(json.dumps(dict(clips={k: v['duration'] for k, v in clips.items()}, anchors=list(anchors)), indent=2))
