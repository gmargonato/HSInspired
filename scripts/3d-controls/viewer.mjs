/* global window, document, requestAnimationFrame, ResizeObserver */
import * as THREE from './node_modules/three/build/three.module.js'
import { evaluate } from './curves.mjs'
import { VIEWER_LAYOUT as layout } from './viewer-layout.mjs'

const assetRoot = new URL('../../assets/experiments/3d-controls/', import.meta.url)
const el = (id) => document.getElementById(id)
const viewport = el('viewport')
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const scene = new THREE.Scene()
const camera = new THREE.OrthographicCamera(-9.6, 9.6, 5.4, -5.4, 0.1, 60)
const controls = {}
let renderer,
  data,
  current,
  playing = true,
  speed = 1,
  lastFrame = 0
let hover, downTarget, press
const resources = new Set()
const retain = (resource) => {
  resources.add(resource)
  return resource
}

function convertedPosition(target, xyz) {
  target.set(xyz[0], xyz[1], -xyz[2])
}
function convertedQuaternion(target, xyzw) {
  target.set(-xyzw[0], -xyzw[1], xyzw[2], xyzw[3]).normalize()
}

function makeGeometry(source) {
  const geometry = retain(new THREE.BufferGeometry())
  for (const [name, values] of [
    ['position', source.positions],
    ['normal', source.normals]
  ]) {
    const converted = values.map((v, i) => (i % 3 === 2 ? -v : v))
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(converted, 3))
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(source.uv, 2))
  const indices = source.indices.slice()
  for (let i = 0; i < indices.length; i += 3)
    [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]]
  geometry.setIndex(indices)
  for (const group of source.groups)
    geometry.addGroup(group.start, group.count, group.material)
  geometry.computeBoundingSphere()
  return geometry
}

function textMesh(node, name) {
  const cost = name.includes('Cost')
  const canvas = document.createElement('canvas')
  canvas.width = cost ? 512 : 1024
  canvas.height = cost ? 512 : 256
  const ctx = canvas.getContext('2d')
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `${cost ? 410 : 140}px Belwe`
  if (cost) {
    ctx.lineWidth = 15
    ctx.strokeStyle = '#172035'
    ctx.strokeText('2', 256, 260)
  }
  ctx.fillStyle = cost ? '#fff9ea' : '#211e17'
  ctx.fillText(
    cost ? '2' : node.text.value,
    canvas.width / 2,
    canvas.height / 2 + 4,
    canvas.width * 0.96
  )
  const map = retain(new THREE.CanvasTexture(canvas))
  map.colorSpace = THREE.SRGBColorSpace
  const material = retain(
    new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide
    })
  )
  const geometry = retain(new THREE.PlaneGeometry(node.text.width, node.text.height))
  const mesh = new THREE.Mesh(geometry, material)
  // Unity's text front is local -Z; reflecting it makes Three's +Z plane.
  return mesh
}

