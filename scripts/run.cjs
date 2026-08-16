const { spawn } = require('node:child_process')

const BANNED_FLAGS = ['--use-system-ca']

if (process.env.NODE_OPTIONS) {
  const flags = process.env.NODE_OPTIONS.split(/\s+/).filter(Boolean)
  const cleaned = flags.filter((flag) => !BANNED_FLAGS.includes(flag))
  process.env.NODE_OPTIONS = cleaned.join(' ')
}

const electronVite = require
  .resolve('electron-vite/package.json', {
    paths: [__dirname]
  })
  .replace('package.json', 'bin/electron-vite.js')
const args = process.argv.slice(2)

const child = spawn(process.execPath, [electronVite, ...args], {
  stdio: 'inherit',
  env: process.env
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
  } else {
    process.exit(code ?? 0)
  }
})

child.on('error', (error) => {
  console.error('Failed to start electron-vite:', error.message)
  process.exit(1)
})
