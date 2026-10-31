import * as THREE from 'three'
import { Rectangle, Sprite, Texture, type Texture as PixiTexture } from 'pixi.js'
import { Actor } from '../../../visual-components/lifecycle/actor'
import { isArtworkVisible } from '../../../visual-components/effects/premium-artwork-breath'
import { MATCH_CONTROLS_3D_LAYOUT as layout } from './match-controls-3d-layout'
import {
  configureGoldReflection,
  configureManaCrystal
} from './match-controls-3d-materials'
import type {
  ControlNode,
  ControlTrack,
  MatchControlAssets
} from '../../../visual-components/assets/match-control-assets'

const TILE = layout.tilePixels
const DISPLAY = layout.displayPixels
const SLOT_COUNT = layout.slots
const HALF_VIEW = DISPLAY / layout.pixelsPerUnit / 2

// Pixi loads ImageBitmaps, whose unpack flipY cannot be changed by WebGL.
// Copy once into a canvas so Three can apply the Unity UV convention reliably.
function textureCanvas(texture: PixiTexture): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = texture.frame.width
  canvas.height = texture.frame.height
  canvas
    .getContext('2d')!
    .drawImage(
      texture.source.resource as CanvasImageSource,
      texture.frame.x,
      texture.frame.y,
      texture.frame.width,
      texture.frame.height,
      0,
      0,
      canvas.width,
      canvas.height
    )
  return canvas
}

function valueAt(track: ControlTrack, time: number): number[] {
  const keys = track.keys
  if (time <= keys[0].time) return keys[0].value
  if (time >= keys[keys.length - 1].time) return keys[keys.length - 1].value
  const index = keys.findIndex((k) => k.time > time)
  const a = keys[index - 1],
    b = keys[index],
    dt = b.time - a.time
  const t = (time - a.time) / dt
  return a.value.map((v, i) => {
    const outgoing = a.outSlope[i],
      incoming = b.inSlope[i]
    if (typeof outgoing !== 'number' || typeof incoming !== 'number') return v
    return (
      (2 * t ** 3 - 3 * t ** 2 + 1) * v +
      (t ** 3 - 2 * t ** 2 + t) * dt * outgoing +
      (-2 * t ** 3 + 3 * t ** 2) * b.value[i] +
      (t ** 3 - t ** 2) * dt * incoming
    )
  })
}

/** A single transparent atlas keeps these meshes inside Pixi's normal layer tree. */
export class MatchControls3D {
  readonly renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true
  })
  readonly texture: Texture
  readonly controls = new Set<ControlMeshView>()
  private dirty = true
  private disposed = false
  renderCount = 0

  constructor(readonly assets: MatchControlAssets) {
    // Textures are decoded as sRGB; keep the atlas in display sRGB for Pixi.
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NoToneMapping
    this.renderer.setSize(TILE * SLOT_COUNT, TILE, false)
    this.renderer.setClearColor(0, 0)
    this.renderer.autoClear = false
    this.texture = Texture.from(this.renderer.domElement)
  }

  create(kind: 'endTurn' | 'heroPower', artwork?: PixiTexture): ControlMeshView {
    const occupied = new Set([...this.controls].map((c) => c.slot))
    const slot = Array.from({ length: SLOT_COUNT }, (_, i) => i).find(
      (i) => !occupied.has(i)
    )
    if (slot === undefined) throw new Error('Match control atlas has no free slot')
    const control = new ControlMeshView(this, kind, slot, artwork)
    this.controls.add(control)
    this.invalidate()
    return control
  }

  invalidate(): void {
    this.dirty = true
  }

  render(deltaMS = 0): void {
    if (this.disposed) return
    for (const control of this.controls) control.updatePremium(deltaMS)
    if (!this.dirty) return
    this.renderer.setScissorTest(false)
    this.renderer.clear()
    this.renderer.setScissorTest(true)
    for (const control of this.controls) {
      this.renderer.setViewport(control.slot * TILE, 0, TILE, TILE)
      this.renderer.setScissor(control.slot * TILE, 0, TILE, TILE)
      this.renderer.render(control.scene, control.camera)
    }
    this.texture.source.update()
    this.dirty = false
    this.renderCount++
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const control of [...this.controls]) control.dispose()
    this.texture.destroy(true)
    this.renderer.dispose()
    this.renderer.forceContextLoss()
  }
}

