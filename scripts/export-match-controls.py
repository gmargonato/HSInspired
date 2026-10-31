"""Export the two installed Unity controls; never writes into the installation.

Uses the user's existing read-only UnityFS/type-tree readers. No Unity runtime.
Preserves source coordinates and cubic curve tangents for the viewer to convert.
"""
import argparse
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

sys.dont_write_bytecode = True
parser = argparse.ArgumentParser()
parser.add_argument('--installation', type=Path, default=Path(r'C:\Program Files (x86)\Hearthstone'))
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
output = root / 'assets/models/match'
output.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(args.installation / 'Assets_Extracted/tools'))
from inspect_bundles import unpack
from unity_tree import parse_file

bundles = {}
sources = {}
for name in ['essential_base_global-mesh-0', 'essential_base_global-material-0',
             'essential_base_global-prefab-0', 'essential_base_qualityhigh_global-content-0',
             'initial_base_global-910a3655-mesh-0', 'initial_base_global-75c96a85-material-0']:
    filename = name + '.unity3d'
    path = args.installation / 'Data/Win' / filename
    files = unpack(path)
    for cab, data in files.items():
        if cab.endswith(('.resS', '.resource')):
            continue
        objects, externals = parse_file(data, {1, 4, 21, 23, 33, 43, 74, 114})
        source = dict(name=filename, cab=cab, objects={o['path_id']: o for o in objects},
                      externals=externals, files=files)
        sources[name] = source
        bundles[cab.lower()] = source

prefab = sources['essential_base_global-prefab-0']
manifest = {}
for line in (args.installation / 'Assets_Extracted/card_related/manifest.jsonl').open():
    item = json.loads(line)
    manifest[(item['cab'].lower(), item['path_id'])] = item


def ref_source(source, ref):
    cab = source['externals'][ref['m_FileID'] - 1].split('/')[-1] if ref['m_FileID'] else source['cab']
    return cab.lower()


def resolve(source, ref):
    target = bundles[ref_source(source, ref)]
    obj = target['objects'][ref['m_PathID']]
    if 'error' in obj:
        raise ValueError(obj['error'])
    return target, obj['data']


def vec(value):
    return [value[k] for k in ('x', 'y', 'z', 'w') if k in value]


TEXTURE_FILES = {
    'Board_EndTurnButton': 'images/match/end-turn-button-diffuse.png',
    'GenFX_Gem_Mana_D': 'images/heroes/hero-power-mana-diffuse.png',
    'GenFX_clouds03': 'images/heroes/hero-power-mana-clouds.png',
    'Hero_Power_Frame': 'images/heroes/hero-power-frame-diffuse.png',
    'GenFX_white32x32': 'images/heroes/hero-power-white.png',
    'Hero_Power_D': 'images/heroes/hero-power-back-diffuse.png',
    'Hero_Power_Frame_Golden': 'images/heroes/hero-power-frame-premium-diffuse.png',
    'Hero_Power_D_Gold': 'images/heroes/hero-power-back-premium-diffuse.png',
    'Hero_Power_Frame_Golden_Specular': 'images/heroes/hero-power-frame-premium-specular.png',
    'Hero_Power_S_Gold': 'images/heroes/hero-power-back-premium-specular.png',
    'GenFX_clouds7': 'images/heroes/hero-power-premium-reflection.png'
}
textures = {}
materials = {}
meshes = {}


def texture(source, ref):
    if not ref['m_PathID']:
        return None
    item = manifest[(ref_source(source, ref), ref['m_PathID'])]
    path = args.installation / 'Assets_Extracted/card_related' / item['png']
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    assert digest == item['png_sha256'], 'Extracted texture hash mismatch'
    name = item['name']
    filename = TEXTURE_FILES[name]
    destination = root / 'assets' / filename
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)
    textures[name] = dict(file=filename, sha256=digest, bundle=item['source'], pathId=str(item['path_id']))
    return name


