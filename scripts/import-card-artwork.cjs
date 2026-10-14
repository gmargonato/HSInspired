const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { artworks } = require('./card-artwork-sources.json')
const { opaqueArtworkPng } = require('./card-artwork-png.cjs')

const workspace = path.resolve(__dirname, '..')
const artworkDirectory = path.join(workspace, 'assets/images/card-artwork')
const originalDirectory = path.join(workspace, 'assets/original')
const temporaryDirectory = path.join(workspace, '.tmp')
fs.mkdirSync(temporaryDirectory, { recursive: true })
const stagingDirectory = fs.mkdtempSync(
  path.join(temporaryDirectory, 'card-artwork-import-')
)

// Validate every input before moving any runtime artwork.
const imports = Object.entries(artworks).map(([cardId, entry]) => {
  assert.match(cardId, /^[a-z0-9_]+$/)
  const source = path.resolve(workspace, entry.source)
  assert.ok(source.startsWith(originalDirectory + path.sep))
  const bytes = fs.readFileSync(source)
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    entry.sha256,
    `Extracted artwork differs from the manifest: ${cardId}`
  )
  const opaque = opaqueArtworkPng(bytes)
  assert.equal(
    createHash('sha256').update(opaque).digest('hex'),
    entry.runtimeSha256,
    `Converted artwork differs from the manifest: ${cardId}`
  )
  const staged = path.join(stagingDirectory, `${cardId}.png`)
  fs.writeFileSync(staged, opaque)
  return { cardId, staged }
})

const files = fs.readdirSync(artworkDirectory)
const expectedFiles = new Set(imports.map(({ cardId }) => `${cardId}.png`))
const needsBackup = files.filter((file) => {
  if (!expectedFiles.has(file)) return true
  const entry = artworks[file.slice(0, -4)]
  const bytes = fs.readFileSync(path.join(artworkDirectory, file))
  return createHash('sha256').update(bytes).digest('hex') !== entry.runtimeSha256
})

if (needsBackup.length > 0) {
  const backupDirectory = path.join(
    workspace,
    '.tmp/card-artwork-backups',
    new Date().toISOString().replace(/[:.]/g, '-')
  )
  assert.ok(backupDirectory.startsWith(workspace + path.sep))
  fs.mkdirSync(backupDirectory, { recursive: true })
  for (const file of needsBackup) {
    const original = path.resolve(artworkDirectory, file)
    const backup = path.resolve(backupDirectory, file)
    assert.ok(original.startsWith(artworkDirectory + path.sep))
    assert.ok(backup.startsWith(backupDirectory + path.sep))
    assert.ok(fs.statSync(original).isFile(), `Unexpected artwork folder: ${file}`)
    fs.renameSync(original, backup)
  }
  console.log(`Preserved ${needsBackup.length} previous files in ${backupDirectory}`)
}

for (const { cardId, staged } of imports) {
  fs.renameSync(staged, path.join(artworkDirectory, `${cardId}.png`))
}
fs.rmdirSync(stagingDirectory)
console.log(
  `Imported ${imports.length} opaque PNGs without resizing or changing RGB pixels.`
)
