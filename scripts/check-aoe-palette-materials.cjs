/* CPU regression checks for shared AoE palette plumbing and deterministic dynamics.
 * Pixi stubs inspect uniforms, not GPU output. Use test:fire-aoe for WebGL coverage.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
function load(relativePath, imports = {}) {
  const filename = path.join(root, relativePath)
  const loaded = new Module(filename)
  loaded.require = (name) => (name in imports ? imports[name] : require(name))
  loaded._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true
      }
    }).outputText,
    filename
  )
  return loaded.exports
}

const contract = load('src/desktop/contracts/ipc/vfx-templates.ts')
const common = load('src/visual-components/effects/fire-vfx-shader-common.ts')
const layout = load('src/visual-components/effects/fire-aoe-layout.ts', {
  '../layout': {
    CENTER: { x: 0.5, y: 0.5 },
    placement: (position, size, options) => ({ position, size, ...options })
  }
})
const particles = load('src/visual-components/effects/fire-aoe-particles.ts', {
  './fire-aoe-layout': layout,
  './fire-aoe-authored.json': require('../src/visual-components/effects/fire-aoe-authored.json')
})
function material(options) {
  return {
    options,
    resources: Object.fromEntries(
      Object.entries(options.resources).map(([key, value]) => [
        key,
        key.startsWith('u')
          ? value
          : {
              uniforms: Object.fromEntries(
                Object.entries(value).map(([name, uniform]) => [name, uniform.value])
              )
            }
      ])
    ),
    destroy() {}
  }
}
const { FireAoeComposite, FireImpactMesh, createFireBoardGlow } = load(
  'src/visual-components/effects/fire-aoe-materials.ts',
  {
    './fire-vfx-shader-common': common,
    './fire-aoe-layout': layout,
    'pixi.js': {
      Filter: { from: material },
      Shader: { from: material },
      MeshGeometry: class {
        destroy() {}
      },
      Mesh: class {
        constructor(options) {
          Object.assign(this, options)
        }
        destroy() {}
      }
    }
  }
)
const texture = { source: {} }
const { DEFAULT_FIRE_AOE_TUNING: original, DEFAULT_FIRE_AOE_DYNAMICS: dynamics } =
  contract
const palette = { edge: '#071b42', flame: '#3b8bd1', core: '#d6f6ff' }
const appearance = {
  palette,
  glowColor: '#175ea9',
  emberColor: '#a5e8ff',
  impactColor: '#d6f6ff',
  smokeColor: '#597184',
  smokeOpacity: 0.4
}
let checks = 0
function equal(actual, expected, message) {
  assert.deepEqual(actual, expected, message)
  checks++
}
function check(value, message) {
  assert.ok(value, message)
  checks++
}

// An omitted appearance retains the extracted material constants exactly.
const originalComposite = new FireAoeComposite(texture, texture)
equal(
  originalComposite.filter.resources.fire.uniforms.uTint,
  [1, 0.936, 0.866],
  'original flame tint stays unchanged'
)
equal(
  originalComposite.filter.resources.fire.uniforms.uGlowColor,
  [0.97794116, 0.45752969, 0.26605755],
  'original halo stays unchanged'
)
equal(
  createFireBoardGlow().resources.glow.uniforms.uGlowColor,
  [0.41176471, 0.09803922, 0],
  'original board glow stays unchanged'
)
for (const custom of [{ palette }, appearance]) {
  const expectedGlow = common.hexColorToRgb(custom.glowColor ?? palette.flame)
  for (const glowPass of [false, true]) {
    const composite = new FireAoeComposite(texture, texture, glowPass, custom)
    const uniforms = composite.filter.resources.fire.uniforms
    equal(uniforms.uTint, [1, 1, 1], 'custom ramp has no inherited warm tint')
    equal(uniforms.uGlowColor, expectedGlow, 'halo uses the selected palette/override')
    composite.update(0.4, 1.7, 1.1, 0.6)
    equal(
      [uniforms.uAlpha, uniforms.uIntensity, uniforms.uRampIntensity, uniforms.uGlow],
      [0.4, 1.7, 1.1, 0.6],
      'palette leaves animated envelope and intensity controls independent'
    )
    composite.destroy()
  }
  equal(
    createFireBoardGlow(custom).resources.glow.uniforms.uGlowColor,
    Array.from(expectedGlow, (value) => value * 0.41176471),
    'board glow uses the palette/override at the original gain'
  )
}
for (const burst of [false, true]) {
  const originalImpact = new FireImpactMesh(texture, burst)
  const coloredImpact = new FireImpactMesh(texture, burst, appearance.impactColor)
  const base = originalImpact.shader.resources.impact.uniforms
  const colored = coloredImpact.shader.resources.impact.uniforms
  equal(base.uRecolor, 0, 'original target impact keeps extracted artwork colors')
  equal(colored.uRecolor, 1, 'custom target impact enables recoloring')
  equal(colored.uTint, common.hexColorToRgb(appearance.impactColor), 'impact tint')
  equal(colored.uMaterialColor, base.uMaterialColor, 'impact preserves authored energy')
  equal(colored.uIntensity, base.uIntensity, 'impact preserves authored intensity')
  coloredImpact.setParticleColor([0.3, 0.4, 0.5, 0.6])
  equal(
    colored.uParticleColor,
    [0.3, 0.4, 0.5, 0.6],
    'impact preserves particle envelope'
  )
  originalImpact.destroy()
  coloredImpact.destroy()
}

// Appearance must not move, re-time or resize any particle in any board coverage.
const make = particles.createFireParticles
const impact = particles.createFireImpactParticles
for (const coverage of ['full', 'opponent', 'friendly']) {
  for (const seed of [1, 17, 83]) {
    const baseline = make(coverage, original, seed)
    equal(
      make(coverage, { ...original, appearance }, seed),
      baseline,
      `${coverage}: palette alone preserves the entire particle simulation`
    )
    equal(
      make(coverage, { ...original, dynamics }, seed),
      baseline,
      `${coverage}: explicit default dynamics preserve omitted defaults`
    )
    equal(make(coverage, original, seed), baseline, `${coverage}: repeatable seed`)
    const varied = make(
      coverage,
      { ...original, dynamics: { ...dynamics, turbulence: 0.3 } },
      seed
    )
    for (const kind of ['fire', 'embers', 'smoke']) {
      const plain = baseline.find((value) => value.kind === kind)
      const stirred = varied.find((value) => value.kind === kind)
      const time = plain.birth + plain.life * 0.45
      const before = particles.fireParticleAt(plain, time, original.motion)
      const after = particles.fireParticleAt(stirred, time, original.motion)
      equal(
        [
          stirred.birth,
          stirred.life,
          stirred.position,
          stirred.direction,
          stirred.size
        ],
        [plain.birth, plain.life, plain.position, plain.direction, plain.size],
        `${coverage}: turbulence keeps the ${kind} emitter and clock unchanged`
      )
      equal(
        particles.fireParticleAt(stirred, time, original.motion),
        after,
        `${coverage}: ${kind} seek is deterministic`
      )
      check(
        Math.hypot(after.x - before.x, after.z - before.z) <=
          stirred.turbulence * 0.5 * Math.SQRT2 + 1e-9,
        `${coverage}: ${kind} turbulence stays within its authored displacement bound`
      )
      equal(after.alpha, before.alpha, `${coverage}: ${kind} opacity unchanged`)
    }
    const noTail = {
      ...original,
      dynamics: { ...dynamics, smokeAmount: 0, emberAmount: 0 }
    }
    check(
      [...make(coverage, noTail, seed), ...impact(noTail, seed)].every(
        (value) => value.kind !== 'smoke' && value.kind !== 'embers'
      ),
      `${coverage}: optional tails can be disabled independently`
    )
  }
}
equal(
  impact({ ...original, appearance }, 17),
  impact(original, 17),
  'target palette alone preserves target impact timing, count and geometry'
)

// Exercise the actual library values as new presets are added or tuned.
const library = contract.parseVfxTemplateLibrary(
  JSON.parse(fs.readFileSync(path.join(root, 'config/vfx-templates.json'), 'utf8'))
)
for (const template of library.templates.filter((value) => value.family === 'aoe')) {
  const tuning = template.tuning.fire
  for (const coverage of ['full', 'opponent', 'friendly']) {
    const values = [...make(coverage, tuning, 17), ...impact(tuning, 17)]
    check(
      values.every(
        (value) => Number.isFinite(value.birth + value.life) && value.life > 0
      ),
      `${template.id}: ${coverage} particles have finite positive lifetimes`
    )
    equal(
      values,
      [...make(coverage, tuning, 17), ...impact(tuning, 17)],
      `${template.id}: ${coverage} configured style is deterministic`
    )
  }
}
originalComposite.destroy()
console.log(
  `AoE palette materials: ${checks} CPU checks passed (original defaults, custom uniforms, target impacts, all board coverages, deterministic dynamics, configured presets).`
)
console.log(
  'Actual WebGL rendering and gameplay cue release are covered by test:fire-aoe.'
)