def material(source, ref):
    source, d = resolve(source, ref)
    name = d['m_Name']
    if name in materials:
        return name
    saved = d['m_SavedProperties']
    materials[name] = dict(
        textures={e['first']: dict(name=texture(source, e['second']['m_Texture']),
                                  scale=vec(e['second']['m_Scale']), offset=vec(e['second']['m_Offset']))
                  for e in saved['m_TexEnvs']},
        floats={e['first']: e['second'] for e in saved['m_Floats']},
        colors={e['first']: list(e['second'].values()) for e in saved['m_Colors']},
        source=dict(bundle=source['name'], pathId=str(ref['m_PathID']),
                    shader=dict(fileId=d['m_Shader']['m_FileID'], pathId=str(d['m_Shader']['m_PathID']))))
    return name


def mesh(source, ref):
    source, d = resolve(source, ref)
    name = d['m_Name']
    if name in meshes:
        return name
    assert d['m_MeshCompression'] == 0
    vd = d['m_VertexData']
    count = vd['m_VertexCount']
    raw = vd['m_DataSize']
    if not raw:
        stream = d['m_StreamData']
        raw = source['files'][stream['path'].split('/')[-1]][stream['offset']:stream['offset'] + stream['size']]
    channels = vd['m_Channels']
    sizes = {0: 4, 1: 2}
    assert all(c['stream'] == 0 for c in channels if c['dimension'] & 15)
    stride = max(c['offset'] + (c['dimension'] & 15) * sizes[c['format']] for c in channels if c['dimension'] & 15)
    assert len(raw) >= stride * count

    def channel(index, dimensions):
        c = channels[index]
        assert c['dimension'] & 15 >= dimensions
        fmt = '<' + ('f' if c['format'] == 0 else 'e') * dimensions
        return [v for i in range(count) for v in struct.unpack_from(fmt, raw, stride * i + c['offset'])]

    index_size = 2 if d['m_IndexFormat'] == 0 else 4
    indices = list(struct.unpack('<' + ('H' if index_size == 2 else 'I') * (len(d['m_IndexBuffer']) // index_size), d['m_IndexBuffer']))
    groups = []
    for i, sub in enumerate(d['m_SubMeshes']):
        assert sub['topology'] == 0 and sub['baseVertex'] == 0
        groups.append(dict(start=sub['firstByte'] // index_size, count=sub['indexCount'], material=i))
    assert all(0 <= i < count for i in indices)
    positions = channel(0, 3)
    assert all(math.isfinite(v) for v in positions)
    # Independently verify stream decoding against Unity's recorded bounding box.
    for axis, label in enumerate('xyz'):
        low, high = min(positions[axis::3]), max(positions[axis::3])
        bounds = d['m_LocalAABB']
        assert abs((low + high) / 2 - bounds['m_Center'][label]) < 0.001
        assert abs((high - low) / 2 - bounds['m_Extent'][label]) < 0.001
    meshes[name] = dict(positions=positions, normals=channel(1, 3), uv=channel(4, 2),
                        indices=indices, groups=groups,
                        source=dict(bundle=source['name'], pathId=str(ref['m_PathID']), vertices=count, triangles=len(indices) // 3))
    return name


def nodes(root_id, wanted):
    result = []

    def visit(gid, path):
        go = prefab['objects'][gid]['data']
        components = [prefab['objects'][r['component']['m_PathID']] for r in go['m_Component']
                      if r['component']['m_PathID'] in prefab['objects']]
        cs = {c['type']: c['data'] for c in components}
        tr = cs[4]
        node = dict(name=go['m_Name'], path=path, position=vec(tr['m_LocalPosition']),
                    quaternion=vec(tr['m_LocalRotation']), scale=vec(tr['m_LocalScale']))
        if path == '':
            node.update(position=[0, 0, 0], quaternion=[0, 0, 0, 1], scale=[1, 1, 1])
        if 33 in cs:
            node['mesh'] = mesh(prefab, cs[33]['m_Mesh'])
            node['materials'] = [material(prefab, r) for r in cs[23]['m_Materials']]
        text = next((c['data'] for c in components if 'm_Text' in c['data']), None)
        if text:
            node['text'] = dict(value=text['m_Text'], width=text['m_Width'], height=text['m_Height'])
        result.append(node)
        for r in tr['m_Children']:
            child_id = prefab['objects'][r['m_PathID']]['data']['m_GameObject']['m_PathID']
            child_name = prefab['objects'][child_id]['data']['m_Name']
            if child_name in wanted:
                visit(child_id, (path + '/' + child_name).lstrip('/'))

    visit(root_id, '')
    return result


controls = dict(
    endTurn=nodes(-1658026854451039644, {'MyTurnText', 'WaitingText'}),
    heroPower=nodes(-8408782285185036916, {'RootObject', 'Mesh', 'Gem_Mana', 'CostUberText'}))
# Premium uses different geometry, including the leaves mapped into the atlas centre.
mesh(sources['initial_base_global-910a3655-mesh-0'], dict(m_FileID=0, m_PathID=843499128365325364))
material(sources['initial_base_global-75c96a85-material-0'], dict(m_FileID=0, m_PathID=-8353866589224058363))
clips = {}
for source in [prefab, sources['essential_base_qualityhigh_global-content-0']]:
    for ident, obj in source['objects'].items():
        d = obj.get('data', {})
        name = d.get('m_Name', '')
        if obj['type'] != 74 or name not in ['ENDTURN_WAITING', 'ENDTURN_YOUR_TURN', 'ENDTURN_PRESSED', 'ENDTURN_PRESSED_DOWN', 'ENDTURN_PRESSED_UP', 'HeroPower_Used', 'HeroPower_Restore']:
            continue
        tracks = []
        for key, property_name in [('m_RotationCurves', 'quaternion'), ('m_PositionCurves', 'position'), ('m_ScaleCurves', 'scale'), ('m_FloatCurves', 'float')]:
            for curve in d[key]:
                if property_name == 'float' and curve['attribute'].startswith('m_LocalEulerAnglesHint'):
                    continue  # Editor hints are not an additional rotation track.
                keys = curve['curve']['m_Curve']
                assert all(k.get('weightedMode', 0) == 0 for k in keys), 'Weighted curves need a different evaluator'
                tracks.append(dict(path=curve['path'], property=property_name, attribute=curve.get('attribute'),
                                   keys=[dict(time=k['time'], value=vec(k['value']) if isinstance(k['value'], dict) else k['value'],
                                              inSlope=vec(k['inSlope']) if isinstance(k['inSlope'], dict) else k['inSlope'],
                                              outSlope=vec(k['outSlope']) if isinstance(k['outSlope'], dict) else k['outSlope']) for k in keys]))
        clips[name] = dict(tracks=tracks, duration=max(k['time'] for t in tracks for k in t['keys']),
                           sampleRate=d['m_SampleRate'], wrapMode=d['m_WrapMode'],
                           animationRoot='ButtonContainer' if name in ['ENDTURN_PRESSED_DOWN', 'ENDTURN_PRESSED_UP'] else 'ButtonContainer/ButtonMesh' if name.startswith('ENDTURN') else 'Card_Play_HeroPower',
                           source=dict(bundle=source['name'], pathId=str(ident)))

# Copy the premium diffuse textures using the same verified manifest records.
for name in ['Hero_Power_Frame_Golden', 'Hero_Power_D_Gold', 'Hero_Power_S_Gold']:
    matches = [item for item in manifest.values() if item['name'] == name]
    assert len(matches) == 1, name
    item = matches[0]
    payload = (args.installation / 'Assets_Extracted/card_related' / item['png']).read_bytes()
    assert hashlib.sha256(payload).hexdigest() == item['png_sha256']
    destination = root / 'assets' / TEXTURE_FILES[name]
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(payload)
    textures[name] = dict(file=TEXTURE_FILES[name], sha256=item['png_sha256'], bundle=item['source'], pathId=str(item['path_id']))

# Serialize nonfinite step tangents explicitly; JSON itself cannot contain Infinity.
def safe(value):
    if isinstance(value, float) and not math.isfinite(value):
        return 'step'
    if isinstance(value, list):
        return [safe(v) for v in value]
    if isinstance(value, dict):
        return {k: safe(v) for k, v in value.items()}
    return value

result = safe(dict(controls=controls, meshes=meshes, materials=materials, textures=textures, clips=clips))
(output / 'match-controls.json').write_text(json.dumps(result, separators=(',', ':'), allow_nan=False) + '\n')
print(json.dumps(dict(meshes={k: v['source'] for k, v in meshes.items()},
                      nodes={k: [n['path'] for n in v] for k, v in controls.items()},
                      clips={k: v['duration'] for k, v in clips.items()}, textures=list(textures)), indent=2))