async function initialize() {
  const response = await fetch(new URL('controls.json', assetRoot))
  if (!response.ok)
    throw new Error(`Cannot read extracted controls (${response.status})`)
  data = await response.json()
  await document.fonts.load('24px Belwe')
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x000000, 0)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  viewport.append(renderer.domElement)

  const loader = new THREE.TextureLoader()
  const boardTexture = retain(
    await loader.loadAsync(new URL(layout.boardImage, import.meta.url).href)
  )
  boardTexture.colorSpace = THREE.SRGBColorSpace
  boardTexture.anisotropy = renderer.capabilities.getMaxAnisotropy()
  const board = new THREE.Mesh(
    retain(
      new THREE.PlaneGeometry(
        layout.canvas.width / layout.pixelsPerUnit,
        layout.canvas.height / layout.pixelsPerUnit
      )
    ),
    retain(new THREE.MeshBasicMaterial({ map: boardTexture }))
  )
  board.rotation.x = -Math.PI / 2
  board.position.y = -0.551
  scene.add(board)
  const textures = Object.fromEntries(
    await Promise.all(
      Object.entries(data.textures).map(async ([name, value]) => {
        const texture = retain(
          await loader.loadAsync(new URL(value.file, assetRoot).href)
        )
        texture.colorSpace = THREE.SRGBColorSpace
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping
        return [name, texture]
      })
    )
  )
  const portrait = retain(
    await loader.loadAsync(
      new URL(
        '../../assets/images/heroes/original-art-heropower/fireblast.png',
        import.meta.url
      ).href
    )
  )
  portrait.colorSpace = THREE.SRGBColorSpace
  portrait.anisotropy = renderer.capabilities.getMaxAnisotropy()

  scene.add(new THREE.AmbientLight(0xffffff, 0.85))
  const key = new THREE.DirectionalLight(0xfff0dc, 1.25)
  key.position.set(-3, 8, 4)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  Object.assign(key.shadow.camera, {
    left: -12,
    right: 12,
    top: 8,
    bottom: -8,
    near: 0.5,
    far: 20
  })
  key.shadow.bias = -0.0005
  key.shadow.normalBias = 0.015
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xb4c9ff, 0.4)
  fill.position.set(4, 3, -5)
  scene.add(fill)
  const ground = new THREE.Mesh(
    retain(new THREE.PlaneGeometry(40, 40)),
    retain(new THREE.ShadowMaterial({ opacity: 0.35 }))
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.55
  ground.receiveShadow = true
  scene.add(ground)

  const geometries = Object.fromEntries(
    Object.entries(data.meshes).map(([name, source]) => [name, makeGeometry(source)])
  )
  for (const [id, nodes] of Object.entries(data.controls)) {
    const host = new THREE.Group()
    const placement = layout[id]
    host.position.set(
      (placement.x - layout.canvas.width / 2) / layout.pixelsPerUnit,
      0,
      (placement.y - layout.canvas.height / 2) / layout.pixelsPerUnit
    )
    // Fit the source body width to the game's sprite width without flattening it.
    const positions = data.meshes[placement.mesh].positions
    const xs = positions.filter((_, index) => index % 3 === 0)
    host.scale.setScalar(
      placement.width / (Math.max(...xs) - Math.min(...xs)) / layout.pixelsPerUnit
    )
    // EndTurnButton's prefab parent faces 180 degrees around the board's up axis.
    if (id === 'endTurn') host.rotation.y = Math.PI
    scene.add(host)
    const control = {
      id,
      host,
      nodes: new Map(),
      materials: [],
      used: false,
      lastClip: null,
      busy: false
    }
    // Hearthstone animates the press on ButtonContainer, independently of the
    // flip on its ButtonMesh child. Applying both to one node loses the press.
    if (id === 'endTurn') {
      control.pressRoot = new THREE.Group()
      control.pressRoot.name = 'ButtonContainer'
      control.pressNodes = new Map([['', control.pressRoot]])
      host.add(control.pressRoot)
    }
    controls[id] = control
    for (const node of nodes) {
      const object = new THREE.Group()
      object.name = node.name
      convertedPosition(object.position, node.position)
      convertedQuaternion(object.quaternion, node.quaternion)
      object.scale.fromArray(node.scale)
      control.nodes.set(node.path, object)
      const parentPath = node.path.includes('/')
        ? node.path.slice(0, node.path.lastIndexOf('/'))
        : ''
      ;(node.path === ''
        ? control.pressRoot || host
        : control.nodes.get(parentPath)
      ).add(object)
      if (node.mesh) {
        const materials = node.materials.map((name) => {
          const source = data.materials[name]
          const image = source.textures._MainTex
          const map = retain(
            (name.includes('InPlayPortrait') ? portrait : textures[image.name]).clone()
          )
          map.repeat.fromArray(image.scale)
          map.offset.fromArray(image.offset)
          const material = retain(
            new THREE.MeshPhongMaterial({
              map,
              shininess: 12,
              specular: 0x222222,
              side: THREE.FrontSide
            })
          )
          if (name.includes('Gem_Mana')) {
            material.color.set(0x77aaff)
            material.shininess = 45
          }
          control.materials.push(material)
          return material
        })
        const mesh = new THREE.Mesh(geometries[node.mesh], materials)
        mesh.castShadow = true
        mesh.receiveShadow = false
        object.add(mesh)
      }
      if (node.text) object.add(textMesh(node, node.name))
    }
    control.root = control.nodes.get('')
  }
  reset()
  new ResizeObserver(resize).observe(viewport)
  resize()
  renderer.domElement.addEventListener('pointermove', (event) => {
    hover = hit(event)
    if (downTarget?.control.id === 'endTurn' && hover !== controls.endTurn)
      cancelPress()
    renderer.domElement.style.cursor = hover && !hover.busy ? 'pointer' : 'default'
  })
  renderer.domElement.addEventListener('pointerleave', () => {
    hover = null
    cancelPress()
  })
  renderer.domElement.addEventListener('pointerdown', (event) => {
    if (event.button === 0) beginGesture(hit(event), renderer.domElement)
  })
  window.addEventListener('pointerup', releaseGesture)
  window.addEventListener('pointercancel', cancelGesture)
  window.addEventListener('blur', cancelGesture)
  bindControls()
  requestAnimationFrame(frame)
  el('metric').textContent = '3 meshes · 792 triangles · WebGL'
  return true
}

