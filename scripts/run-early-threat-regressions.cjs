const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const repoRoot = path.resolve(__dirname, '..')
const templateRoot = path.join(__dirname, 'ai-regressions', 'early-public-threat')
const suites = {
  controls: 'controls.test.ts.txt',
  integration: 'integration.test.ts.txt',
  shortlist: 'shortlist-regression.test.ts.txt'
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      'Usage: node scripts/run-early-threat-regressions.cjs [controls integration shortlist]\n' +
        'With no arguments, run all 43 cases (26 controls, 15 integration, 2 shortlist).\n' +
        'Requires the repository dependencies to be installed. Tests run serially in\n' +
        'a temporary directory; generated tests, config, cache and dependency link are removed.'
    )
    return
  }

  const selected = args.length ? [...new Set(args)] : Object.keys(suites)
  for (const name of selected) {
    if (!Object.hasOwn(suites, name)) {
      throw new Error(`Unknown suite "${name}". Use --help for supported suites.`)
    }
  }

  const dependencyRoot = fs.realpathSync(path.join(repoRoot, 'node_modules'))
  const vitest = path.join(
    path.dirname(require.resolve('vitest/package.json', { paths: [repoRoot] })),
    'vitest.mjs'
  )
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'early-public-threat-'))
  try {
    // Keep all generated .test files outside the checkout, as AGENTS.md requires.
    fs.symlinkSync(
      dependencyRoot,
      path.join(temporaryRoot, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    const sourceRoot = path.join(repoRoot, 'src').split(path.sep).join('/')
    const escapedSourceRoot = JSON.stringify(sourceRoot)
      .slice(1, -1)
      .replaceAll("'", "\\'")
    const testFiles = selected.map((name) => {
      const templateName = suites[name]
      const template = fs.readFileSync(path.join(templateRoot, templateName), 'utf8')
      if (!template.includes('__SOURCE_ROOT__')) {
        throw new Error(`Missing source-root token in ${templateName}.`)
      }
      const testName = templateName.replace(/\.txt$/, '')
      fs.writeFileSync(
        path.join(temporaryRoot, testName),
        template.replaceAll('__SOURCE_ROOT__', () => escapedSourceRoot),
        { flag: 'wx' }
      )
      return testName
    })

    const config = {
      root: temporaryRoot,
      cacheDir: path.join(temporaryRoot, '.vite'),
      resolve: {
        alias: {
          '@assets': path.join(repoRoot, 'assets'),
          '@outline-directions': path.join(
            repoRoot,
            'src/dev-tools/outline-lab/outline-directions-dev.ts'
          )
        }
      },
      test: {
        include: testFiles,
        maxWorkers: 1,
        fileParallelism: false,
        testTimeout: 30000
      }
    }
    const configPath = path.join(temporaryRoot, 'vitest.config.mjs')
    fs.writeFileSync(
      configPath,
      `export default ${JSON.stringify(config, null, 2)}\n`,
      {
        flag: 'wx'
      }
    )

    console.log(`Running early public-threat suites: ${selected.join(', ')}`)
    const child = spawn(
      process.execPath,
      [vitest, 'run', '--config', configPath, '--reporter=verbose'],
      { cwd: temporaryRoot, stdio: 'inherit' }
    )
    const interrupt = () => child.kill('SIGINT')
    const terminate = () => child.kill('SIGTERM')
    process.on('SIGINT', interrupt)
    process.on('SIGTERM', terminate)
    try {
      const result = await new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('close', (code, signal) => resolve({ code, signal }))
      })
      process.exitCode =
        result.code ??
        (result.signal === 'SIGINT' ? 130 : result.signal === 'SIGTERM' ? 143 : 1)
    } finally {
      process.off('SIGINT', interrupt)
      process.off('SIGTERM', terminate)
    }
  } finally {
    // This directory belongs only to this invocation. Never remove existing repo tests.
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