export class ControlMeshView extends Actor {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.OrthographicCamera(
    -HALF_VIEW,
    HALF_VIEW,
    HALF_VIEW,
    -HALF_VIEW,
    0.1,
    60
  )
  readonly nodes = new Map<string, THREE.Group>()
  readonly pressRoot = new THREE.Group()
  private readonly resources = new Set<{ dispose(): void }>()
  private readonly materialMaps = new Map<string, THREE.MeshPhongMaterial[]>()
  private readonly textMaps = new Map<
    string,
    { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture }
  >()
  private readonly baseTextures = new Map<string, THREE.Texture>()
  private readonly geometries = new Map<string, THREE.BufferGeometry>()
  private powerMesh?: THREE.Mesh
  private readonly goldEnabled = { value: 0 }
  private readonly crystalTime = { value: 0 }
  private materialElapsed = 0
  private readonly sprite: Sprite
  private premium = false
  private premiumTime = 0
  private saturation = { value: 0 }
  private cost = '2'
  private costColor = '#fff9ea'
  private animation: gsap.core.Timeline | null = null
  private pressAnimation: gsap.core.Timeline | null = null
  private resolveAnimation: (() => void) | null = null
  private dead = false
  private artwork: THREE.Texture | null = null
  private clipName: string
  busy = false

  constructor(
    readonly owner: MatchControls3D,
    readonly kind: 'endTurn' | 'heroPower',
    readonly slot: number,
    artwork?: PixiTexture
  ) {
    super()
    this.label = `game.${kind}.mesh`
    this.eventMode = 'none'
    const tilt = THREE.MathUtils.degToRad(
      kind === 'endTurn' ? layout.endTurnTiltDegrees : 0
    )
    this.camera.position.set(
      0,
      Math.cos(tilt) * layout.cameraHeight,
      Math.sin(tilt) * layout.cameraHeight
    )
    this.camera.up.set(0, 0, -1)
    this.camera.lookAt(0, 0, 0)
    const lighting = layout.lighting[kind]
    this.scene.add(new THREE.AmbientLight(0xffffff, lighting.ambient))
    const key = new THREE.DirectionalLight(lighting.key.color, lighting.key.intensity)
    key.position.fromArray(lighting.key.position)
    this.scene.add(key)
    const fill = new THREE.DirectionalLight(
      lighting.fill.color,
      lighting.fill.intensity
    )
    fill.position.fromArray(lighting.fill.position)
    this.scene.add(fill)
    const host = new THREE.Group()
    const modelName = kind === 'endTurn' ? 'Button_EndTurn' : 'HeroPowerV2'
    const xs = owner.assets.models.meshes[modelName].positions.filter(
      (_, i) => i % 3 === 0
    )
    host.scale.setScalar(
      (kind === 'endTurn' ? layout.endTurnWidth : layout.heroPowerWidth) /
        (Math.max(...xs) - Math.min(...xs)) /
        layout.pixelsPerUnit
    )
    if (kind === 'endTurn') host.rotation.y = Math.PI
    host.add(this.pressRoot)
    this.scene.add(host)
    if (artwork) this.setArtwork(artwork)
    for (const node of owner.assets.models.controls[kind]) this.addNode(node)
    if (kind === 'heroPower') {
      this.texture('Hero_Power_Frame_Golden')
      this.texture('Hero_Power_D_Gold')
    }
    for (const resource of this.resources)
      if (resource instanceof THREE.Texture) owner.renderer.initTexture(resource)
    this.clipName = kind === 'endTurn' ? 'ENDTURN_YOUR_TURN' : 'HeroPower_Restore'
    this.sample(this.clipName, this.duration(this.clipName))
    const texture = new Texture({
      source: owner.texture.source,
      frame: new Rectangle(slot * TILE, 0, TILE, TILE)
    })
    this.sprite = new Sprite(texture)
    this.sprite.anchor.set(0.5)
    this.sprite.width = this.sprite.height = DISPLAY
    this.addChild(this.sprite)
  }

  private retain<T extends { dispose(): void }>(value: T): T {
    this.resources.add(value)
    return value
  }

  private texture(name: string, color = true): THREE.Texture {
    const cached = this.baseTextures.get(name)
    if (cached) return cached
    const source = this.owner.assets[name] as PixiTexture
    if (!source?.source?.resource)
      throw new Error(`Missing 3D control texture: ${name}`)
    const texture = this.retain(new THREE.CanvasTexture(textureCanvas(source)))
    texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.needsUpdate = true
    this.baseTextures.set(name, texture)
    return texture
  }