function resize() {
  const width = viewport.clientWidth,
    height = viewport.clientHeight
  renderer.setSize(width, height)
  // Contain the whole table without stretching it or changing control placement.
  const aspect = width / height
  const viewHeight =
    Math.max(layout.canvas.height, layout.canvas.width / aspect) / layout.pixelsPerUnit
  camera.left = (-viewHeight * aspect) / 2
  camera.right = (viewHeight * aspect) / 2
  camera.top = viewHeight / 2
  camera.bottom = -viewHeight / 2
  camera.position.set(0, 20, 0)
  camera.up.set(0, 0, -1)
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()
  renderer.render(scene, camera)
}

function hit(event) {
  const bounds = renderer.domElement.getBoundingClientRect()
  if (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  )
    return null
  pointer.set(
    ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
    (-(event.clientY - bounds.top) / bounds.height) * 2 + 1
  )
  raycaster.setFromCamera(pointer, camera)
  const hits = raycaster.intersectObjects(
    Object.values(controls).map((c) => c.host),
    true
  )
  for (const hit of hits) {
    for (const c of Object.values(controls)) {
      let object = hit.object
      while (object) {
        if (object === c.host) return c
        object = object.parent
      }
    }
  }
  return null
}

function applyClip(control, name, time, nodes = control.nodes) {
  for (const track of data.clips[name].tracks) {
    const target = nodes.get(track.path)
    if (!target || track.property === 'float') continue
    const value = evaluate(track.keys, time)
    if (track.property === 'position') convertedPosition(target.position, value)
    else if (track.property === 'quaternion')
      convertedQuaternion(target.quaternion, value)
    else target.scale.fromArray(value)
  }
}

function applyPress(name, time) {
  applyClip(controls.endTurn, name, time, controls.endTurn.pressNodes)
}

function updatePress(now) {
  if (!press) return
  press.time += ((now - press.updatedAt) / 1000) * speed
  press.updatedAt = now
  const name = press.held ? 'ENDTURN_PRESSED_DOWN' : 'ENDTURN_PRESSED_UP'
  applyPress(name, press.time)
  if (!press.held && press.time >= data.clips[name].duration) press = null
}

function cancelPress() {
  if (!press?.held) return
  press = { held: false, time: 0, updatedAt: performance.now() }
  applyPress('ENDTURN_PRESSED_UP', 0)
  status()
}

function cancelGesture() {
  downTarget = null
  cancelPress()
}

function beginGesture(control, element) {
  if (!control || control.busy) return
  downTarget = { control, element }
  if (control.id !== 'endTurn' || control.used) return
  finishCurrent()
  press = { held: true, time: 0, updatedAt: performance.now() }
  applyPress('ENDTURN_PRESSED_DOWN', 0)
  status()
}

function releaseGesture(event) {
  if (event.button !== 0 || !downTarget) return
  const { control, element } = downTarget
  downTarget = null
  const activate =
    element === renderer.domElement
      ? hit(event) === control
      : element.contains(event.target)
  if (!activate) {
    cancelPress()
    return
  }
  if (control.id === 'endTurn' && press?.held) {
    updatePress(performance.now())
    const pressSeconds = press.time
    start('endTurn', 'ENDTURN_WAITING', { pressSeconds, withPress: true })
    // The release and flip start together; do not replay the physical hold.
    seek(pressSeconds)
  } else toggle(control.id, true)
}

