/* Focused palette regression check; leaves no generated tests or repository files. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const Module = require('node:module')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')

// Exercise the real TypeScript modules without producing build artifacts.
function load(relativePath, imports = {}) {
  const filename = path.join(root, relativePath)
  const module = new Module(filename)
  module.require = (name) => (name in imports ? imports[name] : require(name))
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }).outputText,
    filename
  )
  return module.exports
}

async function main() {
  const contract = load('src/desktop/contracts/ipc/vfx-templates.ts')
  const model = load('src/dev-tools/vfx-lab/vfx-lab-model.ts')
  const common = load('src/visual-components/effects/fire-vfx-shader-common.ts')
  const { VfxTemplateRepository } = load(
    'src/desktop/main/services/vfx-template-repository.ts',
    {
      '../../contracts/ipc/vfx-templates': contract
    }
  )
  // The stub checks uniform plumbing only. Actual GPU rendering is separate QA.
  const { MissileVfxShader } = load(
    'src/visual-components/effects/missile-vfx-shader.ts',
    {
      './fire-vfx-shader-common': common,
      'pixi.js': {
        Filter: {
          from(options) {
            return {
              resources: {
                missileVfxUniforms: {
                  uniforms: Object.fromEntries(
                    Object.entries(options.resources.missileVfxUniforms).map(
                      ([key, value]) => [key, value.value]
                    )
                  )
                }
              }
            }
          }
        }
      }
    }
  )
  const { parseVfxTemplateLibrary: parse } = contract
  const raw = JSON.parse(
    fs.readFileSync(path.join(root, 'config/vfx-templates.json'), 'utf8')
  )
  let checks = 0
  for (const template of parse(raw).templates) {
    assert.deepEqual(
      model.templateFromSettings(template, model.settingsFromTemplate(template)),
      template
    )
    checks++
  }
  const colors = {
    flameColor: '#00eaff',
    coreColor: '#c2fffa',
    headSurfaceColor: '#1122cc',
    edgeColor: '#0055aa',
    foldColor: '#122266',
    glowColor: '#00aaff',
    sootColor: '#071122'
  }
  const template = raw.templates.find((item) => item.family === 'missile')
  assert.ok(template, 'Expected a missile preset')
  Object.assign(template.tuning, colors)
  const parsed = parse(raw).templates.find((item) => item.family === 'missile')
  const round = model.templateFromSettings(parsed, model.settingsFromTemplate(parsed))
  assert.deepEqual(round, parsed)
  checks++
  const shader = new MissileVfxShader({ source: {} })
  const uniforms = shader.filter.resources.missileVfxUniforms.uniforms
  shader.setPalette(round.tuning)
  for (const [key, value] of Object.entries(colors)) {
    assert.deepEqual(
      uniforms[`u${key[0].toUpperCase()}${key.slice(1)}`],
      common.hexColorToRgb(value)
    )
    checks++
    for (const invalid of ['red', '#abc', '#zzzzzz', '#12345678', null, 123]) {
      const test = structuredClone(raw)
      test.templates.find((item) => item.family === 'missile').tuning[key] = invalid
      assert.throws(() => parse(test), new RegExp(key))
      checks++
    }
  }
  delete parsed.tuning.headSurfaceColor
  assert.equal(
    model.settingsFromTemplate(parsed).headSurfaceColor,
    parsed.tuning.edgeColor
  )
  checks++
  for (const key of ['edgeColor', 'foldColor', 'glowColor', 'sootColor'])
    delete parsed.tuning[key]
  const legacy = model.settingsFromTemplate(parsed)
  shader.setPalette(parsed.tuning)
  for (const key of [
    'headSurfaceColor',
    'edgeColor',
    'foldColor',
    'glowColor',
    'sootColor'
  ]) {
    assert.deepEqual(
      uniforms[`u${key[0].toUpperCase()}${key.slice(1)}`],
      common.hexColorToRgb(legacy[key])
    )
    checks++
  }
  assert.equal(legacy.headSurfaceColor, parsed.tuning.flameColor)
  assert.equal(legacy.sootColor, model.DEFAULT_VFX_LAB_SETTINGS.sootColor)
  checks += 2
  const zeroSettings = { ...legacy, headGrowthMs: 0, missileGlow: 0 }
  const saved = {
    version: 1,
    templates: [model.templateFromSettings(parsed, zeroSettings)]
  }
  assert.deepEqual(
    model.settingsFromTemplate(parse(JSON.parse(JSON.stringify(saved))).templates[0]),
    zeroSettings
  )
  checks++

  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'hsi-vfx-palette-'))
  try {
    const file = path.join(directory, 'nested', 'vfx-templates.json')
    const repository = new VfxTemplateRepository(file)
    await repository.save(raw)
    assert.deepEqual(parse(JSON.parse(await fsp.readFile(file, 'utf8'))), raw)
    checks++
    template.tuning.headSurfaceColor = '#26ee55'
    await repository.save(raw)
    assert.deepEqual(parse(JSON.parse(await fsp.readFile(file, 'utf8'))), raw)
    assert.deepEqual(await fsp.readdir(path.dirname(file)), ['vfx-templates.json'])
    checks += 2
  } finally {
    await fsp.rm(directory, { recursive: true, force: true })
  }
  console.log(
    `Missile VFX: ${checks} checks passed (palette validation, defaults, model serialization, uniform plumbing, repository save/reload).`
  )
  console.log(
    'GPU rendering and browser/Electron Save integration are separate checks.'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