  private geometry(name: string): THREE.BufferGeometry {
    const cached = this.geometries.get(name)
    if (cached) return cached
    const source = this.owner.assets.models.meshes[name]
    const geometry = this.retain(new THREE.BufferGeometry())
    for (const [key, values] of [
      ['position', source.positions],
      ['normal', source.normals]
    ] as const)
      geometry.setAttribute(
        key,
        new THREE.Float32BufferAttribute(
          values.map((v, i) => (i % 3 === 2 ? -v : v)),
          3
        )
      )
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(source.uv, 2))
    const indices = source.indices.slice()
    for (let i = 0; i < indices.length; i += 3)
      [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]]
    geometry.setIndex(indices)
    for (const group of source.groups)
      geometry.addGroup(group.start, group.count, group.material)
    this.geometries.set(name, geometry)
    return geometry
  }

  private addNode(node: ControlNode): void {
    const object = new THREE.Group()
    object.position.set(node.position[0], node.position[1], -node.position[2])
    object.quaternion
      .set(
        -node.quaternion[0],
        -node.quaternion[1],
        node.quaternion[2],
        node.quaternion[3]
      )
      .normalize()
    object.scale.fromArray(node.scale)
    this.nodes.set(node.path, object)
    const parent = node.path.includes('/')
      ? node.path.slice(0, node.path.lastIndexOf('/'))
      : ''
    ;(node.path === '' ? this.pressRoot : this.nodes.get(parent)!).add(object)
    if (node.mesh) {
      const geometry = this.geometry(node.mesh)
      const materials = node.materials!.map((name) => {
        const source = this.owner.assets.models.materials[name].textures._MainTex
        const portrait = name.includes('InPlayPortrait')
        const map = portrait ? this.artwork! : this.texture(source.name)
        const material = this.retain(
          new THREE.MeshPhongMaterial({
            map,
            shininess: layout.lighting[this.kind].frameShininess,
            // Keep reflected highlights on the physical parts, off the artwork.
            specular: portrait ? 0x000000 : layout.lighting[this.kind].frameSpecular
          })
        )
        if (name.includes('Gem_Mana')) {
          configureManaCrystal(
            material,
            this.owner.assets.models.materials[name],
            this.texture('GenFX_clouds03', false),
            this.crystalTime
          )
        }
        if (source.name === 'Hero_Power_Frame' || source.name === 'Hero_Power_D')
          configureGoldReflection(
            material,
            this.owner.assets.models.materials.Card_HeroPower_Frame_Golden,
            this.texture('GenFX_clouds7'),
            this.texture(
              source.name === 'Hero_Power_Frame'
                ? 'Hero_Power_Frame_Golden_Specular'
                : 'Hero_Power_S_Gold',
              false
            ),
            this.goldEnabled,
            this.crystalTime
          )
        if (portrait)
          material.onBeforeCompile = (shader) => {
            shader.uniforms.artworkSaturation = this.saturation
            shader.fragmentShader =
              'uniform float artworkSaturation;\n' +
              shader.fragmentShader.replace(
                '#include <map_fragment>',
                '#include <map_fragment>\nfloat gray = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));\ndiffuseColor.rgb = mix(vec3(gray), diffuseColor.rgb, 1.0 + artworkSaturation);'
              )
          }
        const list = this.materialMaps.get(name) ?? []
        list.push(material)
        this.materialMaps.set(name, list)
        return material
      })
      const mesh = new THREE.Mesh(geometry, materials)
      if (node.mesh === 'HeroPowerV2') {
        this.powerMesh = mesh
        this.geometry('HeroPowerV2_Golden')
      }
      object.add(mesh)
    }
    if (node.text) {
      const canvas = document.createElement('canvas')
      const cost = node.name.includes('Cost')
      canvas.width = cost ? 512 : 1024
      canvas.height = cost ? 512 : 256
      const texture = this.retain(new THREE.CanvasTexture(canvas))
      texture.colorSpace = THREE.SRGBColorSpace
      this.textMaps.set(node.name, { canvas, texture })
      const material = this.retain(
        new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          depthWrite: false
        })
      )
      object.add(
        new THREE.Mesh(
          this.retain(new THREE.PlaneGeometry(node.text.width, node.text.height)),
          material
        )
      )
      this.drawText(node.name, cost ? this.cost : node.text.value)
    }
  }

  private drawText(name: string, text: string): void {
    const entry = this.textMaps.get(name)
    if (!entry) return
    const { canvas, texture } = entry,
      ctx = canvas.getContext('2d')!,
      cost = name.includes('Cost')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `${cost ? 410 : 140}px Belwe`
    if (cost) {
      ctx.lineWidth = 15
      ctx.strokeStyle = '#172035'
      ctx.strokeText(text, 256, 260)
    }
    ctx.fillStyle = cost ? this.costColor : '#211e17'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4, canvas.width * 0.96)
    texture.needsUpdate = true
    this.owner.invalidate()
  }

  setTurnText(extra: boolean): void {
    this.drawText('MyTurnText', extra ? 'EXTRA TURN' : 'END TURN')
    this.drawText('WaitingText', extra ? 'EXTRA TURN' : 'ENEMY TURN')
  }

  setCost(cost: number, color: string = this.costColor): void {
    if (this.cost === String(cost) && this.costColor === color) return
    this.cost = String(cost)
    this.costColor = color
    this.drawText('CostUberText', this.cost)
  }

  setArtwork(texture: PixiTexture): void {
    const old = this.artwork
    this.artwork = this.retain(new THREE.CanvasTexture(textureCanvas(texture)))
    this.artwork.colorSpace = THREE.SRGBColorSpace
    this.artwork.needsUpdate = true
    for (const [name, materials] of this.materialMaps)
      if (name.includes('InPlayPortrait'))
        for (const material of materials) material.map = this.artwork
    if (old) {
      old.dispose()
      this.resources.delete(old)
    }
    this.owner.invalidate()
  }

  setPremium(premium: boolean): void {
    this.premium = premium
    this.premiumTime = 0
    this.saturation.value = 0
    this.goldEnabled.value = premium ? 1 : 0
    if (this.powerMesh)
      this.powerMesh.geometry = this.geometry(
        premium ? 'HeroPowerV2_Golden' : 'HeroPowerV2'
      )
    for (const [name, materials] of this.materialMaps) {
      const source = this.owner.assets.models.materials[name].textures._MainTex.name
      const replacement =
        source === 'Hero_Power_Frame'
          ? premium
            ? 'Hero_Power_Frame_Golden'
            : source
          : source === 'Hero_Power_D'
            ? premium
              ? 'Hero_Power_D_Gold'
              : source
            : null
      if (replacement)
        for (const material of materials) {
          material.map = this.texture(replacement)
          material.specularMap = premium
            ? this.texture(
                source === 'Hero_Power_Frame'
                  ? 'Hero_Power_Frame_Golden_Specular'
                  : 'Hero_Power_S_Gold',
                false
              )
            : null
          // DiffuseReflection supplies masked reflection, not Phong highlights.
          material.specular.set(
            premium ? 0x000000 : layout.lighting.heroPower.frameSpecular
          )
          material.needsUpdate = true
        }
    }
    this.owner.invalidate()
  }

  updatePremium(deltaMS: number): void {
    if (
      this.kind !== 'heroPower' ||
      !deltaMS ||
      !isArtworkVisible(this) ||
      document.hidden
    )
      return
    if (this.clipName === 'HeroPower_Used' && !this.busy && !this.premium) return
    this.materialElapsed += Math.min(deltaMS, 100) / 1000
    // The small crystal shimmer needs only 30 updates per second.
    if (this.materialElapsed < 1 / 30) return
    this.crystalTime.value += this.materialElapsed
    if (this.premium) {
      this.premiumTime = (this.premiumTime + this.materialElapsed) % 3
      this.saturation.value = (1 - Math.cos((this.premiumTime * Math.PI * 2) / 3)) / 2
    }
    this.materialElapsed = 0
    this.owner.invalidate()
  }

  duration(name: string): number {
    return this.owner.assets.models.clips[name].duration
  }

  sample(name: string, time: number, press = false): void {
    for (const track of this.owner.assets.models.clips[name].tracks) {
      if (track.property === 'float') continue
      const target = press
        ? track.path === ''
          ? this.pressRoot
          : undefined
        : this.nodes.get(track.path)
      if (!target) continue
      const v = valueAt(track, time)
      if (track.property === 'position') target.position.set(v[0], v[1], -v[2])
      else if (track.property === 'quaternion')
        target.quaternion.set(-v[0], -v[1], v[2], v[3]).normalize()
      else target.scale.fromArray(v)
    }
    this.owner.invalidate()
  }

  press(down: boolean): void {
    this.pressAnimation?.kill()
    const name = down ? 'ENDTURN_PRESSED_DOWN' : 'ENDTURN_PRESSED_UP',
      clock = { time: 0 }
    this.sample(name, 0, true)
    this.pressAnimation = this.timeline().to(clock, {
      time: this.duration(name),
      duration: this.duration(name),
      ease: 'none',
      onUpdate: () => this.sample(name, clock.time, true)
    })
  }

  settle(name: string): void {
    this.finish()
    this.clipName = name
    this.sample(name, this.duration(name))
  }

  play(name: string): Promise<void> {
    this.finish()
    this.clipName = name
    this.busy = true
    const clock = { time: 0 }
    this.sample(name, 0)
    return new Promise((resolve) => {
      this.resolveAnimation = resolve
      this.animation = this.timeline().to(clock, {
        time: this.duration(name),
        duration: this.duration(name),
        ease: 'none',
        onUpdate: () => this.sample(name, clock.time),
        onComplete: () => this.finish()
      })
    })
  }

  private finish(): void {
    this.animation?.kill()
    this.animation = null
    this.sample(this.clipName, this.duration(this.clipName))
    this.busy = false
    const resolve = this.resolveAnimation
    this.resolveAnimation = null
    resolve?.()
  }

  override dispose(): void {
    if (this.dead) return
    this.dead = true
    this.finish()
    this.owner.controls.delete(this)
    this.sprite.texture.destroy(false)
    for (const resource of this.resources) resource.dispose()
    this.resources.clear()
    this.owner.invalidate()
    super.dispose()
  }
}