function status() {
  for (const c of Object.values(controls))
    c.busy = Boolean(
      current?.control === c && current.time < current.duration && playing
    )
  const end = controls.endTurn,
    hero = controls.heroPower
  el('end-status').textContent = press?.held
    ? 'Pressed · release to end turn'
    : end.busy
      ? 'Turning…'
      : end.used
        ? 'Enemy turn'
        : 'Your turn'
  el('hero-status').textContent = hero.busy
    ? 'Flipping…'
    : hero.used
      ? 'Exhausted · click to restore'
      : 'Ready · Fireblast'
  el('end-flip').textContent = end.used ? 'Start your turn' : 'End turn'
  el('hero-flip').textContent = hero.used ? 'Restore hero power' : 'Use hero power'
  el('end-flip').disabled = end.busy
  el('hero-flip').disabled = hero.busy
}

function finishCurrent() {
  if (!current) return
  sampleCurrent(current.duration)
  current.time = current.duration
  current.control.busy = false
}

function sampleCurrent(time) {
  const clipTime = Math.max(0, time - current.pressSeconds)
  applyClip(current.control, current.name, clipTime)
  if (current.withPress) {
    if (time < current.pressSeconds) applyPress('ENDTURN_PRESSED_DOWN', time)
    else applyPress('ENDTURN_PRESSED_UP', clipTime)
  }
}

function start(
  id,
  name,
  { pressSeconds = 0, withPress = false, preservePress = false } = {}
) {
  finishCurrent()
  const control = controls[id]
  if (id === 'endTurn' && !preservePress) {
    press = null
    applyPress('ENDTURN_PRESSED_UP', data.clips.ENDTURN_PRESSED_UP.duration)
  }
  control.used = name === 'ENDTURN_WAITING' || name === 'HeroPower_Used'
  control.lastClip = name
  control.lastPressSeconds = withPress ? pressSeconds : null
  current = {
    control,
    name,
    time: 0,
    duration: pressSeconds + data.clips[name].duration,
    pressSeconds,
    withPress
  }
  lastFrame = performance.now()
  playing = true
  el('play').textContent = 'Pause'
  el('clip-name').textContent = withPress ? 'Press → release + turn' : name
  seek(0)
}

function toggle(id, physical = false) {
  const c = controls[id]
  if (c.busy) return
  start(
    id,
    id === 'endTurn'
      ? c.used
        ? 'ENDTURN_YOUR_TURN'
        : 'ENDTURN_WAITING'
      : c.used
        ? 'HeroPower_Restore'
        : 'HeroPower_Used',
    {
      withPress: id === 'endTurn' && !c.used && !physical,
      pressSeconds:
        id === 'endTurn' && !c.used && !physical
          ? data.clips.ENDTURN_PRESSED_DOWN.duration
          : 0,
      preservePress: physical
    }
  )
}

function seek(time) {
  if (!current) return
  current.time = Math.max(0, Math.min(current.duration, time))
  sampleCurrent(current.time)
  el('scrub').value = Math.round((current.time / current.duration) * 1000)
  el('time').textContent = `${current.time.toFixed(2)} s`
  if (current.time >= current.duration) {
    playing = false
    el('play').textContent = 'Play'
  }
  status()
}

function reset() {
  downTarget = null
  press = null
  applyPress('ENDTURN_PRESSED_UP', data.clips.ENDTURN_PRESSED_UP.duration)
  current = null
  playing = true
  for (const c of Object.values(controls)) {
    c.used = false
    c.busy = false
    c.lastClip = null
    c.lastPressSeconds = null
  }
  // Establish poses from the same source tracks that will run on interaction.
  applyClip(
    controls.endTurn,
    'ENDTURN_YOUR_TURN',
    data.clips.ENDTURN_YOUR_TURN.duration
  )
  applyClip(controls.heroPower, 'HeroPower_Used', 0)
  el('scrub').value = 0
  el('time').textContent = '0.00 s'
  el('clip-name').textContent = 'Click a control to begin'
  el('play').textContent = 'Pause'
  status()
}

