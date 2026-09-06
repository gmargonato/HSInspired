const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { spawnSync } = require('node:child_process')
const { analyzeCodebase } = require('./code-health-analysis.cjs')
const { atlasHtml, markdownReport } = require('./code-health-report.cjs')

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-code-health-'))
const cleanupRoot = path.resolve(temporaryRoot)
assert.equal(path.dirname(cleanupRoot), path.resolve(os.tmpdir()))
assert.ok(path.basename(cleanupRoot).startsWith('hs-code-health-'))
const write = (file, text) => {
  const destination = path.join(temporaryRoot, file)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.writeFileSync(destination, text)
}
try {
  write(
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: 'ES2022',
        module: 'commonjs',
        skipLibCheck: true
      },
      include: ['src/**/*.ts']
    })
  )
  write(
    'src/game/engine.ts',
    `
export interface Runner { run(value: number): number }
export class Engine implements Runner {
  count = 0
  items: number[] = []
  run(value: number) { this.count += value; this.items.push(value); return this.count }
  wrapper(value: number) { return this.run(value) }
  transform(value: number) { return this.run(value + 1) }
  local(value: number) { const result = this.run(value); return result }
  nested() { return [1].map(value => { if (value > 0) return value; return 0 }) }
}
export function invoke(runner: Runner) { return runner.run(2) }
export function make() { return new Engine() }
`
  )
  write(
    'src/game/index.ts',
    `export { Engine as PublicEngine } from './engine'; export type { Runner } from './engine'`
  )
  write(
    'src/main/use.ts',
    `import { PublicEngine } from '../game'; import type { Runner } from '../game'; export const engine = new PublicEngine(); export function use(): Runner { engine.run(1); return engine }`
  )
  write(
    'src/game/engine.spec.ts',
    `import { Engine } from './engine'; const instance = new Engine(); instance.run(1)`
  )
  write(
    'src/game/type-a.ts',
    `import type { B } from './type-b'; export interface A { b: B }`
  )
  write(
    'src/game/type-b.ts',
    `import type { A } from './type-a'; export interface B { a: A }`
  )
  write(
    'src/game/value-a.ts',
    `import { b } from './value-b'; export function a(): number { return b() }`
  )
  write(
    'src/game/value-b.ts',
    `import { a } from './value-a'; export function b(): number { return a() }`
  )
  write(
    'src/game/broken.ts',
    `declare const mystery: any; mystery.notKnown(); const invalid: string = 4`
  )
  write(
    'src/game/events.ts',
    `declare const events: { on(event: string, callback: () => void): void }; export function listen() { events.on('done', () => {}) }`
  )
  write('src/game/bom.ts', '\uFEFFexport const bom = 1')
  write(
    'src/main/lazy.ts',
    `export const load = () => import('../game/engine'); declare const name: string; export const dynamic = () => import(name)`
  )
  write(
    'node_modules/electron/index.d.ts',
    `export const ipcMain: { handle(channel: string, callback: () => number): void }; export const ipcRenderer: { invoke(channel: string): Promise<number> }`
  )
  write(
    'src/main/ipc.ts',
    `import { ipcMain, ipcRenderer } from 'electron'; const channel = 'match:save' as const; ipcMain.handle(channel, () => 1); ipcRenderer.invoke(channel)`
  )
  const registry = {
    subsystems: [
      {
        id: 'engine',
        roots: ['src/game/'],
        entryPoints: ['src/game/engine.ts', 'src/game/missing.ts']
      },
      { id: 'broad', roots: ['src/'], entryPoints: [] }
    ],
    flows: [{ id: 'story', steps: ['invented'], name: 'Story' }]
  }
  const cruise = {
    modules: [],
    summary: {
      violations: [
        {
          from: 'src/main/use.ts',
          to: 'src/game/engine.ts',
          rule: { name: 'fixture-rule', severity: 'error' }
        }
      ]
    }
  }
  const data = analyzeCodebase(temporaryRoot, cruise, registry, ['tsconfig.json'])
  assert.deepEqual(
    data.snapshot.changedSinceRead,
    [],
    'BOM normalization must not report a concurrent edit'
  )
  assert.ok(
    data.relationships.some(
      (item) => item.kind === 'imports-dynamic' && item.to === 'src/game/engine.ts'
    )
  )
  assert.ok(
    data.unresolved.some(
      (item) => item.kind === 'dynamic-import' && item.expression === 'name'
    )
  )
  const symbol = (name) => {
    const found = data.symbols.find((item) => item.qualifiedName.endsWith(name))
    assert.ok(found, `Missing symbol ${name}`)
    return found
  }
  const edge = (from, to, kind) =>
    data.relationships.find(
      (item) => item.from === from && item.to === to && item.kind === kind
    )
  const engine = symbol('::Engine'),
    run = symbol('::Engine::run'),
    wrapper = symbol('::Engine::wrapper')
  assert.ok(edge(wrapper.id, run.id, 'calls'), 'Resolved direct method call')
  assert.ok(
    edge(symbol('::Engine::local').id, run.id, 'calls'),
    'Local initializer remains owned by method'
  )
  assert.ok(
    edge('src/main/use.ts', engine.id, 'imports-symbol'),
    'Alias through barrel resolves original class'
  )
  assert.ok(
    edge(symbol('::make').id, engine.id, 'constructs'),
    'Constructor target is class'
  )
  const declared = edge(symbol('::invoke').id, symbol('::Runner::run').id, 'calls')
  assert.equal(declared.dispatch, 'declared-target')
  assert.equal(
    edge(symbol('::Runner::run').id, run.id, 'possible-implementation').evidence,
    'inferred'
  )
  assert.ok(edge(run.id, symbol('::Engine::count').id, 'writes-state'))
  assert.equal(
    edge(run.id, symbol('::Engine::items').id, 'writes-state').evidence,
    'inferred'
  )
  assert.equal(wrapper.metrics.exactForwarder, true)
  assert.equal(symbol('::Engine::transform').metrics.exactForwarder, false)
  assert.equal(
    symbol('::Engine::nested').metrics.branches,
    0,
    'Nested callbacks have their own complexity'
  )
  assert.deepEqual(run.usage.testFiles, ['src/game/engine.spec.ts'])
  assert.ok(run.usage.productionCallers.every((id) => !id.includes('.spec.ts')))
  assert.equal(
    data.cycles.filter((item) => item.kind === 'value-import-component').length,
    1
  )
  assert.equal(
    data.cycles.filter((item) => item.kind === 'type-involved-component').length,
    1
  )
  assert.ok(
    data.relationships.some((item) => item.kind === 're-exports' && item.typeOnly)
  )
  assert.ok(
    data.relationships.some(
      (item) => item.kind === 'registers-handler' && item.evidence === 'inferred'
    )
  )
  assert.ok(
    data.relationships.some(
      (item) => item.kind === 'handles-channel' && item.to === 'channel:match:save'
    )
  )
  assert.ok(
    data.relationships.some(
      (item) => item.kind === 'invokes-channel' && item.to === 'channel:match:save'
    )
  )
  assert.ok(data.unresolved.some((item) => item.expression === 'mystery.notKnown'))
  assert.ok(data.diagnostics.some((item) => item.code === 2322))
  assert.ok(data.findings.some((item) => item.level === 'violation'))
  assert.equal(data.classification.missingEntryPoints.length, 1)
  assert.ok(data.classification.overlaps.length)
  assert.equal(data.curatedFlows[0].verified, false)
  const endpoints = new Set(
    [...data.files, ...data.symbols, ...data.externalTargets].map((item) => item.id)
  )
  for (const relationship of data.relationships) {
    assert.ok(endpoints.has(relationship.from) && endpoints.has(relationship.to))
    assert.ok(relationship.location.line > 0)
  }
  const report = markdownReport(data)
  for (const finding of data.findings)
    assert.ok(report.includes(finding.id), 'Markdown retains every finding')
  const html = atlasHtml(data, 'src/game')
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1]
  new vm.Script(script)
  const malicious = {
    ...data,
    curatedFlows: [{ text: '</script><script>alert(1)</script>' }]
  }
  assert.equal(
    (atlasHtml(malicious).match(/<script>/g) || []).length,
    1,
    'Embedded data cannot terminate the script'
  )
  // A small browser DOM harness exercises rendered lists, selection and navigation.
  const listeners = {},
    elements = new Map()
  for (const selector of ['#search', '#scope', '#results', '#details', '#neighborhood'])
    elements.set(selector, {
      value: selector === '#scope' ? 'production' : '',
      innerHTML: '',
      addEventListener(type, callback) {
        listeners[selector + ':' + type] = callback
      }
    })
  const document = {
    querySelector: (selector) => elements.get(selector),
    querySelectorAll: () => [],
    addEventListener: (event, handler) => {
      listeners[event] = handler
    }
  }
  vm.runInNewContext(script, { document })
  assert.ok(elements.get('#results').innerHTML.includes('Engine'))
  listeners.click({
    target: {
      closest: (selector) =>
        selector === '[data-node]' ? { dataset: { node: run.id } } : null
    }
  })
  assert.ok(elements.get('#details').innerHTML.includes('writes-state'))
  assert.ok(elements.get('#neighborhood').innerHTML.includes('<svg'))
  listeners.click({
    target: {
      closest: (selector) =>
        selector === '[data-view]' ? { dataset: { view: 'confidence' } } : null
    }
  })
  assert.ok(elements.get('#results').innerHTML.includes('Compiler diagnostics'))
  const again = analyzeCodebase(temporaryRoot, cruise, registry, ['tsconfig.json'])
  assert.equal(again.snapshot.sourceHash, data.snapshot.sourceHash)
  assert.deepEqual(
    again.relationships,
    data.relationships,
    'Relationships are deterministic'
  )
  write('src/game/new-file.ts', 'export const changed = true')
  assert.notEqual(
    analyzeCodebase(temporaryRoot, cruise, registry, ['tsconfig.json']).snapshot
      .sourceHash,
    data.snapshot.sourceHash
  )
  // Exercise the real CLI, including valid nonzero dependency-rule results.
  for (const script of [
    'generate-architecture-atlas.cjs',
    'code-health-analysis.cjs',
    'code-health-report.cjs'
  ])
    write(`scripts/${script}`, fs.readFileSync(path.join(__dirname, script), 'utf8'))
  write('architecture/subsystems.cjs', `module.exports = ${JSON.stringify(registry)}`)
  write('tsconfig.node.json', '{"extends":"./tsconfig.json"}')
  write('tsconfig.web.json', '{"extends":"./tsconfig.json"}')
  write(
    'node_modules/dependency-cruiser/bin/dependency-cruise.mjs',
    `console.log(${JSON.stringify(JSON.stringify(cruise))}); process.exitCode = 1`
  )
  const command = (args) =>
    spawnSync(process.execPath, ['scripts/generate-architecture-atlas.cjs', ...args], {
      cwd: temporaryRoot,
      encoding: 'utf8',
      env: { ...process.env, NODE_PATH: path.resolve(__dirname, '../node_modules') }
    })
  const generated = command(['--focus', 'src/game/'])
  assert.equal(generated.status, 0, generated.stderr)
  const generatedData = JSON.parse(
    fs.readFileSync(
      path.join(temporaryRoot, 'artifacts/architecture/code-health.json'),
      'utf8'
    )
  )
  assert.ok(generatedData.findings.some((item) => item.level === 'violation'))
  assert.ok(
    fs.existsSync(path.join(temporaryRoot, 'artifacts/architecture/focus.html'))
  )
  assert.equal(
    JSON.parse(
      fs.readFileSync(
        path.join(temporaryRoot, 'artifacts/architecture/manifest.json'),
        'utf8'
      )
    ).focus.expression,
    'src/game/'
  )
  assert.notEqual(command(['--focus', '[']).status, 0, 'Reject invalid focus regex')
  assert.notEqual(command(['--focus']).status, 0, 'Reject missing focus regex')
  write(
    'node_modules/dependency-cruiser/bin/dependency-cruise.mjs',
    'console.log("not-json"); process.exitCode = 1'
  )
  assert.notEqual(
    command([]).status,
    0,
    'Do not present analyzer crashes as boundary findings'
  )
  console.log(
    'Code health fixtures passed: resolution, dispatch, ownership, cycles, IPC, tests, diagnostics, provenance, complete exports and atlas interactions.'
  )
} finally {
  fs.rmSync(cleanupRoot, { recursive: true, force: true })
}
