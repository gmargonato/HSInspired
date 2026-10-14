const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { once } = require('node:events')
const { createHash } = require('node:crypto')
const { createServer } = require('vite')
const { artworks } = require('./card-artwork-sources.json')

const workspace = path.resolve(__dirname, '..')
const artworkDirectory = path.join(workspace, 'assets/images/card-artwork')
const resolverPath = path.join(
  workspace,
  'src/visual-components/assets/card-asset-resolver.ts'
)
const servedCards = [
  'classic_shield_slam',
  'classic_brawl',
  'classic_acolyte_of_pain',
  'whispers_of_the_old_gods_disciple_of_cthun',
  'basic_fireball',
  'basic_assassins_blade',
  'basic_darkspear_hunter',
  'knights_of_the_frozen_throne_frost_lich_jaina',
  'the_grand_tournament_beneath_the_grounds',
  'basic_arcane_missiles',
  'basic_mirror_image',
  'classic_ice_block',
  'mean_streets_of_gadgetzan_manic_soulcaster'
]
const aliases = [
  ['mean_streets_of_gadgetzan_jade_golem_3', 'mean_streets_of_gadgetzan_jade_golem_1'],
  ['mean_streets_of_gadgetzan_jade_golem_6', 'mean_streets_of_gadgetzan_jade_golem_4'],
  ['mean_streets_of_gadgetzan_jade_golem_19', 'mean_streets_of_gadgetzan_jade_golem_7'],
  [
    'mean_streets_of_gadgetzan_jade_golem_30',
    'mean_streets_of_gadgetzan_jade_golem_20'
  ],
  [
    'mean_streets_of_gadgetzan_jade_idol_shuffle_choice',
    'mean_streets_of_gadgetzan_jade_idol'
  ],
  [
    'mean_streets_of_gadgetzan_kun_refresh_choice',
    'mean_streets_of_gadgetzan_kun_the_forgotten_king'
  ],
  [
    'mean_streets_of_gadgetzan_kazakus_demon_8',
    'mean_streets_of_gadgetzan_kazakus_demon_2'
  ],
  [
    'mean_streets_of_gadgetzan_kazakus_potion_5_mystic_wool_goldthorn',
    'mean_streets_of_gadgetzan_kazakus_potion_5_felbloom_goldthorn'
  ],
  ['zombeast:basic_bloodfen_raptor:basic_stonetusk_boar', 'basic_bloodfen_raptor']
]

async function main() {
  // Use Vite's real glob and URL handling without starting the app or HMR.
  const vite = await createServer({
    configFile: false,
    root: path.join(workspace, 'src/application'),
    resolve: { alias: { '@assets': path.join(workspace, 'assets') } },
    optimizeDeps: { noDiscovery: true },
    server: {
      middlewareMode: true,
      hmr: false,
      ws: false,
      watch: null,
      preTransformRequests: false
    },
    appType: 'custom',
    logLevel: 'error'
  })
  let assetServer
  try {
    const moduleUrl = '/@fs/' + resolverPath.replaceAll('\\', '/')
    const resolver = await vite.ssrLoadModule(moduleUrl)
    const { CARD_CATALOG } = await vite.ssrLoadModule(
      '/@fs/' +
        path
          .join(workspace, 'src/game-rules/content/cards/card-catalog.ts')
          .replaceAll('\\', '/')
    )
    const { createZombeastDefinitions } = await vite.ssrLoadModule(
      '/@fs/' +
        path
          .join(workspace, 'src/game-rules/content/cards/zombeast.ts')
          .replaceAll('\\', '/')
    )
    const files = fs
      .readdirSync(artworkDirectory)
      .filter((file) => /\.(jpg|jpeg|png)$/i.test(file))
    assert.ok(files.length > 0, 'No artwork files found')
    assert.deepEqual(
      files.sort(),
      Object.keys(artworks)
        .map((id) => `${id}.png`)
        .sort(),
      'Runtime artwork must contain exactly the PNGs in the source manifest'
    )
    for (const file of files) {
      const bytes = fs.readFileSync(path.join(artworkDirectory, file))
      assert.equal(bytes[25], 2, `Artwork must be an opaque RGB PNG: ${file}`)
      assert.equal(
        createHash('sha256').update(bytes).digest('hex'),
        artworks[file.slice(0, -4)].runtimeSha256,
        `Runtime artwork differs from the opaque import: ${file}`
      )
    }
    const zombeasts = createZombeastDefinitions(CARD_CATALOG.all)
    const catalogMissing = [...CARD_CATALOG.all, ...zombeasts]
      .filter((card) => !resolver.hasCardArtwork(card.id))
      .map((card) => card.id)
    assert.deepEqual(catalogMissing, [], 'Every catalog card must resolve artwork')
    const missing = files.filter(
      (file) => !resolver.hasCardArtwork(file.replace(/\.(jpg|jpeg|png)$/i, ''))
    )
    assert.equal(
      missing.length,
      0,
      `Artwork does not resolve: ${missing.slice(0, 10).join(', ')}`
    )
    for (const [alias, original] of aliases) {
      const expected = resolver.getCardArtworkUrl(original)
      assert.ok(expected, `Alias source artwork missing: ${original}`)
      assert.equal(
        resolver.getCardArtworkUrl(alias),
        expected,
        `Artwork alias failed: ${alias}`
      )
    }
    const client = await vite.transformRequest(moduleUrl)
    for (const id of Object.keys(artworks))
      assert.ok(client?.code.includes(id + '.png'), `Client artwork map missing: ${id}`)
    assetServer = http.createServer(vite.middlewares)
    assetServer.listen(0, '127.0.0.1')
    await once(assetServer, 'listening')
    const origin = `http://127.0.0.1:${assetServer.address().port}`
    for (const id of servedCards) {
      const url = resolver.getCardArtworkUrl(id)
      assert.ok(url, `Artwork missing: ${id}`)
      const response = await fetch(origin + url)
      assert.equal(response.status, 200, `Artwork response failed: ${id}`)
      assert.match(response.headers.get('content-type') ?? '', /^image\//)
      const bytes = Buffer.from(await response.arrayBuffer())
      assert.ok(
        bytes.equals(fs.readFileSync(path.join(artworkDirectory, id + '.png'))),
        `Artwork bytes differ: ${id}`
      )
    }
    console.log(
      `Artwork check passed: ${files.length} opaque PNGs, ${CARD_CATALOG.size} cards, ${zombeasts.length} Zombeasts, ${aliases.length} aliases, ${servedCards.length} served images.`
    )
  } finally {
    if (assetServer?.listening) {
      assetServer.closeAllConnections()
      await new Promise((resolve, reject) =>
        assetServer.close((error) => (error ? reject(error) : resolve()))
      )
    }
    await vite.close()
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
