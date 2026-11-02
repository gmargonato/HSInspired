"""Read-only Hearthstone extraction for the healing lab; no installation dependency at runtime."""
import argparse
import hashlib
import json
import re
import sys
import struct
from pathlib import Path

sys.dont_write_bytecode = True
parser = argparse.ArgumentParser()
parser.add_argument('--installation', type=Path, default=Path(r'C:\Program Files (x86)\Hearthstone'))
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(args.installation / 'Assets_Extracted/tools'))
from inspect_bundles import unpack
from unity_tree import parse_file

base = args.installation / 'Data/Win'
sources = {}
prefab = None
paths = [base / 'initial_base_global-41caf0cf-prefab-3.unity3d',
         base / 'essential_base_global-material-0.unity3d',
         base / 'essential_base_global-shader-0.unity3d']
paths += sorted(base.glob('initial_base_global-41caf0cf-material-*.unity3d'))
paths += sorted(base.glob('initial_base_global-41caf0cf-mesh-*.unity3d'))
paths += [base / 'essential_base_global-mesh-0.unity3d']
for path in paths:
    files = unpack(path)
    for cab, raw in files.items():
        if cab.endswith(('.resS', '.resource')):
            continue
        objects, external = parse_file(raw, {1, 4, 21, 23, 33, 43, 48, 74, 96, 111, 114, 198, 199})
        source = dict(bundle=path.name, objects={o['path_id']: o for o in objects}, external=external, files=files)
        sources[cab.lower()] = source
        if 'prefab' in path.name:
            prefab = source

manifest = {}
for line in (args.installation / 'Assets_Extracted/card_related/manifest.jsonl').open():
    item = json.loads(line)
    manifest[(item['cab'].lower(), item['path_id'])] = item

def target(source, ref):
    return sources[source['external'][ref['m_FileID'] - 1].split('/')[-1].lower()] if ref['m_FileID'] else source

textures, materials, meshes = {}, {}, {}

