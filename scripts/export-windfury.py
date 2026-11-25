"""Reproduce Windfury assets from the installed Unity bundles; installation is read-only."""
import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

sys.dont_write_bytecode = True
parser = argparse.ArgumentParser()
parser.add_argument('--installation', type=Path, default=Path(r'C:\Program Files (x86)\Hearthstone'))
installation = parser.parse_args().installation
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(installation / 'Assets_Extracted/tools'))
import inspect_bundles as reader
from native_codec import lz4
from unity_tree import parse_file
reader.lz4 = lz4
sources = {}
for name in ['initial_base_global-2ebe64b8-prefab-2', 'initial_base_global-2ebe64b8-prefab-5',
             'initial_base_global-1fbc9c0f-prefab-5', 'initial_base_global-1fbc9c0f-prefab-14',
             'initial_base_global-1483ae2c-mesh-0', 'initial_base_global-1483ae2c-material-0',
             'essential_base_global-shader-0']:
    path = installation / 'Data/Win' / (name + '.unity3d')
    for cab, raw in reader.unpack(path).items():
        if cab.endswith(('.resource', '.resS')):
            continue
        objects, externals = parse_file(raw, {1, 4, 21, 23, 33, 43, 48, 74, 111, 114, 198, 199})
        sources[name] = dict(cab=cab, objects={o['path_id']: o for o in objects}, files=reader.unpack(path),
                             bundle=path.name, sha256=hashlib.sha256(path.read_bytes()).hexdigest())

def vec(d):
    return [d[k] for k in 'xyzw' if k in d]

mesh_source = sources['initial_base_global-1483ae2c-mesh-0']
meshes = {}
for ident in [3793679174743347573, 9211365901838940844, -8243252180754819262]:
    d = mesh_source['objects'][ident]['data']; vd = d['m_VertexData']; raw = vd['m_DataSize']
    if not raw:
        stream = d['m_StreamData']
        raw = mesh_source['files'][stream['path'].split('/')[-1]][stream['offset']:stream['offset']+stream['size']]
    strides = {}
    for c in vd['m_Channels']:
        dim = c['dimension'] & 15
        if dim:
            strides[c['stream']] = max(strides.get(c['stream'], 0), c['offset']+dim*{0:4,1:2,2:1}[c['format']])
    offsets = {}; offset = 0
    for stream, stride in sorted(strides.items()):
        offsets[stream] = offset; offset = (offset + stride * vd['m_VertexCount'] + 15) & ~15
    def channel(index, fallback):
        c = vd['m_Channels'][index]; dim = c['dimension'] & 15
        if not dim: return fallback * vd['m_VertexCount']
        values = []
        for i in range(vd['m_VertexCount']):
            v = struct.unpack_from('<'+{0:'f',1:'e',2:'B'}[c['format']]*dim, raw, offsets[c['stream']]+i*strides[c['stream']]+c['offset'])
            v = v[:3] if index==1 else v
            values.extend([x/255 for x in v] if c['format']==2 else v)
        return values
    fmt = 'H' if d['m_IndexFormat']==0 else 'I'
    meshes[str(ident)] = dict(name=d['m_Name'], positions=channel(0,[0,0,0]), normals=channel(1,[0,1,0]),
        colors=channel(3,[1,1,1,1]), uvs=channel(4,[0,0]), indices=list(struct.unpack('<'+fmt*(len(d['m_IndexBuffer'])//struct.calcsize(fmt)),d['m_IndexBuffer'])))

clips = {}
for source in sources.values():
    for o in source['objects'].values():
        d = o.get('data', {})
        if o['type']==74 and 'WindFury' in d['m_Name']:
            clips[d['m_Name']] = [dict(path=c['path'], attribute=c['attribute'], keys=[
                [k[n] for n in ['time','value','inSlope','outSlope']] for k in c['curve']['m_Curve']]) for c in d['m_FloatCurves']]

prefabs = {}
for source in sources.values():
    objects = source['objects']
    def walk(goid):
        go = objects[goid]['data']; components = [objects[c['component']['m_PathID']] for c in go['m_Component']]
        transform = next(c['data'] for c in components if c['type']==4)
        node = dict(name=go['m_Name'], position=vec(transform['m_LocalPosition']), scale=vec(transform['m_LocalScale']),
                    rotation=vec(transform['m_LocalRotation']), children=[])
        for c in components:
            d = c['data']
            if c['type']==33: node['mesh'] = str(d['m_Mesh']['m_PathID'])
            if c['type']==198: node['particles'] = {k:v for k,v in d.items() if k.endswith('Module') and isinstance(v,dict) and v.get('enabled')}
        for child in transform['m_Children']:
            node['children'].append(walk(objects[child['m_PathID']]['data']['m_GameObject']['m_PathID']))
        return node
    for o in objects.values():
        if o['type']==1 and o.get('data',{}).get('m_Name','').startswith(('Card_Play_Ally_WindFury_', 'Card_Play_Hero_WindFury_')):
            prefabs[o['data']['m_Name']] = walk(o['path_id'])

textures = {}
for line in (installation/'Assets_Extracted/card_related/manifest.jsonl').open():
    d = json.loads(line)
    if (d['name'], d['path_id']) not in [('wind1',-907863458709744939),('GenFX_moteB',-8850088658648382506)]: continue
    data = (installation/'Assets_Extracted/card_related'/d['png']).read_bytes()
    assert hashlib.sha256(data).hexdigest()==d['png_sha256']
    filename = 'windfury-wind.png' if d['name']=='wind1' else 'windfury-mote.png'
    (root/'assets/images/effects'/filename).write_bytes(data)
    textures[d['name']] = dict(file=filename, sha256=d['png_sha256'], pathId=str(d['path_id']), bundle=d['source'])
materials = {}
for o in sources['initial_base_global-1483ae2c-material-0']['objects'].values():
    d = o.get('data', {})
    if o['type']==21 and d.get('m_Name') in ['FX_Wind1','FX_WindBurst','FX_Leaf1']:
        saved = d['m_SavedProperties']
        materials[d['m_Name']] = dict(floats={v['first']:v['second'] for v in saved['m_Floats']}, colors={v['first']:v['second'] for v in saved['m_Colors']})
result = dict(meshes=meshes, clips=clips, prefabs=prefabs, textures=textures, materials=materials,
    sources=[dict(bundle=s['bundle'],sha256=s['sha256']) for s in sources.values()])
(root/'src/visual-components/effects/windfury-authored.json').write_text(json.dumps(result,indent=2)+'\n')
print('Exported',len(meshes),'meshes,',len(clips),'clips,',len(prefabs),'prefabs')
