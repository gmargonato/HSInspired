/**
 * Focused AOE regressions against real TypeScript modules and PNG pixels.
 * In-memory Pixi/canvas/timeline doubles verify plumbing and ownership only;
 * GPU appearance and performance require separate browser/Electron review.
 * This script creates no test files or build artifacts and needs no git history.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const root = path.resolve(__dirname, '..')
const requireRoot = Module.createRequire(path.join(root, 'package.json'))
const ts = requireRoot('typescript')
const clone = (value) => structuredClone(value)
const reports = []
const cache = new Map()
function load(relativePath, imports = {}) {
  let filename = path.resolve(root, relativePath)
  if (!path.extname(filename))
    filename += fs.existsSync(filename + '.ts') ? '.ts' : '/index.ts'
  const mod = new Module(filename)
  mod.filename = filename
  mod.require = (name) => {
    if (name in imports) return imports[name]
    if (!name.startsWith('.')) return requireRoot(name)
    const target = path.resolve(path.dirname(filename), name)
    if (!cache.has(target)) cache.set(target, load(target))
    return cache.get(target)
  }
  mod._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }).outputText,
    filename
  )
  return mod.exports
}
const contract = load('src/desktop/contracts/ipc/vfx-templates.ts')
const model = load('src/dev-tools/vfx-lab/vfx-lab-model.ts')
const common = load('src/visual-components/effects/fire-vfx-shader-common.ts')
const raw = JSON.parse(
  fs.readFileSync(path.join(root, 'config/vfx-templates.json'), 'utf8')
)
const library = contract.parseVfxTemplateLibrary(raw)
const fire = library.templates.find((t) => t.id === 'fire-blast-enemy-board')
const missile = library.templates.find((t) => t.family === 'missile')
const parseTemplate = (template) =>
  contract.parseVfxTemplateLibrary({ version: 1, templates: [template] }).templates[0]
async function check(name, run) {
  try {
    await run()
    reports.push({ name, passed: true })
    console.log('PASS ' + name)
  } catch (error) {
    reports.push({ name, passed: false, error: error.stack })
    console.error('FAIL ' + name + '\n' + error.stack)
  }
}
const points = () => ({
  x: 0,
  y: 0,
  set(x, y = x) {
    this.x = x
    this.y = y
  }
})
class Container {
  constructor() {
    this.children = []
    this.position = points()
    this.scale = points()
    this.destroyed = false
  }
  addChild(...children) {
    for (const child of children) {
      this.children.push(child)
      child.parent = this
    }
    return children[0]
  }
  removeFromParent() {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((c) => c !== this)
      this.parent = null
    }
  }
  destroy(options) {
    if (this.destroyed) return
    this.destroyed = true
    this.destroyCount = (this.destroyCount || 0) + 1
    this.removeFromParent()
    if (options?.children)
      for (const child of [...this.children]) child.destroy(options)
  }
}
class Sprite extends Container {
  constructor(value) {
    super()
    const options = value?.texture ? value : { texture: value }
    this.texture = options.texture
    this.anchor = points()
    this.anchor.set(options.anchor ?? 0)
    this.blendMode = options.blendMode ?? 'normal'
  }
}
const shaderRecords = []
class Shader {
  constructor(noise, seed = 0) {
    this.seed = seed
    this.frames = []
    this.filter = {}
    this.disposed = 0
    shaderRecords.push(this)
  }
  setPalette(value) {
    this.palette = clone(value)
  }
  setTuning(value) {
    this.tuning = clone(value)
  }
  setGeometry(...value) {
    this.geometry = clone(value)
  }
  setFrame(...value) {
    this.frames.push(value)
  }
  dispose() {
    this.disposed++
  }
}
const savedDocument = global.document
const moteMocks = (() => {
  const { PNG } = requireRoot('pngjs')
  const originalBytes = fs.readFileSync(
    path.join(root, 'assets/images/effects/spotlight-triangle.png')
  )
  const sourcePng = PNG.sync.read(originalBytes)
  const stats = {
    draws: 0,
    reads: 0,
    writes: 0,
    textures: [],
    targets: [],
    canvases: []
  }
  class Canvas {
    constructor() {
      this.width = 0
      this.height = 0
      this.data = new Uint8ClampedArray()
      stats.canvases.push(this)
    }
    getContext() {
      return {
        drawImage: (source, _x, _y, width, height) => {
          stats.draws++
          if (width !== source.width || height !== source.height)
            throw new Error('Test fixture expects same-sized source image')
          this.data = new Uint8ClampedArray(source.data)
        },
        getImageData: () => {
          stats.reads++
          return {
            width: this.width,
            height: this.height,
            data: new Uint8ClampedArray(this.data)
          }
        },
        putImageData: (pixels) => {
          stats.writes++
          this.data = new Uint8ClampedArray(pixels.data)
        }
      }
    }
  }
  class Texture {
    constructor(resource) {
      this.width = resource.width
      this.height = resource.height
      this.destroyed = false
      this.destroyCount = 0
      this.source = { resource, destroyed: false, destroyCount: 0 }
      stats.textures.push(this)
    }
    static from(canvas) {
      return new Texture(canvas)
    }
    destroy(destroySource) {
      this.destroyCount++
      this.destroyed = true
      if (destroySource) {
        this.source.destroyed = true
        this.source.destroyCount++
      }
    }
  }
  Texture.WHITE = new Texture({
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([255, 255, 255, 255])
  })
  const sharedTriangle = new Texture({
    width: sourcePng.width,
    height: sourcePng.height,
    data: new Uint8ClampedArray(sourcePng.data)
  })
  const sharedSnapshot = new Uint8ClampedArray(sharedTriangle.source.resource.data)
  const RenderTexture = {
    create(options) {
      const texture = new Texture({ width: options.width, height: options.height })
      texture.renderOptions = options
      stats.targets.push(texture)
      return texture
    }
  }
  function renderer(fail = false) {
    return {
      calls: [],
      render(options) {
        this.calls.push(options)
        if (fail) throw new Error('deliberate warmup failure')
      }
    }
  }
  function install() {
    global.document = {
      createElement(tag) {
        if (tag !== 'canvas') throw new Error('Unexpected element: ' + tag)
        return new Canvas()
      }
    }
  }
  return {
    stats,
    Canvas,
    Texture,
    RenderTexture,
    renderer,
    install,
    sharedTriangle,
    sharedSnapshot,
    originalBytes,
    sourcePng
  }
})()
moteMocks.install()
const moteModule = load('src/visual-components/effects/aoe-motes.ts', {
  'pixi.js': {
    Container,
    Sprite,
    Texture: moteMocks.Texture,
    RenderTexture: moteMocks.RenderTexture
  }
})
const { AoeMotes, AoeMoteTexture } = moteModule
const { MATCH_VFX_LAYOUT } = load('src/scenes/match/presentation/match-vfx-layout.ts')
const { MatchVfxPresenter, matchVfxAreas } = load(
  'src/scenes/match/presentation/match-vfx-presenter.ts',
  {
    'pixi.js': { Container, Sprite, Texture: { WHITE: {} } },
    '../../../visual-components/effects/aoe-vfx-shader': { AoeVfxShader: Shader },
    '../../../visual-components/effects/aoe-motes': moteModule,
    '../../../visual-components/effects/missile-vfx-shader': {
      MissileVfxShader: Shader,
      MISSILE_VFX_TIMING: { launch: 0.08, arrival: 0.58, trailEnd: 0.9 }
    },
    './match-vfx-layout': { MATCH_VFX_LAYOUT }
  }
)
function harness() {
  const timelines = []
  const renderer = moteMocks.renderer()
  const presenter = new MatchVfxPresenter(
    { burnNoise: {}, playSpotlight1: {}, ghostSpotlight: moteMocks.sharedTriangle },
    () => {
      const timeline = {
        events: {},
        calls: [],
        killed: 0,
        eventCallback(name, callback) {
          this.events[name] = callback
          return this
        },
        to(clock, options) {
          this.clock = clock
          this.options = options
          return this
        },
        call(callback, params, at) {
          this.calls.push({ callback, params, at })
          return this
        },
        kill() {
          this.killed++
          this.events.onInterrupt?.()
          return this
        }
      }
      timelines.push(timeline)
      return timeline
    },
    renderer
  )
  return { presenter, timelines, renderer }
}
class Graphics extends Container {
  circle() {
    return this
  }
  fill() {
    return this
  }
  stroke() {
    return this
  }
  rect() {
    return this
  }
  moveTo() {
    return this
  }
  lineTo() {
    return this
  }
  clear() {
    return this
  }
  roundRect() {
    return this
  }
}
class Text extends Container {}
class Controls {
  constructor() {
    this.disposed = 0
  }
  refresh() {}
  setVisible() {}
  dispose() {
    this.disposed++
  }
}
const { VfxLab } = load('src/dev-tools/vfx-lab/vfx-lab.ts', {
  'pixi.js': { Container, Graphics, Sprite, Text, Texture: { WHITE: {} } },
  '../../visual-components/effects/aoe-vfx-shader': { AoeVfxShader: Shader },
  '../../visual-components/effects/aoe-motes': moteModule,
  '../../visual-components/effects/missile-vfx-shader': {
    MissileVfxShader: Shader,
    MISSILE_VFX_TIMING: { launch: 0.08, arrival: 0.58, trailEnd: 0.9 }
  },
  '../../visual-components/effects/vfx-templates': {
    getVfxTemplateLibrary: () => library,
    updateVfxTemplateLibrary() {}
  },
  './vfx-lab-controls': { VfxLabControls: Controls },
  './vfx-lab-model': model
})
function moteSnapshot(container) {
  return container.children.map((sprite) =>
    sprite.visible
      ? {
          visible: true,
          x: sprite.position.x,
          y: sprite.position.y,
          width: sprite.width,
          height: sprite.height,
          alpha: sprite.alpha,
          rotation: sprite.rotation,
          tint: sprite.tint,
          blendMode: sprite.blendMode
        }
      : { visible: false, alpha: sprite.alpha }
  )
}
async function main() {
  await check('all configured templates parse and roundtrip without mutation', () => {
    for (const t of library.templates)
      assert.deepEqual(
        model.templateFromSettings(t, model.settingsFromTemplate(t)),
        t,
        t.id
      )
  })
  await check(
    'six fire-blast presets use exact three-role palette, 3000ms visuals and 350ms impact; coverage and sizes preserved',
    () => {
      const fires = library.templates.filter((t) => t.id.startsWith('fire-blast-'))
      assert.equal(fires.length, 6)
      for (const t of fires) {
        assert.equal(t.tuning.durationMs, 3000)
        assert.equal(t.tuning.impactMs, 350)
        assert.equal(t.tuning.coreColor, '#EFE28B')
        assert.equal(t.tuning.flameColor, '#F4A30F')
        assert.equal(t.tuning.redColor, '#EB530D')
        assert.equal(t.tuning.sootColor, '#1f130b')
        assert.equal(t.tuning.aoeRadius, 0.98)
        assert.equal(t.tuning.aoeEdgeSoftness, 0.1)
        assert.equal(t.tuning.aoeShape, 'wide')
      }
    }
  )
  await check(
    'editing AOE settings preserves the authored missile and its settings',
    () => {
      const lab = new VfxLab({
        canvas: {},
        renderer: moteMocks.renderer(),
        parent: {},
        assets: {
          boardBase: {},
          burnNoise: {},
          playSpotlight1: {},
          ghostSpotlight: moteMocks.sharedTriangle
        }
      })
      const settings = clone(lab.settings)
      const template = clone(lab.selectedTemplate)
      lab.selectEffect('aoe')
      lab.changeSetting('edgeColor', '#112233')
      lab.changeSetting('durationMs', 4000)
      lab.selectEffect('missile')
      assert.deepEqual(lab.settings, settings)
      assert.deepEqual(lab.selectedTemplate, template)
      assert.deepEqual(template, missile)
      lab.dispose()
    }
  )
  await check('AOE allows 400–5000ms while missile remains 400–2200ms', () => {
    for (const [template, max] of [
      [fire, 5000],
      [missile, 2200]
    ]) {
      for (const value of [400, max]) {
        const t = clone(template)
        t.tuning.durationMs = value
        assert.equal(parseTemplate(t).tuning.durationMs, value)
      }
      for (const value of [399, max + 1, null, '3000', NaN, Infinity]) {
        const t = clone(template)
        t.tuning.durationMs = value
        assert.throws(() => parseTemplate(t), /durationMs/)
      }
    }
  })
  await check(
    'AOE sootColor validates hex, roundtrips custom value, and supports legacy fallback',
    () => {
      const t = clone(fire)
      t.tuning.sootColor = '#126aFe'
      const parsed = parseTemplate(t)
      assert.equal(
        model.templateFromSettings(parsed, model.settingsFromTemplate(parsed)).tuning
          .sootColor,
        '#126aFe'
      )
      for (const value of ['red', '#abc', '#zzzzzz', '#12345678', null, 123]) {
        const invalid = clone(t)
        invalid.tuning.sootColor = value
        assert.throws(() => parseTemplate(invalid), /sootColor/)
      }
      delete t.tuning.sootColor
      const legacy = parseTemplate(t)
      assert.equal(legacy.tuning.sootColor, undefined)
      assert.equal(
        model.settingsFromTemplate(legacy).sootColor,
        model.DEFAULT_VFX_LAB_SETTINGS.sootColor
      )
      const edited = model.settingsFromTemplate(legacy)
      edited.sootColor = '#334455'
      const saved = parseTemplate(model.templateFromSettings(legacy, edited))
      assert.equal(saved.tuning.sootColor, '#334455')
      assert.equal(model.settingsFromTemplate(saved).sootColor, '#334455')
    }
  )
  await check(
    'AOE redColor validates hex, roundtrips explicit values, preserves omission, and saves edited legacy palette',
    () => {
      for (const value of ['#126aFe', fire.tuning.flameColor]) {
        const t = clone(fire)
        t.tuning.redColor = value
        const parsed = parseTemplate(t)
        const settings = model.settingsFromTemplate(parsed)
        assert.equal(settings.edgeColor, value)
        assert.equal(settings.aoeRedColorAuthored, true)
        assert.deepEqual(model.templateFromSettings(parsed, settings), parsed)
      }
      for (const value of ['red', '#abc', '#zzzzzz', '#12345678', null, 123, '']) {
        const t = clone(fire)
        t.tuning.redColor = value
        assert.throws(() => parseTemplate(t), /redColor/)
      }
      const t = clone(fire)
      delete t.tuning.redColor
      const legacy = parseTemplate(t)
      const settings = model.settingsFromTemplate(legacy)
      assert.equal(settings.edgeColor, legacy.tuning.flameColor)
      assert.equal(settings.aoeRedColorAuthored, false)
      assert.deepEqual(model.templateFromSettings(legacy, settings), legacy)
      settings.edgeColor = '#334455'
      const saved = parseTemplate(model.templateFromSettings(legacy, settings))
      assert.equal(saved.tuning.redColor, '#334455')
      assert.equal(model.settingsFromTemplate(saved).edgeColor, '#334455')
    }
  )
  await check(
    'impactMs validates [0,duration], retains zero/absence, and clamps after duration edit',
    () => {
      for (const value of [0, 350, 3000]) {
        const t = clone(fire)
        t.tuning.impactMs = value
        const parsed = parseTemplate(t)
        const settings = model.settingsFromTemplate(parsed)
        assert.equal(settings.aoeImpactMs, value)
        assert.equal(
          model.templateFromSettings(parsed, settings).tuning.impactMs,
          value
        )
      }
      for (const value of [-1, 3001, null, '350', NaN, Infinity]) {
        const t = clone(fire)
        t.tuning.impactMs = value
        assert.throws(() => parseTemplate(t), /impactMs/)
      }
      const t = clone(fire)
      delete t.tuning.impactMs
      assert.equal(
        model.templateFromSettings(t, model.settingsFromTemplate(t)).tuning.impactMs,
        undefined
      )
      const settings = model.settingsFromTemplate(fire)
      settings.aoeImpactMs = 900
      settings.durationMs = 400
      assert.equal(
        parseTemplate(model.templateFromSettings(fire, settings)).tuning.impactMs,
        400
      )
    }
  )
  await check(
    'shader three-role and soot uniforms support explicit, edited, and legacy palettes',
    () => {
      const { AoeVfxShader } = load('src/visual-components/effects/aoe-vfx-shader.ts', {
        './fire-vfx-shader-common': common,
        'pixi.js': {
          Filter: {
            from(options) {
              return {
                resources: {
                  aoeVfxUniforms: {
                    uniforms: Object.fromEntries(
                      Object.entries(options.resources.aoeVfxUniforms).map(
                        ([key, item]) => [key, item.value]
                      )
                    )
                  }
                },
                destroy() {}
              }
            }
          }
        }
      })
      const shader = new AoeVfxShader({ source: {} })
      const uniforms = shader.filter.resources.aoeVfxUniforms.uniforms
      shader.setPalette({
        flameColor: '#abcdef',
        coreColor: '#fedcba',
        redColor: '#c3192a',
        sootColor: '#112233'
      })
      assert.deepEqual(uniforms.uFlameColor, common.hexColorToRgb('#abcdef'))
      assert.deepEqual(uniforms.uCoreColor, common.hexColorToRgb('#fedcba'))
      assert.deepEqual(uniforms.uRedColor, common.hexColorToRgb('#c3192a'))
      assert.deepEqual(uniforms.uSootColor, common.hexColorToRgb('#112233'))
      shader.setPalette({ flameColor: '#abcdef', coreColor: '#fedcba' })
      assert.deepEqual(
        uniforms.uSootColor,
        common.hexColorToRgb(model.DEFAULT_VFX_LAB_SETTINGS.sootColor)
      )
      assert.deepEqual(uniforms.uRedColor, common.hexColorToRgb('#abcdef'))
      shader.setPalette(fire.tuning)
      assert.deepEqual(uniforms.uCoreColor, common.hexColorToRgb('#EFE28B'))
      assert.deepEqual(uniforms.uFlameColor, common.hexColorToRgb('#F4A30F'))
      assert.deepEqual(uniforms.uRedColor, common.hexColorToRgb('#EB530D'))
      const seeded = new AoeVfxShader({ source: {} }, 1)
      assert.notEqual(seeded.filter, shader.filter)
      assert.equal(uniforms.uSeed, 0)
      assert.equal(seeded.filter.resources.aoeVfxUniforms.uniforms.uSeed, 1)
      for (const progress of [0, 0.1, 0.5, 1]) {
        shader.setFrame(progress * 3 + 1.7, progress)
        seeded.setFrame(progress * 3 + 1.7, progress)
        assert.equal(
          uniforms.uProgress,
          seeded.filter.resources.aoeVfxUniforms.uniforms.uProgress
        )
        assert.equal(
          uniforms.uTime,
          seeded.filter.resources.aoeVfxUniforms.uniforms.uTime
        )
        assert.equal(uniforms.uSeed, 0)
        assert.equal(seeded.filter.resources.aoeVfxUniforms.uniforms.uSeed, 1)
      }
      seeded.dispose()
      shader.setFrame(3, 1)
      assert.equal(uniforms.uTime, 3)
      assert.equal(uniforms.uProgress, 1)
      shader.dispose()
    }
  )
  await check(
    'presenter resolves gameplay at 350ms while AOE visual lasts 3 seconds',
    async () => {
      const { presenter, timelines } = harness()
      const recordStart = shaderRecords.length
      let resolved = false
      const promise = presenter.play(fire, true).then(() => {
        resolved = true
      })
      const timeline = timelines[0]
      assert.equal(timeline.options.duration, 3)
      assert.equal(timeline.calls[0].at, 0.35)
      for (const shader of shaderRecords.slice(recordStart))
        assert.equal(shader.palette.redColor, '#EB530D')
      await Promise.resolve()
      assert.equal(resolved, false)
      timeline.calls[0].callback()
      await promise
      assert.equal(resolved, true)
      assert.equal(presenter.layer.children.length, 1)
      assert.equal(presenter.active.size, 1)
      timeline.clock.progress = 0.8
      timeline.options.onUpdate()
      assert.deepEqual(
        shaderRecords[recordStart].frames.at(-1),
        [2.4000000000000004, 0.8]
      )
      assert.equal(shaderRecords[recordStart].disposed, 0)
      timeline.events.onComplete()
      assert.equal(presenter.active.size, 0)
      assert.equal(presenter.layer.children.length, 0)
      timeline.events.onComplete()
      assert.equal(shaderRecords[recordStart].disposed, 1)
    }
  )
  await check(
    'match heroes use distinct seeds for both controller orientations with synchronized lifecycle and cleanup',
    async () => {
      const all = library.templates.find((t) => t.id === 'fire-blast-all-characters')
      for (const controllerIsLocal of [true, false]) {
        const { presenter, timelines } = harness()
        const recordStart = shaderRecords.length
        const promise = presenter.play(all, controllerIsLocal)
        const shaders = shaderRecords.slice(recordStart)
        assert.equal(shaders.length, 3)
        const area = (id) =>
          presenter.layer.children[0].children.find((view) =>
            view.label.endsWith('.' + id)
          )
        const friendly = area(controllerIsLocal ? 'localHero' : 'remoteHero')
          .children[0]
        const enemy = area(controllerIsLocal ? 'remoteHero' : 'localHero').children[0]
        assert.notEqual(
          friendly.filters[0],
          enemy.filters[0],
          'Each match hero must use a distinct filter'
        )
        const friendlyShader = shaders.find(
          (shader) => shader.filter === friendly.filters[0]
        )
        const enemyShader = shaders.find((shader) => shader.filter === enemy.filters[0])
        assert.equal(friendlyShader.seed, 1)
        assert.equal(enemyShader.seed, 0)
        assert.deepEqual(friendlyShader.palette, enemyShader.palette)
        assert.deepEqual(friendlyShader.tuning, enemyShader.tuning)
        assert.equal(friendlyShader.tuning.impact, true)
        assert.equal(friendlyShader.tuning.shape, 'radial')
        const timeline = timelines[0]
        for (const progress of [0, 0.035, 350 / 3000, 0.4, 0.9, 1]) {
          timeline.clock.progress = progress
          timeline.options.onUpdate()
          assert.deepEqual(friendlyShader.frames.at(-1), enemyShader.frames.at(-1))
          assert.deepEqual(friendlyShader.frames.at(-1), [progress * 3 + 1.7, progress])
        }
        timeline.calls[0].callback()
        await promise
        assert.ok(
          shaders.every((shader) => shader.disposed === 0),
          'Impact must not dispose the residual tail'
        )
        if (controllerIsLocal) timeline.events.onComplete()
        else presenter.dispose()
        presenter.dispose()
        assert.ok(shaders.every((shader) => shader.disposed === 1))
        assert.equal(friendly.filters, null)
        assert.equal(enemy.filters, null)
        assert.equal(presenter.layer.children.length, 0)
        assert.equal(presenter.active.size, 0)
      }
    }
  )
  await check(
    'Lab heroes use distinct seed filters, synchronize playback/replay/end, and dispose once',
    () => {
      const recordStart = shaderRecords.length
      const lab = new VfxLab({
        canvas: {},
        renderer: moteMocks.renderer(),
        parent: {},
        assets: {
          boardBase: {},
          burnNoise: {},
          playSpotlight1: {},
          ghostSpotlight: moteMocks.sharedTriangle
        }
      })
      lab.selectEffect('aoe')
      lab.selectTemplate('fire-blast-all-characters')
      lab.play()
      const friendly = lab.aoeZones.find((zone) => zone.id === 'friendlyHero')
      const enemy = lab.aoeZones.find((zone) => zone.id === 'enemyHero')
      assert.notEqual(friendly.sprite.filters[0], enemy.sprite.filters[0])
      const shaders = shaderRecords.slice(recordStart)
      const friendlyShader = shaders.find(
        (shader) => shader.filter === friendly.sprite.filters[0]
      )
      const enemyShader = shaders.find(
        (shader) => shader.filter === enemy.sprite.filters[0]
      )
      assert.equal(friendlyShader.seed, 1)
      assert.equal(enemyShader.seed, 0)
      assert.deepEqual(friendlyShader.palette, enemyShader.palette)
      assert.deepEqual(friendlyShader.tuning, enemyShader.tuning)
      assert.equal(friendlyShader.palette.redColor, '#EB530D')
      assert.equal(friendlyShader.tuning.impact, true)
      for (let i = 0; i < 30; i++) {
        lab.update(100)
        assert.deepEqual(friendlyShader.frames.at(-1), enemyShader.frames.at(-1))
        assert.equal(friendly.sprite.visible, i < 29)
        assert.equal(enemy.sprite.visible, i < 29)
      }
      assert.equal(lab.elapsedMS, 3000)
      assert.equal(lab.playing, false)
      assert.equal(friendlyShader.frames.at(-1)[1], 1)
      lab.play()
      lab.update(0)
      assert.equal(friendlyShader.frames.at(-1)[1], 0)
      assert.deepEqual(friendlyShader.frames.at(-1), enemyShader.frames.at(-1))
      assert.equal(friendly.sprite.visible, true)
      assert.equal(enemy.sprite.visible, true)
      lab.dispose()
      lab.dispose()
      const frameCount = friendlyShader.frames.length
      lab.update(100)
      assert.equal(friendlyShader.frames.length, frameCount)
      assert.ok(shaders.every((shader) => shader.disposed === 1))
      assert.equal(friendly.sprite.filters, null)
      assert.equal(enemy.sprite.filters, null)
      assert.equal(lab.controls.disposed, 1)
    }
  )
  await check(
    'presenter legacy fallback and missile timing stay at original fractions',
    async () => {
      for (const [template, expected] of [
        [
          {
            ...fire,
            tuning: { ...fire.tuning, impactMs: undefined, durationMs: 1250 }
          },
          0.35
        ],
        [missile, (missile.tuning.durationMs / 1000) * 0.58]
      ]) {
        const { presenter, timelines } = harness()
        const promise = presenter.play(template, true, { x: 1, y: 2 }, { x: 3, y: 4 })
        assert.ok(Math.abs(timelines[0].calls[0].at - expected) < 1e-12)
        timelines[0].events.onComplete()
        await promise
      }
      for (const [value, expected] of [
        [0, 0],
        [3000, 3],
        [4000, 3]
      ]) {
        const { presenter, timelines } = harness()
        const promise = presenter.play(
          { ...fire, tuning: { ...fire.tuning, impactMs: value } },
          true
        )
        assert.ok(Math.abs(timelines[0].calls[0].at - expected) < 1e-12)
        presenter.dispose()
        await promise
      }
    }
  )
  await check(
    'interruption and repeated disposal resolve and clean overlapping visuals once',
    async () => {
      const { presenter, timelines } = harness()
      const recordStart = shaderRecords.length
      const p1 = presenter.play(fire, true)
      const p2 = presenter.play(fire, false)
      assert.equal(presenter.active.size, 2)
      assert.equal(presenter.layer.children.length, 2)
      presenter.dispose()
      await Promise.all([p1, p2])
      presenter.dispose()
      assert.equal(presenter.active.size, 0)
      assert.equal(presenter.layer.children.length, 0)
      assert.ok(timelines.every((t) => t.killed === 1))
      assert.ok(shaderRecords.slice(recordStart).every((s) => s.disposed === 1))
    }
  )
  await check(
    'empty AOE selection or missing missile endpoints does not create a timeline',
    async () => {
      const { presenter, timelines } = harness()
      await presenter.play({ ...fire, zones: [] }, true)
      await presenter.play(missile, true)
      assert.equal(timelines.length, 0)
      assert.equal(presenter.active.size, 0)
    }
  )
  await check(
    'controller mapping, board union, and 1400px/280px authored AOE quads are preserved',
    async () => {
      assert.deepEqual(
        matchVfxAreas(
          ['enemyBoard', 'friendlyBoard', 'enemyHero', 'friendlyHero'],
          true
        ),
        ['bothBoards', 'remoteHero', 'localHero']
      )
      assert.deepEqual(matchVfxAreas(['enemyBoard', 'friendlyHero'], false), [
        'localBoard',
        'remoteHero'
      ])
      const all = library.templates.find((t) => t.id === 'fire-blast-all-characters')
      const { presenter, timelines } = harness()
      const promise = presenter.play(all, true)
      const areas = presenter.layer.children[0].children
      assert.deepEqual(
        areas.map((a) => [a.children[0].width, a.children[0].height]),
        [
          [1400, 700],
          [280, 320],
          [280, 320]
        ]
      )
      assert.deepEqual(
        areas.map((a) => [a.position.x, a.position.y]),
        ['bothBoards', 'remoteHero', 'localHero'].map((id) => [
          MATCH_VFX_LAYOUT.areas[id].position.x,
          MATCH_VFX_LAYOUT.areas[id].position.y
        ])
      )
      timelines[0].events.onComplete()
      await promise
    }
  )
  await check(
    'Lab and match use matching authored area sizes and missile margins',
    () => {
      const { VFX_LAB_LAYOUT } = load('src/dev-tools/vfx-lab/vfx-lab-layout.ts')
      const mapping = {
        enemyBoard: 'remoteBoard',
        friendlyBoard: 'localBoard',
        bothBoards: 'bothBoards',
        enemyHero: 'remoteHero',
        friendlyHero: 'localHero'
      }
      for (const [labArea, matchArea] of Object.entries(mapping)) {
        assert.deepEqual(
          VFX_LAB_LAYOUT.aoe.blasts[labArea].size,
          MATCH_VFX_LAYOUT.areas[matchArea].size
        )
      }
      assert.equal(VFX_LAB_LAYOUT.missile.margin, MATCH_VFX_LAYOUT.missileMargin)
    }
  )
  await check(
    'derived triangle converts every real PNG pixel luminance to alpha and leaves shared source intact',
    () => {
      const originalFile = fs.readFileSync(
        path.join(root, 'assets/images/effects/spotlight-triangle.png')
      )
      const owner = new AoeMoteTexture(moteMocks.sharedTriangle)
      const data = owner.texture.source.resource.data
      const source = moteMocks.sharedSnapshot
      let black = 0
      let visible = 0
      assert.equal(data.length, source.length)
      for (let i = 0; i < source.length; i += 4) {
        const expected = Math.round(
          ((source[i] * 0.2126 + source[i + 1] * 0.7152 + source[i + 2] * 0.0722) *
            source[i + 3]) /
            255
        )
        assert.equal(data[i], 255)
        assert.equal(data[i + 1], 255)
        assert.equal(data[i + 2], 255)
        assert.equal(data[i + 3], expected)
        if (source[i] + source[i + 1] + source[i + 2] === 0) {
          black++
          assert.equal(data[i + 3], 0)
        } else if (expected > 0) visible++
      }
      assert.ok(black > 0)
      assert.ok(visible > 0)
      assert.deepEqual(moteMocks.sharedTriangle.source.resource.data, source)
      assert.deepEqual(originalFile, moteMocks.originalBytes)
      owner.destroy()
      owner.destroy()
      assert.equal(owner.texture.destroyCount, 1)
      assert.equal(owner.texture.source.destroyCount, 1)
      assert.equal(moteMocks.sharedTriangle.destroyCount, 0)
      assert.equal(moteMocks.sharedTriangle.source.destroyCount, 0)
    }
  )
  await check(
    'texture prewarm is synchronous and temporary resources clean up on success and failure',
    () => {
      const renderer = moteMocks.renderer()
      const draws = moteMocks.stats.draws
      const owner = new AoeMoteTexture(moteMocks.sharedTriangle, renderer)
      assert.equal(renderer.calls.length, 1)
      assert.equal(moteMocks.stats.draws, draws + 1)
      const { container, target } = renderer.calls[0]
      assert.equal(container.texture, owner.texture)
      assert.equal(container.destroyed, true)
      assert.deepEqual(target.renderOptions, { width: 32, height: 32, resolution: 1 })
      assert.equal(target.destroyCount, 1)
      assert.equal(target.source.destroyCount, 1)
      assert.equal(owner.texture.destroyed, false)
      owner.destroy()
      const failedRenderer = moteMocks.renderer(true)
      const start = moteMocks.stats.textures.length
      assert.throws(
        () => new AoeMoteTexture(moteMocks.sharedTriangle, failedRenderer),
        /deliberate warmup failure/
      )
      assert.equal(failedRenderer.calls.length, 1)
      assert.ok(
        moteMocks.stats.textures
          .slice(start)
          .every(
            (texture) => texture.destroyCount === 1 && texture.source.destroyCount === 1
          )
      )
      assert.equal(failedRenderer.calls[0].container.destroyed, true)
      assert.equal(moteMocks.sharedTriangle.destroyed, false)
    }
  )
  await check(
    'mote pool has staggered independent births/spin, normal blending, deterministic replay, and seeded variation',
    () => {
      const owner = new AoeMoteTexture(moteMocks.sharedTriangle)
      const a = new AoeMotes(owner.texture, { width: 1400, height: 370 }, 'a', 0)
      const b = new AoeMotes(owner.texture, { width: 1400, height: 370 }, 'b', 0)
      const c = new AoeMotes(owner.texture, { width: 1400, height: 370 }, 'c', 1)
      for (const pool of [a, b, c]) pool.setPalette(fire.tuning)
      const count = a.container.children.length
      assert.ok(count > 0 && count <= 16)
      assert.equal(new Set(a.motes.map((mote) => mote.birth)).size, count)
      assert.ok(
        a.motes.every(
          (mote) =>
            mote.birth >= 0.48 &&
            mote.birth < 0.7 &&
            mote.lifetime > 0 &&
            mote.birth + mote.lifetime <= 0.998 + 1e-12
        )
      )
      assert.ok(a.motes.some((mote) => mote.spin > 0))
      assert.ok(a.motes.some((mote) => mote.spin < 0))
      assert.equal(new Set(a.motes.map((mote) => mote.rotation)).size, count)
      assert.ok(
        a.container.children.every(
          (sprite) => sprite.blendMode === 'normal' && sprite.texture === owner.texture
        )
      )
      for (const pool of [a, b, c]) pool.update(0.72, 0.98, 1.65)
      const expected = moteSnapshot(a.container)
      assert.deepEqual(expected, moteSnapshot(b.container))
      assert.notDeepEqual(expected, moteSnapshot(c.container))
      a.update(1, 0.98, 1.65)
      assert.ok(
        a.container.children.every((sprite) => !sprite.visible && sprite.alpha === 0)
      )
      a.update(0, 0.98, 1.65)
      assert.ok(
        a.container.children.every((sprite) => !sprite.visible && sprite.alpha === 0)
      )
      a.update(0.72, 0.98, 1.65)
      assert.deepEqual(moteSnapshot(a.container), expected)
      assert.equal(a.container.children.length, count)
      for (const pool of [a, b, c]) {
        const sprites = [...pool.container.children]
        pool.destroy()
        pool.destroy()
        assert.ok(sprites.every((sprite) => sprite.destroyed))
        assert.equal(pool.container.destroyCount, 1)
      }
      assert.equal(owner.texture.destroyed, false)
      owner.destroy()
    }
  )
  await check(
    'rotating motes remain inside original spark ellipse and cool to soot before bounded expiry',
    () => {
      const owner = new AoeMoteTexture(moteMocks.sharedTriangle)
      for (const size of [
        { width: 1400, height: 370 },
        { width: 1400, height: 700 },
        { width: 280, height: 320 }
      ]) {
        for (const radius of [0.35, 0.98, 1.15]) {
          const pool = new AoeMotes(owner.texture, size, 'bounds', 4)
          pool.setPalette(fire.tuning)
          for (let step = 0; step <= 100; step++) {
            pool.update(step / 100, radius, 1.65)
            for (const sprite of pool.container.children.filter(
              (sprite) => sprite.visible
            )) {
              assert.ok(
                Number.isFinite(sprite.alpha) &&
                  sprite.alpha >= 0 &&
                  sprite.alpha <= 0.6
              )
              const cosine = Math.cos(sprite.rotation)
              const sine = Math.sin(sprite.rotation)
              for (const sx of [-1, 1])
                for (const sy of [-1, 1]) {
                  const x =
                    sprite.position.x +
                    ((sx * sprite.width) / 2) * cosine -
                    ((sy * sprite.height) / 2) * sine
                  const y =
                    sprite.position.y +
                    ((sx * sprite.width) / 2) * sine +
                    ((sy * sprite.height) / 2) * cosine
                  assert.ok(
                    (x / (size.width * 0.44 * radius)) ** 2 +
                      (y / (size.height * 0.44 * radius)) ** 2 <=
                      1 + 1e-12
                  )
                }
            }
          }
          const mote = pool.motes[0]
          pool.update(mote.birth + mote.lifetime * 0.05, radius, 1.65)
          assert.notEqual(mote.sprite.tint, 0x1f130b)
          pool.update(mote.birth + mote.lifetime * 0.99, radius, 1.65)
          assert.equal(mote.sprite.tint, 0x1f130b)
          pool.update(0.72, radius, 0)
          assert.ok(
            pool.container.children.every(
              (sprite) => !sprite.visible && sprite.alpha === 0
            )
          )
          pool.update(1, radius, 1.65)
          assert.ok(
            pool.container.children.every(
              (sprite) => !sprite.visible && sprite.alpha === 0
            )
          )
          pool.destroy()
        }
      }
      owner.destroy()
    }
  )
  await check(
    'Lab and match shader clocks and motes match across idle/replay for every AOE preset',
    async () => {
      const lab = new VfxLab({
        canvas: {},
        renderer: moteMocks.renderer(),
        parent: {},
        assets: {
          boardBase: {},
          burnNoise: {},
          playSpotlight1: {},
          ghostSpotlight: moteMocks.sharedTriangle
        }
      })
      lab.selectEffect('aoe')
      for (const template of library.templates.filter(
        (item) => item.family === 'aoe'
      )) {
        lab.selectTemplate(template.id)
        lab.play()
        for (const controllerIsLocal of [true, false]) {
          const { presenter, timelines } = harness()
          const shaderStart = shaderRecords.length
          const promise = presenter.play(template, controllerIsLocal)
          const matchShaders = shaderRecords.slice(shaderStart)
          const labShaders = [
            lab.aoeShader,
            lab.aoeImpactShader,
            lab.aoeFriendlyImpactShader
          ]
          for (const progress of [0, 0.15, 0.51, 0.65, 0.75, 0.9, 1]) {
            lab.playing = progress < 1
            lab.elapsedMS = progress * template.tuning.durationMs
            timelines[0].clock.progress = progress
            timelines[0].options.onUpdate()
            let expectedFrames
            for (const idleSeconds of [0, 487.25, 1e8]) {
              lab.clockSeconds = idleSeconds
              lab.updateAoe(progress)
              const frames = labShaders.map((shader) => shader.frames.at(-1))
              if (expectedFrames) assert.deepEqual(frames, expectedFrames)
              else expectedFrames = clone(frames)
              for (const [index, frame] of frames.entries()) {
                const matchFrame = matchShaders[index].frames.at(-1)
                assert.ok(Math.abs(frame[0] - matchFrame[0]) < 1e-12)
                assert.equal(frame[1], matchFrame[1])
              }
            }
            for (const zone of lab.aoeZones.filter((zone) => zone.group.visible)) {
              const id =
                zone.id === 'bothBoards'
                  ? 'bothBoards'
                  : zone.id
                      .replace('friendly', controllerIsLocal ? 'local' : 'remote')
                      .replace('enemy', controllerIsLocal ? 'remote' : 'local')
              const area = presenter.layer.children[0].children.find((view) =>
                view.label.endsWith('.' + id)
              )
              const matchMotes = area.children.find((view) =>
                view.label.endsWith('.motes')
              )
              assert.deepEqual(
                moteSnapshot(zone.motes.container),
                moteSnapshot(matchMotes),
                `${template.id}/${controllerIsLocal}/${zone.id}/${progress}`
              )
            }
          }
          timelines[0].events.onComplete()
          await promise
          presenter.dispose()
          lab.play()
          lab.update(0)
          assert.deepEqual(lab.aoeShader.frames.at(-1), [0, 0])
          assert.deepEqual(lab.aoeImpactShader.frames.at(-1), [1.7, 0])
          assert.deepEqual(lab.aoeFriendlyImpactShader.frames.at(-1), [1.7, 0])
        }
      }
      lab.dispose()
    }
  )
  await check(
    'owners reuse one prewarmed mask across casts/replays and release only owned resources',
    async () => {
      const { presenter, timelines, renderer } = harness()
      const texture = presenter.aoeMoteTexture.texture
      const drawCount = moteMocks.stats.draws
      assert.equal(renderer.calls.length, 1)
      for (let cast = 0; cast < 2; cast++) {
        const promise = presenter.play(fire, true)
        const timeline = timelines[cast]
        const pools = presenter.layer.children[0].children.map((area) =>
          area.children.find((view) => view.label.endsWith('.motes'))
        )
        const sprites = pools.flatMap((pool) => pool.children)
        assert.ok(sprites.every((sprite) => sprite.texture === texture))
        timeline.clock.progress = 0.75
        timeline.options.onUpdate()
        timeline.calls[0].callback()
        await promise
        assert.equal(texture.destroyed, false)
        assert.ok(pools.every((pool) => !pool.destroyed))
        timeline.events.onComplete()
        assert.ok(pools.every((pool) => pool.destroyed))
        assert.ok(sprites.every((sprite) => sprite.destroyed))
        assert.equal(texture.destroyed, false)
      }
      assert.equal(renderer.calls.length, 1)
      assert.equal(moteMocks.stats.draws, drawCount)
      presenter.dispose()
      presenter.dispose()
      assert.equal(texture.destroyCount, 1)
      assert.equal(texture.source.destroyCount, 1)
      const labRenderer = moteMocks.renderer()
      const lab = new VfxLab({
        canvas: {},
        renderer: labRenderer,
        parent: {},
        assets: {
          boardBase: {},
          burnNoise: {},
          playSpotlight1: {},
          ghostSpotlight: moteMocks.sharedTriangle
        }
      })
      const mask = lab.aoeMoteTexture.texture
      const labDrawCount = moteMocks.stats.draws
      lab.selectEffect('aoe')
      lab.selectTemplate('fire-blast-all-characters')
      lab.play()
      lab.updateAoe(0.75)
      const pools = lab.aoeZones.map((zone) => zone.motes.container)
      const sprites = pools.flatMap((pool) => pool.children)
      assert.ok(sprites.every((sprite) => sprite.texture === mask))
      const expected = lab.aoeZones.map((zone) => moteSnapshot(zone.motes.container))
      lab.play()
      lab.updateAoe(0)
      assert.ok(sprites.every((sprite) => !sprite.visible && sprite.alpha === 0))
      lab.updateAoe(0.75)
      assert.deepEqual(
        lab.aoeZones.map((zone) => moteSnapshot(zone.motes.container)),
        expected
      )
      assert.equal(labRenderer.calls.length, 1)
      assert.equal(moteMocks.stats.draws, labDrawCount)
      lab.dispose()
      lab.dispose()
      assert.equal(mask.destroyCount, 1)
      assert.ok(pools.every((pool) => pool.destroyed))
      assert.ok(sprites.every((sprite) => sprite.destroyed))
      assert.equal(moteMocks.sharedTriangle.destroyed, false)
      assert.deepEqual(
        moteMocks.sharedTriangle.source.resource.data,
        moteMocks.sharedSnapshot
      )
    }
  )
  const summary = {
    timestamp: new Date().toISOString(),
    passed: reports.filter((r) => r.passed).length,
    failed: reports.filter((r) => !r.passed).length,
    reports
  }
  console.log(
    `AOE focused checks: ${summary.passed} groups passed, ${summary.failed} failed.`
  )
  if (summary.failed) process.exitCode = 1
}
main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    if (savedDocument === undefined) delete global.document
    else global.document = savedDocument
  })