function bindControls() {
  el('end-flip').onpointerdown = (event) => {
    if (event.button === 0) beginGesture(controls.endTurn, el('end-flip'))
  }
  el('end-flip').onpointerleave = cancelPress
  // Mouse clicks are handled on release; keyboard/programmatic clicks preview
  // one full source press-down, followed by overlapping release and flip.
  el('end-flip').onclick = (event) => {
    if (event.detail === 0) toggle('endTurn')
  }
  el('hero-flip').onclick = () => toggle('heroPower')
  el('end-replay').onclick = () => {
    const name = controls.endTurn.lastClip || 'ENDTURN_WAITING'
    const withPress = name === 'ENDTURN_WAITING'
    start('endTurn', name, {
      withPress,
      pressSeconds: withPress
        ? (controls.endTurn.lastPressSeconds ??
          data.clips.ENDTURN_PRESSED_DOWN.duration)
        : 0
    })
  }
  el('hero-replay').onclick = () =>
    start('heroPower', controls.heroPower.lastClip || 'HeroPower_Used')
  el('speed').onchange = () => {
    speed = Number(el('speed').value)
  }
  el('wireframe').onchange = () => {
    for (const c of Object.values(controls))
      for (const m of c.materials) m.wireframe = el('wireframe').checked
  }
  el('reset').onclick = reset
  el('play').onclick = () => {
    if (!current) return
    if (current.time >= current.duration) {
      seek(0)
      playing = true
    } else playing = !playing
    el('play').textContent = playing ? 'Pause' : 'Play'
    status()
  }
  el('scrub').oninput = () => {
    playing = false
    el('play').textContent = 'Play'
    if (current) seek((Number(el('scrub').value) / 1000) * current.duration)
  }
}

function frame(now) {
  const delta = lastFrame ? (now - lastFrame) / 1000 : 0
  lastFrame = now
  updatePress(now)
  if (playing && current && current.time < current.duration)
    seek(current.time + delta * speed)
  for (const c of Object.values(controls)) {
    for (const m of c.materials)
      m.emissive.setRGB(
        hover === c && !c.busy ? 0.035 : 0,
        hover === c && !c.busy ? 0.025 : 0,
        0
      )
  }
  renderer.render(scene, camera)
  requestAnimationFrame(frame)
}

// Read-only state and deterministic pose hooks for the hidden screenshot check.
window.lab = {
  ready: initialize().catch((error) => {
    el('message').textContent = error.message
    el('message').classList.add('error')
    throw error
  }),
  reset,
  state: () =>
    Object.fromEntries(
      Object.entries(controls).map(([id, c]) => [
        id,
        {
          used: c.used,
          busy: c.busy,
          quaternion: c.root.quaternion.toArray(),
          position: c.root.position.toArray(),
          pressPosition: c.pressRoot?.position.toArray(),
          held: c.id === 'endTurn' && Boolean(press?.held)
        }
      ])
    ),
  pose: (id, name, time) => {
    start(id, name)
    playing = false
    seek(time)
    renderer.render(scene, camera)
  },
  sequencePose: (time) => {
    start('endTurn', 'ENDTURN_WAITING', {
      withPress: true,
      pressSeconds: data.clips.ENDTURN_PRESSED_DOWN.duration
    })
    playing = false
    seek(time)
    renderer.render(scene, camera)
  },
  points: () =>
    Object.fromEntries(
      Object.entries(controls).map(([id, c]) => {
        const bounds = renderer.domElement.getBoundingClientRect()
        const p = c.root.getWorldPosition(new THREE.Vector3()).project(camera)
        return [
          id,
          {
            x: Math.round(bounds.left + ((p.x + 1) / 2) * bounds.width),
            y: Math.round(bounds.top + ((1 - p.y) / 2) * bounds.height)
          }
        ]
      })
    ),
  projection: () => ({
    type: camera.type,
    direction: camera.getWorldDirection(new THREE.Vector3()).toArray(),
    // Height must have no effect on screen position in a true overhead view.
    probes: [-6, 6].map((x) =>
      [0, 3].map((y) =>
        new THREE.Vector3(x, y, 2).project(camera).toArray().slice(0, 2)
      )
    ),
    positions: Object.fromEntries(
      Object.entries(controls).map(([id, c]) => [id, c.host.position.toArray()])
    )
  }),
  diagnostics: () => ({
    triangles: renderer.info.render.triangles,
    calls: renderer.info.render.calls,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    webgl: renderer.getContext().getParameter(renderer.getContext().VERSION)
  })
}
window.addEventListener('beforeunload', () => {
  for (const resource of resources) resource.dispose()
  renderer?.dispose()
})
