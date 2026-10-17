/** CPU-side checks against the extracted Fireball runtime, not the retired shader.
 * Uses real Pixi objects/uniforms with a no-op renderer; GPU pixels are separate QA.
 * Bundles TypeScript in memory and leaves no generated tests or artifacts.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { buildSync } = require('esbuild')
const { DOMAdapter, Texture } = require('pixi.js')

const root = path.resolve(__dirname, '..')
// Shader construction probes precision; no canvas or WebGL rendering is needed.
DOMAdapter.set({
  ...DOMAdapter.get(),
  createCanvas: () => ({ getContext: () => null })
})
const source = buildSync({
  stdin: {
    contents: `
      export { FireballEffect } from './src/visual-components/effects/fireball-effect';
      export { FIREBALL_LAYOUT } from './src/visual-components/effects/fireball-layout';
      export { hexColorToRgb } from './src/visual-components/effects/fire-vfx-shader-common';
      export { parseVfxTemplateLibrary } from './src/desktop/contracts/ipc/vfx-templates';
      export { settingsFromTemplate, templateFromSettings } from './src/dev-tools/vfx-lab/vfx-lab-model';
    `,
    resolveDir: root,
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  external: ['pixi.js']
}).outputFiles[0].text
const filename = path.join(root, 'fireball-tuning-check.cjs')
const compiled = new Module(filename)
compiled.paths = Module._nodeModulePaths(root)
compiled._compile(source, filename)
const {
  FireballEffect,
  FIREBALL_LAYOUT: layout,
  hexColorToRgb,
  parseVfxTemplateLibrary: parse,
  settingsFromTemplate,
  templateFromSettings
} = compiled.exports

const library = parse(
  JSON.parse(fs.readFileSync(path.join(root, 'config/vfx-templates.json'), 'utf8'))
)
const baseline = library.templates.find((template) => template.id === 'fire-missile')
assert.equal(baseline?.family, 'missile')
const assets = Object.fromEntries(
  [
    'CoreClouds',
    'CoreShadows',
    'Crescent',
    'Erosion',
    'Fill',
    'Glow',
    'ImpactFlash',
    'Scorch',
    'Smoke',
    'Spark'
  ].map((name) => ['fireball' + name, Texture.WHITE])
)
const renders = []
const renderer = { render: (request) => renders.push(request) }
const make = (tuning, prewarmed = false) =>
  new FireballEffect(renderer, assets, {
    source: { x: 960, y: 830 },
    target: { x: 960, y: 175 },
    tuning,
    seed: 1,
    prewarmed
  })
const parsedTuning = (tuning) =>
  parse({ version: 1, templates: [{ ...baseline, tuning }] }).templates[0].tuning
const roundTrip = (template) =>
  templateFromSettings(template, settingsFromTemplate(template))
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6)
const tint = (mesh, color) =>
  assert.deepEqual(mesh.shader.resources.fireball.uniforms.uTint, hexColorToRgb(color))

// A missing optional delay must not appear merely by opening/saving in the Lab.
const omitted = { ...baseline, tuning: { ...baseline.tuning } }
delete omitted.tuning.launchDelayMs
assert.ok(!('launchDelayMs' in parsedTuning(omitted.tuning)))
assert.ok(!('launchDelayMs' in roundTrip(omitted).tuning))
for (const launchDelayMs of [0, 80, 1000, 2000]) {
  const template = {
    ...baseline,
    tuning: parsedTuning({ ...baseline.tuning, launchDelayMs })
  }
  assert.deepEqual(roundTrip(template), template)
  const effect = make(template.tuning)
  close(effect.launchSeconds, launchDelayMs / 1000)
  close(effect.impactSeconds, launchDelayMs / 1000 + template.tuning.durationMs / 1000)
  assert.ok(effect.duration > effect.impactSeconds)
  effect.update(effect.impactSeconds - 0.0001)
  assert.equal(effect.impact.display.visible, false)
  effect.update(effect.impactSeconds + 0.000001)
  assert.equal(effect.impact.display.visible, true)
  close(effect.flightRoot.y, -655)
  if (launchDelayMs < 1000) {
    const birthParticles = effect.batches
      .filter((batch) => batch.phase === 'birth')
      .flatMap((batch) => batch.particles)
    assert.ok(birthParticles.every((particle) => particle.birth < effect.launchSeconds))
    if (launchDelayMs === 0) {
      assert.equal(birthParticles.length, 0)
      assert.equal(effect.birth.display.visible, false)
    } else {
      effect.update(effect.launchSeconds / 2)
      assert.equal(effect.missile.display.visible, false)
      close(
        effect.birth.core.shader.resources.core.uniforms.uRadius,
        (0.3 * template.tuning.headEndSize) /
          (layout.coreDiameter * layout.worldPixels) /
          2
      )
    }
  }
  effect.dispose()
  effect.dispose()
  assert.equal(effect.container.destroyed, true)
}
for (const value of [-1, 2001, NaN, Infinity, '80', null, false]) {
  assert.throws(
    () => parsedTuning({ ...baseline.tuning, launchDelayMs: value }),
    /launchDelayMs/
  )
}
const edited = settingsFromTemplate(omitted)
edited.launchDelayMs = 80
assert.equal(templateFromSettings(omitted, edited).tuning.launchDelayMs, 80)

// Original material mode and omitted mode retain native timing/color uniforms.
for (const useOriginalColors of [undefined, true]) {
  const tuning = { ...omitted.tuning }
  delete tuning.useOriginalColors
  if (useOriginalColors !== undefined) tuning.useOriginalColors = useOriginalColors
  const effect = make(tuning)
  assert.equal(effect.launchSeconds, 1)
  close(effect.impactSeconds, 1.4)
  effect.update(1.3)
  for (const phase of ['birth', 'missile', 'impact']) {
    assert.deepEqual(effect[phase].clearColor, [0.45490196, 0.25128558, 0.08384467, 0])
    if (phase !== 'impact')
      assert.equal(effect[phase].core.shader.resources.core.uniforms.uRecolor, 0)
  }
  for (const mesh of [
    effect.glow,
    effect.birthGlow,
    effect.flash,
    ...effect.batches.map((b) => b.mesh)
  ])
    assert.equal(mesh.shader.resources.fireball.uniforms.uRecolor, 0)
  effect.dispose()
}

// Every visible layer reads the custom palette, including folds, glow and scorch.
const palette = {
  flameColor: '#00aaff',
  coreColor: '#d8f4ff',
  headSurfaceColor: '#3159ff',
  edgeColor: '#1738be',
  foldColor: '#281060',
  glowColor: '#3366dd',
  sootColor: '#101328'
}
const custom = {
  ...baseline.tuning,
  ...palette,
  useOriginalColors: false,
  launchDelayMs: 80
}
const effect = make(custom)
for (const phase of ['birth', 'missile', 'impact']) {
  const field = effect[phase]
  assert.equal(field.clearColor[0], 0)
  close(field.clearColor[2], 0.45490196)
  if (phase !== 'impact') {
    const uniforms = field.core.shader.resources.core.uniforms
    assert.equal(uniforms.uRecolor, 1)
    assert.deepEqual(uniforms.uTint, hexColorToRgb(palette.headSurfaceColor))
    assert.deepEqual(uniforms.uFoldTint, hexColorToRgb(palette.foldColor))
  }
}
tint(effect.glow, palette.glowColor)
tint(effect.birthGlow, palette.glowColor)
tint(effect.flash, palette.coreColor)
for (const batch of effect.batches) {
  const name = batch.particles[0].name
  const color =
    name === 'Smoke01' || name === 'BlastMark'
      ? palette.sootColor
      : name === 'Sparks01'
        ? palette.coreColor
        : name === 'FireParticleLeft' || name === 'FireParticleRight'
          ? palette.edgeColor
          : palette.flameColor
  assert.equal(batch.mesh.shader.resources.fireball.uniforms.uRecolor, 1)
  tint(batch.mesh, color)
}
effect.update(effect.impactSeconds + 0.000001)
assert.ok(
  renders.some(
    (request) => request.target === effect.impact.heat && request.clearColor[0] === 0
  )
)
effect.dispose()

const fallback = { ...custom }
for (const key of ['headSurfaceColor', 'foldColor', 'glowColor', 'sootColor'])
  delete fallback[key]
const fallbackEffect = make(fallback)
assert.deepEqual(
  fallbackEffect.missile.core.shader.resources.core.uniforms.uTint,
  hexColorToRgb(fallback.edgeColor)
)
assert.deepEqual(
  fallbackEffect.missile.core.shader.resources.core.uniforms.uFoldTint,
  hexColorToRgb(fallback.edgeColor)
)
tint(fallbackEffect.glow, fallback.flameColor)
tint(
  fallbackEffect.batches.find((batch) => batch.particles[0].name === 'Smoke01').mesh,
  '#1f130b'
)
fallbackEffect.dispose()

for (const missileWidth of [0.16, 0.32, 0.48]) {
  const sized = make({ ...custom, missileWidth })
  close(sized.scale / layout.worldPixels, missileWidth / 0.32)
  sized.update(sized.impactSeconds + 0.000001)
  close(sized.flightRoot.y, -655)
  sized.dispose()
}
const prewarmed = make(custom, true)
assert.equal(prewarmed.launchSeconds, 0)
close(prewarmed.impactSeconds, custom.durationMs / 1000)
assert.equal(prewarmed.birth.display.visible, false)
prewarmed.dispose()

for (const template of library.templates.filter(
  (entry) => entry.family === 'missile'
)) {
  assert.deepEqual(roundTrip(template), template)
  const preset = make(template.tuning)
  preset.update(preset.impactSeconds + 0.000001)
  assert.equal(preset.impact.display.visible, true)
  preset.dispose()
}
console.log(
  'Fireball tuning checks passed: optional launch validation, Lab round-trip, original defaults, palette uniforms, short-cast emission, arrival timing, scaling and cleanup.'
)
console.log(
  'These checks use the current extracted renderer. GPU appearance and shader compilation require the separate visual checks.'
)
