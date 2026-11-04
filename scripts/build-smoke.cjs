const { existsSync, readdirSync, readFileSync, rmSync, statSync } = require('node:fs')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')

const rendererOutput = join(process.cwd(), 'out', 'renderer')
rmSync(rendererOutput, { recursive: true, force: true })

const result = spawnSync(
  process.execPath,
  [join(process.cwd(), 'scripts', 'run.cjs'), 'build'],
  {
    stdio: 'inherit',
    env: { ...process.env, CI: '1' }
  }
)

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

if (!existsSync(rendererOutput)) {
  throw new Error('Build smoke check could not find out/renderer')
}

const textFiles = []
function walk(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) walk(path)
    else if (/\.(?:js|css|html|map)$/u.test(entry)) textFiles.push(path)
  }
}
walk(rendererOutput)

const devOnlyMarkers = [
  'CardInspectorScene',
  'OutlineLabScene',
  'HeroPowerAnimScene',
  'VfxLabScene',
  'LayoutInspector',
  'hero-power-anim.controls',
  'vfx-lab.controls',
  'dev-tools/card-inspector',
  'dev-tools/outline-lab',
  'dev-tools/hero-power-anim',
  'dev-tools/vfx-lab',
  'dev-tools/runtime',
  'runMatchPerformanceBenchmark',
  'VITE_DEV_START_ROUTE'
]
const leakedMarkers = textFiles.flatMap((path) => {
  const source = readFileSync(path, 'utf8')
  return devOnlyMarkers
    .filter((marker) => source.includes(marker))
    .map((marker) => ({ path, marker }))
})

if (leakedMarkers.length > 0) {
  throw new Error(
    `Production build contains development-only markers: ${JSON.stringify(leakedMarkers)}`
  )
}

// External AI transports must not return through either desktop or renderer output.
walk(join(process.cwd(), 'out', 'main'))
walk(join(process.cwd(), 'out', 'preload'))
const externalAiMarkers = [
  'openrouter.ai',
  'azure-openai',
  '/chat/completions',
  'HSINSPIRED_AI_API_KEY',
  'HSINSPIRED_AZURE_OPENAI_API_KEY',
  'HSINSPIRED_OPENROUTER_API_KEY',
  'ai:decide',
  'ai:settings',
  'ai-key.local.txt',
  'openrouter-key.local.txt'
]
for (const path of new Set(textFiles)) {
  const source = readFileSync(path, 'utf8')
  const markers = externalAiMarkers.filter((marker) => source.includes(marker))
  if (markers.length) {
    throw new Error(
      `Production build contains external AI runtime: ${path}: ${markers.join(', ')}`
    )
  }
}

console.log(
  `Build smoke check passed (${new Set(textFiles).size} output files inspected).`
)
