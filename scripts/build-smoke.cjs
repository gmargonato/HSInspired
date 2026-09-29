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
  'HeroPowerAnimScene',
  'VfxLabScene',
  'hero-power-anim.controls',
  'vfx-lab.controls',
  'features/dev/card-inspector',
  'features/dev/vfx-lab',
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

console.log(
  `Build smoke check passed (${textFiles.length} renderer output files inspected).`
)