def mesh(ref):
    source = target(prefab, ref)
    d = source['objects'][ref['m_PathID']]['data']
    name = d['m_Name']
    if name in meshes:
        return name
    vd = d['m_VertexData']
    raw = vd['m_DataSize']
    if not raw:
        stream = d['m_StreamData']
        raw = source['files'][stream['path'].split('/')[-1]][stream['offset']:stream['offset']+stream['size']]
    channels = vd['m_Channels']
    sizes = {0:4, 1:2, 2:1, 3:1}
    strides = {}
    for c in channels:
        if c['dimension'] & 15:
            strides[c['stream']] = max(strides.get(c['stream'],0),c['offset']+(c['dimension']&15)*sizes[c['format']])
    offsets, offset = {}, 0
    for stream, stride in sorted(strides.items()):
        offsets[stream] = offset
        offset = (offset + stride * vd['m_VertexCount'] + 15) & ~15
    def channel(i, vertex, fallback):
        c = channels[i]
        dim = c['dimension'] & 15
        if not dim:
            return fallback
        value = list(struct.unpack_from('<'+{0:'f',1:'e',2:'B',3:'b'}[c['format']]*dim, raw, offsets[c['stream']]+vertex*strides[c['stream']]+c['offset']))
        return [v/255 for v in value] if c['format']==2 else value
    vertices = [channel(0,i,[0,0,0])+channel(1,i,[0,1,0])+channel(3,i,[1,1,1,1]) for i in range(vd['m_VertexCount'])]
    fmt = 'H' if d['m_IndexFormat']==0 else 'I'
    indices = list(struct.unpack('<'+fmt*(len(d['m_IndexBuffer'])//struct.calcsize(fmt)),d['m_IndexBuffer']))
    meshes[name] = dict(vertices=vertices,indices=indices,source=dict(bundle=source['bundle'],pathId=str(ref['m_PathID'])))
    return name
TEXTURE_NAMES = {
    'GenFX_FlareStarWhite': 'heal-rays', 'GenFX_ShockwaveMed4': 'heal-mass-wave',
    'GenFX_flare09': 'heal-glow', 'GenFX_Star_06': 'heal-star',
    'GenFX_HolyBeam': 'heal-beam', 'GenFX_Flare10': 'heal-missile-head',
    'GenFX_GlowSoft3': 'heal-mote', 'GenFX_Trail_Yellow2': 'heal-ribbon',
    'GenFX_CloudsWithMotes4': 'heal-ribbon-clouds', 'GenFX_Trail_Wisp': 'heal-ribbon-wisp',
    'GenFX_star1_large': 'heal-sparkle', 'GenFX_CloudsWithMotes': 'heal-bloom-clouds',
    'GenFX_Shockwave2': 'heal-bloom-wave', 'GenFX_HolyRings2': 'heal-runes',
    'GenFX_Ring_Crescents_02': 'heal-rings', 'GenFX_Star_06_Glow': 'heal-star-glow'
}
TEXTURE_NAMES = {k.lower(): v for k, v in TEXTURE_NAMES.items()}
def material(ref):
    source = target(prefab, ref)
    d = source['objects'][ref['m_PathID']]['data']
    name = d['m_Name']
    if name in materials:
        return name
    shader_source = target(source, d['m_Shader'])
    shader = shader_source['objects'][d['m_Shader']['m_PathID']]['data']['m_ParsedForm']
    saved = d['m_SavedProperties']
    maps = {}
    for entry in saved['m_TexEnvs']:
        r = entry['second']['m_Texture']
        if not r['m_PathID']:
            continue
        cab = source['external'][r['m_FileID'] - 1].split('/')[-1].lower()
        item = manifest.get((cab, r['m_PathID']))
        if not item:
            raise ValueError('Unresolved texture: ' + str(r))
        key = TEXTURE_NAMES[item['name'].lower()]
        filename = 'images/effects/' + key + '.png'
        payload = (args.installation / 'Assets_Extracted/card_related' / item['png']).read_bytes()
        assert hashlib.sha256(payload).hexdigest() == item['png_sha256']
        destination = root / 'assets' / filename
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(payload)
        textures[key] = dict(file=filename, width=item['width'], height=item['height'],
                             bundle=item['source'], pathId=str(item['path_id']), sha256=item['png_sha256'])
        maps[entry['first']] = dict(key=key, scale=list(entry['second']['m_Scale'].values()),
                                   offset=list(entry['second']['m_Offset'].values()))
    active = {p['m_Name'] for p in shader['m_PropInfo']['m_Props']}
    materials[name] = dict(shader=shader['m_Name'], textures=maps,
        floats={p['first']: p['second'] for p in saved['m_Floats'] if p['first'] in active},
        colors={p['first']: list(p['second'].values()) for p in saved['m_Colors'] if p['first'] in active},
        source=dict(bundle=source['bundle'], pathId=str(ref['m_PathID'])))
    return name

def curve(c):
    def keys(x):
        return [[k['time'], k['value'], k['inSlope'], k['outSlope']] for k in x['m_Curve']]
    return dict(mode=c['minMaxState'], min=c['minScalar'], max=c['scalar'],
                lower=keys(c['minCurve']), upper=keys(c['maxCurve']))

def gradient(g):
    return dict(rgb=[[g['ctime'+str(i)]/65535] + [g['key'+str(i)][k] for k in 'rgb'] for i in range(g['m_NumColorKeys'])],
                alpha=[[g['atime'+str(i)]/65535, g['key'+str(i)]['a']] for i in range(g['m_NumAlphaKeys'])])

def color(c):
    return dict(mode=c['minMaxState'], min=list(c['minColor'].values()), max=list(c['maxColor'].values()),
                lower=gradient(c['minGradient']), upper=gradient(c['maxGradient']))

def nodes(ident):
    result = []
    action = None
    for r in prefab['objects'][ident]['data']['m_Component']:
        d = prefab['objects'].get(r['component']['m_PathID'], {}).get('data', {})
        for state in d.get('fsm', {}).get('states', []):
            if state['name'] == 'ActionState':
                action = state['actionData']
    properties = action.get('fsmPropertyParams', []) if action else []
    def properties_for(go, type_id):
        ids = {r['component']['m_PathID'] for r in go['m_Component']
               if prefab['objects'].get(r['component']['m_PathID'], {}).get('type') == type_id}
        return [p for p in properties if p['TargetObject']['value']['m_PathID'] in ids]
    def action_curve(index):
        return [[k['time'], k['value'], k['inSlope'], k['outSlope']]
                for k in action['animationCurveParams'][index]['curve']['m_Curve']]
    def visit(gid, path):
        go = prefab['objects'][gid]['data']
        cs = {o['type']: o['data'] for r in go['m_Component']
              if (o := prefab['objects'].get(r['component']['m_PathID']))}
        tr = cs[4]
        path += '/' + go['m_Name']
        node = dict(name=go['m_Name'], path=path, position=list(tr['m_LocalPosition'].values()),
                    scale=list(tr['m_LocalScale'].values()), rotation=list(tr['m_LocalRotation'].values()))
        for t in [23, 96, 199]:
            if t in cs:
                node['materials'] = [material(r) for r in cs[t]['m_Materials'] if r['m_PathID']]
        if 33 in cs:
            node['mesh'] = mesh(cs[33]['m_Mesh'])
        for r in go['m_Component']:
            extra = prefab['objects'].get(r['component']['m_PathID'], {}).get('data', {})
            if 'RotateSpeedY' in extra:
                node['spinY'] = extra['RotateSpeedY']
        if 198 in cs:
            p = cs[198]
            initial = p['InitialModule']
            node['particle'] = dict(duration=p['lengthInSec'], delay=curve(p['startDelay']),
                life=curve(initial['startLifetime']), size=curve(initial['startSize']),
                speed=curve(initial['startSpeed']), color=color(initial['startColor']),
                rotation=curve(initial['startRotation']),
                spin=curve(p['RotationModule']['curve']) if p['RotationModule']['enabled'] else None,
                mesh=mesh(p['ShapeModule']['m_Mesh']) if p['ShapeModule']['enabled'] and p['ShapeModule']['type']==6 else None,
                randomDirection=p['ShapeModule']['randomDirectionAmount'],
                colorOverLife=color(p['ColorModule']['gradient']) if p['ColorModule']['enabled'] else None,
                sizeOverLife=curve(p['SizeModule']['curve']) if p['SizeModule']['enabled'] else None,
                rate=curve(p['EmissionModule']['rateOverTime']) if p['EmissionModule']['enabled'] else None,
                bursts=[[b['time'], b['countCurve']['scalar']] for b in p['EmissionModule']['m_Bursts']] if p['EmissionModule']['enabled'] else [],
                radius=p['ShapeModule']['radius']['value'])
            for prop in properties_for(go, 198):
                if prop['PropertyName'] == 'emissionRate':
                    parameter = prop['FloatParameter']
                    if parameter['name'] == 'particleEmission':
                        node['particle']['actionRate'] = action_curve(0)
                    elif not parameter['useVariable']:
                        node['particle']['rate'] = dict(mode=0,min=0,max=parameter['value'],lower=[],upper=[])
        if 96 in cs:
            trail = cs[96]
            node['trail'] = dict(life=trail['m_Time'], width=trail['m_Parameters']['widthMultiplier'],
                                color=gradient(trail['m_Parameters']['colorGradient']))
            for prop in properties_for(go, 96):
                if prop['PropertyName'] == 'time':
                    node['trail']['life'] = prop['FloatParameter']['value']
                if prop['PropertyName'] == 'startWidth' and prop['FloatParameter']['name'] == 'TrialWidth':
                    node['trail']['widthCurve'] = action_curve(1)
        result.append(node)
        for r in tr['m_Children']:
            visit(prefab['objects'][r['m_PathID']]['data']['m_GameObject']['m_PathID'], path)
    visit(ident, '')
    return dict(source=dict(bundle=prefab['bundle'], pathId=str(ident)), nodes=result)

effects = {key: nodes(ident) for key, ident in {
    'mass': -837252036210715401,
    'target': -8240196176881754326,
    'bloom': -749417760525018877
}.items()}
output = root / 'src/visual-components/effects/healing-authored.json'
output.write_text(json.dumps(dict(effects=effects, materials=materials, textures=textures, meshes=meshes),
                            separators=(',', ':'), default=lambda x: list(x)) + '\n')
print(json.dumps(dict(materials=materials, textures=list(textures)), indent=2))
