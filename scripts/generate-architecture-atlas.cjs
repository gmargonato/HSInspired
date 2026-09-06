const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { analyzeCodebase } = require('./code-health-analysis.cjs')
const { atlasHtml, markdownReport, boundaryHtml } = require('./code-health-report.cjs')
const registry = require('../architecture/subsystems.cjs')

const root = path.resolve(__dirname, '..')
const output = path.join(root, 'artifacts', 'architecture')
const args = process.argv.slice(2)
if (args.length && (args.length !== 2 || args[0] !== '--focus' || !args[1]))
  throw new Error(
    'Usage: node scripts/generate-architecture-atlas.cjs [--focus <regular expression>]'
  )
const focus = args[1] || null
if (focus) new RegExp(focus)

const executable = path.join(
  root,
  'node_modules/dependency-cruiser/bin/dependency-cruise.mjs'
)
if (!fs.existsSync(executable))
  throw new Error('dependency-cruiser is not installed. Run npm install first.')
console.log('Reading source dependencies and configured boundary violations…')
const result = spawnSync(
  process.execPath,
  [
    executable,
    '--config',
    '.dependency-cruiser.cjs',
    '--output-type',
    'json',
    '--exclude',
    '\\.(test|spec)\\.ts$',
    'src'
  ],
  { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
)
if (result.error) throw result.error
let dependencies
try {
  dependencies = JSON.parse(result.stdout)
} catch {
  throw new Error(result.stderr || 'dependency-cruiser did not produce valid JSON.')
}
if (
  !Array.isArray(dependencies.modules) ||
  !dependencies.summary ||
  (result.status !== 0 && !dependencies.summary.violations?.length)
)
  throw new Error(result.stderr || `dependency-cruiser failed (${result.status}).`)

console.log('Resolving symbols, methods, state access and test relationships…')
const data = analyzeCodebase(root, dependencies, registry)
fs.mkdirSync(output, { recursive: true })
const writeJson = (name, value) =>
  fs.writeFileSync(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`)
writeJson('dependencies.json', dependencies)
writeJson('code-health.json', data)
fs.writeFileSync(path.join(output, 'health-report.md'), markdownReport(data))
fs.writeFileSync(path.join(output, 'atlas.html'), atlasHtml(data))
fs.writeFileSync(path.join(output, 'boundary-violations.html'), boundaryHtml(data))
if (focus) {
  fs.writeFileSync(path.join(output, 'focus.html'), atlasHtml(data, focus))
  writeJson('focus.json', {
    expression: focus,
    snapshot: data.snapshot,
    matchingFiles: data.files
      .filter((file) => new RegExp(focus).test(file.id))
      .map((file) => file.id),
    evidenceFile: 'code-health.json'
  })
}
writeJson('manifest.json', {
  generatedAt: data.generatedAt,
  snapshot: data.snapshot,
  analyzerVersion: data.analyzerVersion,
  visualAtlas: 'atlas.html',
  auditReport: 'health-report.md',
  evidence: 'code-health.json',
  dependencies: 'dependencies.json',
  boundaryReport: 'boundary-violations.html',
  ...(focus ? { focus: { expression: focus, file: 'focus.html' } } : {})
})
console.log(
  `Wrote artifacts/architecture/atlas.html, health-report.md and code-health.json (${data.findings.length} findings, ${data.diagnostics.length} compiler diagnostics, ${data.unresolved.length} unresolved calls).`
)
