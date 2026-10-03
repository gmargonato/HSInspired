const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createServer } = require('vite')

const ROOT = path.resolve(__dirname, '..')
const ARTIFACTS = path.join(ROOT, 'Artifacts', 'card-testing')
const PROGRESS_PATH = path.join(ROOT, 'Artifacts', 'CARD_TESTING_PROGRESS.md')
const HARNESS_VERSION = '1.2.2'
const RULES_FINGERPRINT_VERSION = 'card-definition-sha256-v1'
const BASELINE_SEED = 0x5ca1ab1e
const PILOT_SEED = 0x71a10f00
const INTERACTION_SEED = 0x1e7ac710
const PILOT_CARD_IDS = [
  'basic_acidic_swamp_ooze',
  'basic_fireball',
  'basic_arcane_intellect',
  'basic_execute',
  'basic_houndmaster',
  'basic_shadow_word_death',
  'basic_polymorph',
  'basic_mind_control',
  'classic_big_game_hunter',
  'classic_hungry_crab',
  'classic_blade_flurry',
  'classic_molten_giant',
  'classic_knife_juggler',
  'goblins_vs_gnomes_blingtron_3000',
  'goblins_vs_gnomes_upgraded_repair_bot',
  'goblins_vs_gnomes_screwjank_clunker',
  'the_grand_tournament_demonfuse',
  'one_night_in_karazhan_arcane_giant',
  'whispers_of_the_old_gods_cthun',
  'journey_to_ungoro_sherazin_corpse_flower',
  'journey_to_ungoro_unite_the_murlocs',
  'knights_of_the_frozen_throne_play_dead',
  'mean_streets_of_gadgetzan_potion_of_madness',
  'naxxramas_haunted_creeper',
  'classic_dire_wolf_alpha',
  'classic_ragnaros_the_firelord',
  'classic_arathi_weaponsmith'
]

const PILOT_FOLLOWUPS = {
  classic_knife_juggler: [{ type: 'play-card', cardId: 'classic_wisp' }],
  journey_to_ungoro_unite_the_murlocs: [
    { type: 'play-card', cardId: 'basic_murloc_raider' }
  ],
  knights_of_the_frozen_throne_play_dead: [],
  mean_streets_of_gadgetzan_potion_of_madness: [{ type: 'end-turn' }],
  classic_ragnaros_the_firelord: [{ type: 'end-turn' }]
}

const PILOT_ORACLES = {
  basic_acidic_swamp_ooze: [
    {
      id: 'printed-minion-stats',
      type: 'minion-stats',
      expected: { attack: 3, health: 2 }
    }
  ],
  basic_fireball: [
    { id: 'printed-damage-amount', type: 'damage-amount', expected: { amount: 6 } },
    {
      id: 'single-target-bystanders-unchanged',
      type: 'bystanders-unchanged',
      expected: {}
    }
  ],
  basic_arcane_intellect: [
    { id: 'draw-two-cards', type: 'draw-count', expected: { count: 2 } }
  ],
  basic_execute: [
    { id: 'destroy-damaged-enemy', type: 'destroy-damaged-target', expected: {} }
  ],
  basic_houndmaster: [
    {
      id: 'beast-gains-two-and-taunt',
      type: 'beast-buff',
      expected: { attack: 2, health: 2, keyword: 'taunt' }
    }
  ],
  basic_shadow_word_death: [
    {
      id: 'destroy-five-attack-minion',
      type: 'destroy-threshold-target',
      expected: { attack: 5 }
    }
  ],
  basic_polymorph: [
    {
      id: 'transform-into-sheep',
      type: 'transform-sheep',
      expected: { cardId: 'basic_sheep', attack: 1, health: 1 }
    }
  ],
  basic_mind_control: [
    { id: 'take-control-and-preserve-owner', type: 'take-control', expected: {} }
  ],
  classic_big_game_hunter: [
    {
      id: 'destroy-seven-attack-minion',
      type: 'destroy-threshold-target',
      expected: { attack: 7 }
    }
  ],
  classic_hungry_crab: [
    {
      id: 'destroy-murloc-and-gain-stats',
      type: 'destroy-and-buff-source',
      expected: { attack: 2, health: 2 }
    }
  ],
  classic_molten_giant: [
    { id: 'health-discount-boundary', type: 'current-cost', expected: { cost: 0 } }
  ],
  classic_knife_juggler: [
    {
      id: 'summon-trigger-random-damage',
      type: 'followup-random-damage',
      expected: { amount: 1 }
    }
  ],
  goblins_vs_gnomes_blingtron_3000: [
    { id: 'weapon-for-each-player', type: 'weapon-each-player', expected: {} }
  ],
  goblins_vs_gnomes_upgraded_repair_bot: [
    { id: 'mech-gets-four-health', type: 'mech-health-buff', expected: { health: 4 } }
  ],
  goblins_vs_gnomes_screwjank_clunker: [
    {
      id: 'mech-gets-two-two',
      type: 'minion-target-buff',
      expected: { attack: 2, health: 2 }
    }
  ],
  the_grand_tournament_demonfuse: [
    {
      id: 'demon-gets-three-three',
      type: 'minion-target-buff',
      expected: { attack: 3, health: 3 }
    }
  ],
  one_night_in_karazhan_arcane_giant: [
    { id: 'twelve-spell-cost-boundary', type: 'current-cost', expected: { cost: 0 } },
    {
      id: 'printed-minion-stats',
      type: 'minion-stats',
      expected: { attack: 8, health: 8 }
    }
  ],
  whispers_of_the_old_gods_cthun: [
    {
      id: 'printed-minion-stats',
      type: 'minion-stats',
      expected: { attack: 6, health: 6 }
    },
    { id: 'random-split-damage-total', type: 'damage-total', expected: { amount: 6 } }
  ],
  journey_to_ungoro_sherazin_corpse_flower: [
    {
      id: 'printed-minion-stats',
      type: 'minion-stats',
      expected: { attack: 6, health: 3 }
    }
  ],
  journey_to_ungoro_unite_the_murlocs: [
    {
      id: 'murloc-summon-advances-quest',
      type: 'quest-progress',
      expected: { delta: 1 }
    }
  ],
  knights_of_the_frozen_throne_play_dead: [
    {
      id: 'trigger-deathrattle-summon-two-spiders',
      type: 'play-dead-spiders',
      expected: { cardId: 'naxxramas_spectral_spider', count: 2 }
    }
  ],
  mean_streets_of_gadgetzan_potion_of_madness: [
    { id: 'temporary-control-expires', type: 'temporary-control', expected: {} }
  ],
  naxxramas_haunted_creeper: [
    {
      id: 'printed-minion-stats',
      type: 'minion-stats',
      expected: { attack: 1, health: 2 }
    }
  ],
  classic_dire_wolf_alpha: [
    { id: 'adjacent-attack-aura', type: 'adjacent-aura', expected: { attack: 1 } }
  ],
  classic_ragnaros_the_firelord: [
    {
      id: 'end-of-turn-random-eight-damage',
      type: 'damage-total-followup',
      expected: { amount: 8 }
    }
  ],
  classic_arathi_weaponsmith: [
    {
      id: 'hero-and-power-identity-unchanged',
      type: 'hero-identity-unchanged',
      expected: { unchanged: true }
    }
  ]
}

const PILOT_EXTRA_SCENARIOS = [
  {
    caseId: 'fireball-required-target',
    cardId: 'basic_fireball',
    inputSelection: 'omit-required-targets',
    expectedCommandOutcome: 'rejected-no-state-change',
    oracle: [
      {
        id: 'required-target-rejected-without-mutation',
        type: 'rejected-no-mutation',
        expected: {}
      }
    ]
  }
]

const SCENARIO_ASSERTIONS = new Set([
  'gameplay-command-accepted',
  'gameplay-command-rejected-without-state-change',
  'opening-quest-registered',
  'provisional-card-behavior',
  'match-invariants-valid',
  'same-seed-replay-consistent'
])
const ACTION_TYPES = new Set([
  'play-focal-card',
  'observe-opening-quest',
  'play-companion-card',
  'use-hero-power',
  'attack-hero',
  'end-turn'
])

function fail(message) {
  throw new Error(message)
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  const result = {}
  for (const key of Object.keys(value).sort()) result[key] = stableValue(value[key])
  return result
}

function stableJson(value) {
  return JSON.stringify(stableValue(value))
}

function renameWithRetry(sourcePath, targetPath) {
  const retryableWindowsErrors = new Set(['EPERM', 'EACCES', 'EBUSY'])
  const waitCell = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
  const retryLimit = process.platform === 'win32' ? 40 : 0
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(sourcePath, targetPath)
      return
    } catch (error) {
      const retryable =
        process.platform === 'win32' &&
        retryableWindowsErrors.has(error.code) &&
        attempt < retryLimit
      if (!retryable) {
        fs.rmSync(sourcePath, { force: true })
        throw error
      }
      Atomics.wait(waitCell, 0, 0, 50)
    }
  }
}

function safeWriteJson(filePath, value) {
  const parent = path.dirname(filePath)
  fs.mkdirSync(parent, { recursive: true })
  const tempPath = filePath + '.' + process.pid + '.tmp'
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameWithRetry(tempPath, filePath)
}

function safeWriteText(filePath, value) {
  const parent = path.dirname(filePath)
  fs.mkdirSync(parent, { recursive: true })
  const tempPath = filePath + '.' + process.pid + '.tmp'
  fs.writeFileSync(tempPath, value, 'utf8')
  renameWithRetry(tempPath, filePath)
}

function appendJsonl(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.appendFileSync(filePath, JSON.stringify(value) + '\n', 'utf8')
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return []
  const text = fs.readFileSync(filePath, 'utf8')
  const lines = text.split(/\r?\n/u)
  const records = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line) continue
    try {
      records.push(JSON.parse(line))
    } catch (error) {
      const isTrailingPartial = index === lines.length - 1 && !text.endsWith('\n')
      if (!isTrailingPartial)
        fail(
          'Invalid JSONL record in ' +
            filePath +
            ' at line ' +
            (index + 1) +
            ': ' +
            error.message
        )
    }
  }
  return records
}

function safeCampaignPath(id) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(id) || id === '.' || id === '..')
    fail(
      'Campaign id must contain only letters, numbers, dots, underscores, or hyphens.'
    )
  const result = path.resolve(ARTIFACTS, id)
  if (!result.startsWith(ARTIFACTS + path.sep))
    fail('Campaign path escaped the artifact directory.')
  return result
}

function gitRead(args, fallback) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch {
    return fallback
  }
}

function listFiles(directory) {
  if (!fs.existsSync(directory)) return []
  const result = []
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, item.name)
    if (item.isDirectory()) result.push(...listFiles(filePath))
    else if (item.isFile()) result.push(filePath)
  }
  return result
}

function inputFilePaths() {
  const files = [
    ...listFiles(path.join(ROOT, 'src')),
    ...listFiles(path.join(ROOT, 'config')),
    path.join(ROOT, 'package.json'),
    path.join(ROOT, 'package-lock.json'),
    path.join(ROOT, 'scripts', 'card-testing.cjs')
  ]
  return [...new Set(files)].filter(fs.existsSync).sort()
}

function fingerprintInputs() {
  const files = inputFilePaths()
  const entries = files.map((filePath) => {
    const content = fs.readFileSync(filePath)
    const stat = fs.statSync(filePath)
    return {
      path: path.relative(ROOT, filePath).replace(/\\/gu, '/'),
      sha256: sha256(content),
      size: stat.size,
      mtimeMs: stat.mtimeMs
    }
  })
  const dependencyLock = path.join(ROOT, 'package-lock.json')
  return {
    fingerprint: sha256(
      stableJson(entries.map(({ path: name, sha256: hash }) => [name, hash]))
    ),
    files: entries,
    lockSha256: fs.existsSync(dependencyLock)
      ? sha256(fs.readFileSync(dependencyLock))
      : null
  }
}

function assertFrozenInputs(manifest, includeContentHash) {
  const current = fingerprintInputs()
  const expected = manifest.inputFingerprint
  if (includeContentHash) {
    if (current.fingerprint !== expected.fingerprint)
      fail(
        'Frozen source inputs changed. Start a linked campaign with --parent ' +
          manifest.campaignId +
          '.'
      )
    return
  }
  const expectedStats = new Map(expected.files.map((file) => [file.path, file]))
  if (expectedStats.size !== current.files.length)
    fail('Frozen source file inventory changed during the campaign.')
  for (const file of current.files) {
    const prior = expectedStats.get(file.path)
    if (!prior || prior.size !== file.size || prior.mtimeMs !== file.mtimeMs)
      fail('Frozen source input changed during the campaign: ' + file.path)
  }
}

async function loadEngine() {
  const server = await createServer({
    root: ROOT,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error'
  })
  try {
    const [cards, expansions, generated, zombeasts, scenarios] = await Promise.all([
      server.ssrLoadModule('/src/game-rules/content/cards/card-catalog.ts'),
      server.ssrLoadModule('/src/game-rules/content/expansions/expansion-catalog.ts'),
      server.ssrLoadModule(
        '/src/game-rules/content/cards/generated-card-definitions.ts'
      ),
      server.ssrLoadModule('/src/game-rules/content/cards/zombeast.ts'),
      server.ssrLoadModule('/src/game-rules/match/testing/card-testing-scenario.ts')
    ])
    const generatedIds = new Set(
      generated.GENERATED_CARD_DEFINITIONS.map((card) => String(card.id))
    )
    const entries = [
      ...cards.CARD_CATALOG.all.map((card) => ({
        card,
        sourceKind: generatedIds.has(String(card.id)) ? 'generated-token' : 'authored'
      })),
      ...zombeasts.createZombeastDefinitions(cards.CARD_CATALOG.all).map((card) => ({
        card,
        sourceKind: 'dynamic-zombeast'
      }))
    ]
    const expansionOrder = new Map(
      expansions.EXPANSION_DEFINITIONS.map((expansion, index) => [
        String(expansion.id),
        index
      ])
    )
    entries.sort((left, right) => {
      const expansionDifference =
        (expansionOrder.get(String(left.card.expansionId)) ?? Number.MAX_SAFE_INTEGER) -
        (expansionOrder.get(String(right.card.expansionId)) ?? Number.MAX_SAFE_INTEGER)
      return (
        expansionDifference || String(left.card.id).localeCompare(String(right.card.id))
      )
    })
    const seen = new Set()
    for (const entry of entries) {
      const id = String(entry.card.id)
      if (seen.has(id)) fail('Duplicate campaign inventory card id: ' + id)
      seen.add(id)
    }
    const cardById = new Map(
      entries.map((entry) => [String(entry.card.id), entry.card])
    )
    return {
      server,
      CARD_CATALOG: cards.CARD_CATALOG,
      EXPANSION_DEFINITIONS: expansions.EXPANSION_DEFINITIONS,
      runCatalogCardScenario: scenarios.runCatalogCardScenario,
      entries,
      cardById
    }
  } catch (error) {
    await server.close()
    throw error
  }
}

function cardDefinitionFingerprint(card) {
  return sha256(
    stableJson({
      id: card.id,
      expansionId: card.expansionId,
      name: card.name,
      type: card.type,
      cost: card.cost,
      attack: card.attack,
      health: card.health,
      durability: card.durability,
      armor: card.armor,
      replacementHeroId: card.replacementHeroId,
      rulesText: card.rulesText,
      keywords: card.keywords,
      effects: card.effects,
      playCondition: card.playCondition,
      quest: card.quest
    })
  )
}

function collectActions(value, parentKey, result) {
  if (Array.isArray(value)) {
    for (const item of value) collectActions(item, parentKey, result)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'action' && typeof nested === 'string') result.add('action:' + nested)
    if (key === 'trigger' && typeof nested === 'string') result.add('trigger:' + nested)
    collectActions(nested, key, result)
  }
}

function collectEffectClauses(effects) {
  if (!Array.isArray(effects)) return []
  const clauses = []
  const triggerIndexes = new Map()
  const nestedActionKeys = new Set(['actions', 'then', 'else', 'steps', 'branches'])
  for (const [effectIndex, effect] of effects.entries()) {
    const trigger = typeof effect?.trigger === 'string' ? effect.trigger : 'unknown'
    const triggerIndex = triggerIndexes.get(trigger) ?? 0
    triggerIndexes.set(trigger, triggerIndex + 1)
    if (!Array.isArray(effect?.actions)) continue
    for (const [actionIndex, action] of effect.actions.entries()) {
      const visit = (value, metadataPath) => {
        if (Array.isArray(value)) {
          value.forEach((item, index) => visit(item, metadataPath + '.' + index))
          return
        }
        if (!value || typeof value !== 'object') return
        if (typeof value.action === 'string')
          clauses.push({
            id:
              'effect-' +
              effectIndex +
              '-' +
              metadataPath.replace(/[^a-zA-Z0-9]+/gu, '-'),
            trigger,
            triggerIndex,
            rootActionIndex: actionIndex,
            action: value.action,
            metadataPath
          })
        for (const [key, nested] of Object.entries(value))
          if (nestedActionKeys.has(key)) visit(nested, metadataPath + '.' + key)
      }
      visit(action, 'effects[' + effectIndex + '].actions[' + actionIndex + ']')
    }
  }
  return clauses
}

function cardSourceLabel(entry) {
  if (entry.sourceKind === 'dynamic-zombeast') return 'dynamic:zombeast-combinations'
  if (entry.sourceKind === 'generated-token')
    return 'src/game-rules/content/cards/generated-card-definitions.ts'
  return 'src/game-rules/content/cards/sets/' + String(entry.card.expansionId) + '.json'
}

function specificationFor(entry) {
  const card = entry.card
  const behavior = new Set()
  collectActions(card.effects, '', behavior)
  for (const keyword of card.keywords) behavior.add('keyword:' + keyword)
  behavior.add('type:' + card.type.toLowerCase())
  const fingerprint = cardDefinitionFingerprint(card)
  const openingQuest = card.type === 'Spell' && Boolean(card.quest)
  const expectations = [
    {
      id: openingQuest ? 'opening-quest-registered' : 'gameplay-command-accepted',
      status: 'established',
      expected: openingQuest
        ? 'The focal opening objective is installed for its owner.'
        : 'A card exposed as legal by the gameplay input interface is accepted when submitted with the selected legal inputs.',
      authority: 'Public match command and opening objective lifecycle contract.'
    },
    {
      id: 'match-invariants-valid',
      status: 'established',
      expected:
        'The authoritative match state satisfies the structural match invariants after the tested boundary.',
      authority: 'Game-rules match invariant contract.'
    },
    {
      id: 'same-seed-replay-consistent',
      status: 'established',
      expected:
        'The same setup, seed, actor, and selected inputs produce the same captured result.',
      authority: 'Seeded deterministic match contract.'
    },
    {
      id: 'card-text-semantics',
      status: 'needs-human-review',
      expected:
        'The exact state changes, event counts, lifecycle, targeting, and bystander effects implied by the card text and intended rules.',
      authority:
        'Card text plus intended rules; no independent reviewed oracle is available in this baseline campaign.'
    }
  ]
  for (const oracle of PILOT_ORACLES[String(card.id)] ?? []) {
    expectations.push({
      id: 'pilot-' + oracle.id,
      status: 'provisional-unreviewed',
      expected: oracle.expected,
      authority: 'Text-derived pilot assertion frozen before execution.',
      confidence: 'provisional'
    })
  }
  return {
    cardId: String(card.id),
    version: 1,
    fingerprint,
    rulesText: card.rulesText,
    mechanicTags: [...behavior].sort(),
    effectClauses: collectEffectClauses(card.effects),
    specificationStatus: 'provisional-unreviewed',
    provenance: {
      rulesText: 'Live catalog definition captured before scenario outcomes.',
      implementationUse:
        'Effect metadata is used to inventory tags and construct a legal entry path; it is not treated as a complete behavioral oracle.'
    },
    expectations
  }
}

function scenarioFor(entry, campaignId, phase, index, actor, caseOptions = {}) {
  const card = entry.card
  const quest = card.type === 'Spell' && Boolean(card.quest)
  const caseId = caseOptions.caseId ?? 'baseline'
  const inputSelection = caseOptions.inputSelection ?? 'first-legal'
  const followups = caseOptions.followups ?? []
  const oracle = caseOptions.oracle ?? []
  const expectedCommandOutcome = caseOptions.expectedCommandOutcome ?? 'accepted'
  const followupPolicy = caseOptions.followupPolicy ?? 'must-accept'
  const fixtureProfile =
    caseOptions.fixtureProfile ??
    (phase === 'interaction'
      ? 'mixed-board-interaction-v2'
      : quest
        ? 'opening-quest'
        : 'catalog-smoke-v1')
  const idSeed = sha256(
    phase + ':' + String(card.id) + ':' + actor + ':' + caseId
  ).slice(0, 16)
  const seed =
    phase === 'baseline'
      ? (BASELINE_SEED + index) >>> 0
      : phase === 'interaction'
        ? (INTERACTION_SEED + index) >>> 0
        : (PILOT_SEED + index) >>> 0
  const scenario = {
    schemaVersion: 1,
    scenarioId: phase + '-' + idSeed,
    campaignId,
    phase,
    caseId,
    focalCardId: String(card.id),
    specificationVersion: 1,
    definitionFingerprint: cardDefinitionFingerprint(card),
    seed,
    actor,
    setup: {
      recipe: 'isolated-real-catalog-match',
      fixtureProfile,
      sourceKind: entry.sourceKind,
      note: 'Development commands establish declared prerequisites; the focal card is exercised through the public gameplay boundary.'
    },
    inputSelection,
    expectedCommandOutcome,
    followupPolicy,
    choiceResolutionPolicy: 'first-legal',
    oracle,
    followups,
    actions: [
      quest
        ? { type: 'observe-opening-quest', cardId: String(card.id) }
        : { type: 'play-focal-card', inputSelection },
      ...followups.map((followup) =>
        followup.type === 'play-card'
          ? { type: 'play-companion-card', cardId: followup.cardId }
          : followup.type === 'use-hero-power'
            ? { type: 'use-hero-power' }
            : followup.type === 'attack-hero'
              ? { type: 'attack-hero' }
              : { type: 'end-turn' }
      )
    ],
    assertions: [
      quest
        ? 'opening-quest-registered'
        : expectedCommandOutcome === 'rejected-no-state-change'
          ? 'gameplay-command-rejected-without-state-change'
          : 'gameplay-command-accepted',
      ...(oracle.length > 0 ? ['provisional-card-behavior'] : []),
      'match-invariants-valid',
      'same-seed-replay-consistent'
    ],
    limits: {
      maxTurns: fixtureProfile === 'mixed-board-interaction-v2' ? 6 : 4,
      maxActions: 40,
      timeoutMs: 120000
    },
    status: 'planned'
  }
  validateScenario(scenario)
  return scenario
}

function validateScenario(scenario) {
  if (scenario.schemaVersion !== 1) fail('Unsupported scenario schema version.')
  if (!/^(baseline|interaction|pilot)-[a-f0-9]{16}$/u.test(scenario.scenarioId))
    fail('Invalid scenario id.')
  if (
    !Number.isInteger(scenario.seed) ||
    scenario.seed < 0 ||
    scenario.seed > 0xffffffff
  )
    fail('Scenario seed must be an unsigned 32-bit integer.')
  if (!['first', 'second'].includes(scenario.actor))
    fail('Scenario actor must be first or second.')
  if (
    !['opening-quest', 'catalog-smoke-v1', 'mixed-board-interaction-v2'].includes(
      scenario.setup.fixtureProfile
    )
  )
    fail('Unsupported scenario fixture profile.')
  if (!Array.isArray(scenario.actions) || scenario.actions.length > 8)
    fail('Scenario action list exceeds the schema limit.')
  for (const action of scenario.actions) {
    if (!action || !ACTION_TYPES.has(action.type))
      fail('Unsupported scenario action type.')
    if (
      action.type === 'play-focal-card' &&
      !['first-legal', 'omit-required-targets'].includes(action.inputSelection)
    )
      fail('Focal card input selection is outside the approved schema.')
    if (
      action.type === 'play-companion-card' &&
      (typeof action.cardId !== 'string' || !action.cardId)
    )
      fail('Companion play requires a catalog card id.')
  }
  if (
    !['accepted', 'rejected-no-state-change'].includes(scenario.expectedCommandOutcome)
  )
    fail('Unsupported expected command outcome.')
  if (!['must-accept', 'observe-only'].includes(scenario.followupPolicy))
    fail('Unsupported follow-up policy.')
  if (scenario.choiceResolutionPolicy !== 'first-legal')
    fail('Unsupported pending-choice resolution policy.')
  if (!Array.isArray(scenario.followups) || scenario.followups.length > 7)
    fail('Scenario follow-ups exceed the schema limit.')
  for (const followup of scenario.followups) {
    if (followup.type === 'play-card' && typeof followup.cardId !== 'string')
      fail('Companion action has no card id.')
    if (
      !['play-card', 'use-hero-power', 'attack-hero', 'end-turn'].includes(
        followup.type
      )
    )
      fail('Unsupported follow-up action.')
  }
  for (const assertion of scenario.assertions)
    if (!SCENARIO_ASSERTIONS.has(assertion))
      fail('Unsupported scenario assertion: ' + assertion)
  if (
    scenario.limits.maxTurns > 6 ||
    scenario.limits.maxActions > 64 ||
    scenario.limits.timeoutMs > 120000
  )
    fail('Scenario resource limits exceed the approved bounds.')
}

function makeInventory(engine) {
  const expansionOrder = new Map(
    engine.EXPANSION_DEFINITIONS.map((expansion) => [
      String(expansion.id),
      expansion.releaseOrder
    ])
  )
  return engine.entries.map((entry, index) => ({
    cardId: String(entry.card.id),
    expansionId: String(entry.card.expansionId),
    catalogOrder: index,
    expansionOrder: expansionOrder.get(String(entry.card.expansionId)) ?? null,
    source: cardSourceLabel(entry),
    sourceKind: entry.sourceKind,
    type: entry.card.type,
    collectible: Boolean(entry.card.collectible),
    deckLegal: Boolean(entry.card.deckLegal),
    fingerprint: cardDefinitionFingerprint(entry.card)
  }))
}

function createQueue(engine, campaignId) {
  const baseline = engine.entries.map((entry, index) =>
    scenarioFor(
      entry,
      campaignId,
      'baseline',
      index,
      index % 2 === 0 ? 'first' : 'second'
    )
  )
  const interaction = engine.entries.map((entry, index) => {
    const baselineScenario = baseline[index]
    return scenarioFor(
      entry,
      campaignId,
      'interaction',
      index,
      baselineScenario.actor === 'first' ? 'second' : 'first',
      {
        caseId: 'mixed-board-tribe-weapon-heal-hero-turns',
        fixtureProfile: 'mixed-board-interaction-v2',
        inputSelection: 'first-legal',
        expectedCommandOutcome: 'accepted',
        followupPolicy: 'observe-only',
        followups: [
          { type: 'play-card', cardId: 'classic_wisp' },
          { type: 'play-card', cardId: 'basic_the_coin' },
          { type: 'play-card', cardId: 'basic_guardian_of_kings' },
          { type: 'use-hero-power' },
          { type: 'attack-hero' },
          { type: 'end-turn' },
          { type: 'end-turn' }
        ]
      }
    )
  })
  const pilot = []
  for (const cardId of PILOT_CARD_IDS) {
    const entry = engine.entries.find(
      (candidate) => String(candidate.card.id) === cardId
    )
    if (!entry) fail('Pilot card is missing from the live inventory: ' + cardId)
    const index = pilot.length
    const baselineScenario = baseline.find(
      (scenario) => scenario.focalCardId === cardId
    )
    const actor = baselineScenario.actor === 'first' ? 'second' : 'first'
    pilot.push(
      scenarioFor(entry, campaignId, 'pilot', index, actor, {
        caseId: 'cross-player',
        inputSelection: 'first-legal',
        expectedCommandOutcome: 'accepted',
        followups: PILOT_FOLLOWUPS[cardId] ?? [],
        oracle: PILOT_ORACLES[cardId] ?? []
      })
    )
  }
  for (const extra of PILOT_EXTRA_SCENARIOS) {
    const entry = engine.entries.find(
      (candidate) => String(candidate.card.id) === extra.cardId
    )
    if (!entry)
      fail('Extra pilot card is missing from the live inventory: ' + extra.cardId)
    const baselineScenario = baseline.find(
      (scenario) => scenario.focalCardId === extra.cardId
    )
    pilot.push(
      scenarioFor(entry, campaignId, 'pilot', pilot.length, baselineScenario.actor, {
        caseId: extra.caseId,
        inputSelection: extra.inputSelection,
        expectedCommandOutcome: extra.expectedCommandOutcome,
        followups: [],
        oracle: extra.oracle
      })
    )
  }
  return [...baseline, ...interaction, ...pilot]
}

function validateCatalogReferences(engine, scenarios) {
  for (const scenario of scenarios) {
    if (!engine.cardById.has(scenario.focalCardId))
      fail('Scenario references unknown card ' + scenario.focalCardId)
    for (const followup of scenario.followups) {
      if (followup.type === 'play-card' && !engine.cardById.has(followup.cardId))
        fail('Scenario follow-up references unknown card ' + followup.cardId)
    }
    validateScenario(scenario)
  }
}

function buildManifest(campaignId, engine, scenarios, options) {
  const inputFingerprint = fingerprintInputs()
  const gitStatus = gitRead(
    ['status', '--porcelain=v1', '--untracked-files=all'],
    'unavailable'
  )
  const cardDefinitions = engine.entries.map((entry) => [
    String(entry.card.id),
    cardDefinitionFingerprint(entry.card)
  ])
  return {
    schemaVersion: 1,
    campaignId,
    parentCampaignId: options.parent ?? null,
    createdAt: new Date().toISOString(),
    status: 'planned',
    harnessVersion: HARNESS_VERSION,
    rulesFingerprintVersion: RULES_FINGERPRINT_VERSION,
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    git: {
      commit: gitRead(['rev-parse', 'HEAD'], 'unavailable'),
      workingTreeChanges: gitStatus ? gitStatus.split(/\r?\n/u).filter(Boolean) : []
    },
    inputFingerprint,
    catalog: {
      cardCount: engine.entries.length,
      staticCardCount: engine.entries.filter(
        (entry) => entry.sourceKind !== 'dynamic-zombeast'
      ).length,
      dynamicZombeastCount: engine.entries.filter(
        (entry) => entry.sourceKind === 'dynamic-zombeast'
      ).length,
      sha256: sha256(stableJson(cardDefinitions)),
      order: 'expansion release order, then card id'
    },
    phases: {
      baselineScenarioCount: scenarios.filter((scenario) => scenario.phase === 'baseline')
        .length,
      interactionScenarioCount: scenarios.filter(
        (scenario) => scenario.phase === 'interaction'
      ).length,
      pilotScenarioCount: scenarios.filter((scenario) => scenario.phase === 'pilot')
        .length,
      scenarios: scenarios.length
    },
    budgets: {
      maxScenarios: options.maxScenarios,
      maxRuntimeMs: options.maxRuntimeMs,
      perScenarioActions: 40,
      perScenarioTurns: 4,
      aiProvider: null,
      aiModel: null,
      aiBudget: null
    },
    specificationPolicy:
      'Expectations are frozen before outcomes. Semantic specifications remain provisional until reviewed.'
  }
}

function latestOutcomeMap(records) {
  const map = new Map()
  for (const record of records) {
    if (record.recordType === 'scenario-outcome') map.set(record.scenarioId, record)
  }
  return map
}

function isTerminalOutcome(record) {
  return record && record.status !== 'Interrupted'
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function compareRun(first, replay) {
  return stableJson(first) === stableJson(replay)
}

function assertion(
  id,
  passed,
  expected,
  actual,
  details,
  expectationStatus = 'established'
) {
  return {
    id,
    status: passed ? 'passed' : 'failed',
    expectationStatus,
    expected,
    actual,
    ...(details ? { details } : {})
  }
}

function outcomeStatus(assertions, setupBlocked) {
  if (setupBlocked) return 'Blocked/unsupported'
  if (
    assertions.some(
      (item) => item.id === 'same-seed-replay-consistent' && item.status === 'failed'
    )
  )
    return 'Suspected issue'
  if (
    assertions.some(
      (item) => item.status === 'failed' && item.expectationStatus === 'provisional'
    )
  )
    return 'Suspected issue'
  if (assertions.some((item) => item.status === 'failed'))
    return 'Failed established expectation'
  return 'Observed, unverified'
}

function statePlayer(state, participantId) {
  return state.players.find((player) => player.participantId === participantId)
}

function stateActor(state, outcome) {
  const player = statePlayer(state, outcome.actorParticipantId)
  if (!player) fail('Outcome actor is absent from the captured match state.')
  return player
}

function stateOpponent(state, outcome) {
  const player = statePlayer(state, outcome.opponentParticipantId)
  if (!player) fail('Outcome opponent is absent from the captured match state.')
  return player
}

function minionById(state, instanceId) {
  for (const player of state.players) {
    const minion = player.board.find((candidate) => candidate.instanceId === instanceId)
    if (minion) return { player, minion }
  }
  return null
}

function targetFor(outcome) {
  return outcome.command?.targets?.[0] ?? null
}

function minionTarget(state, target) {
  if (!target || target.kind !== 'minion' || !target.instanceId) return null
  return minionById(state, target.instanceId)
}

function focalMinion(state, outcome) {
  if (outcome.focalInstanceId) return minionById(state, outcome.focalInstanceId)
  return null
}

function eventRows(outcome, includeFollowups = false) {
  const rows = [...(outcome.result?.events ?? [])]
  if (includeFollowups) {
    for (const result of outcome.followupResults ?? [])
      rows.push(...(result.events ?? []))
  }
  return rows
}

function checkPilotOracle(scenario, outcome, oracle) {
  const expected = oracle.expected
  const actorBefore = stateActor(outcome.preActionState, outcome)
  const actorAfter = stateActor(outcome.postFocalState ?? outcome.state, outcome)
  const opponentBefore = stateOpponent(outcome.preActionState, outcome)
  const opponentAfter = stateOpponent(outcome.postFocalState ?? outcome.state, outcome)
  const target = targetFor(outcome)
  const beforeTarget = minionTarget(outcome.preActionState, target)
  const afterTarget = minionTarget(outcome.postFocalState ?? outcome.state, target)
  const focal = focalMinion(outcome.postFocalState ?? outcome.state, outcome)
  const events = eventRows(outcome)
  const cardEvents = events.filter(
    (event) => event.sourceCardId === scenario.focalCardId
  )
  let passed = false
  let actual = null
  let expectedDescription = expected
  let expectationStatus = 'provisional'

  switch (oracle.type) {
    case 'minion-stats': {
      actual = focal
        ? {
            attack: focal.minion.attack,
            health: focal.minion.health,
            cardId: focal.minion.cardId
          }
        : null
      passed = Boolean(
        focal &&
        focal.minion.attack === expected.attack &&
        focal.minion.health === expected.health &&
        String(focal.minion.cardId) === scenario.focalCardId
      )
      break
    }
    case 'damage-amount': {
      const damage = cardEvents.filter((event) => event.action === 'damage')
      actual = damage.map((event) => event.data?.amount ?? null)
      passed = damage.length === 1 && damage[0].data?.amount === expected.amount
      break
    }
    case 'bystanders-unchanged': {
      const targetKey = target
        ? target.kind === 'hero'
          ? target.participantId + ':hero'
          : target.instanceId
        : null
      const changed = []
      for (const beforePlayer of outcome.preActionState.players) {
        const afterPlayer = statePlayer(
          outcome.postFocalState,
          beforePlayer.participantId
        )
        if (beforePlayer.participantId + ':hero' !== targetKey) {
          if (
            beforePlayer.hero.health !== afterPlayer.hero.health ||
            beforePlayer.hero.armor !== afterPlayer.hero.armor
          )
            changed.push(beforePlayer.participantId + ':hero')
        }
        for (const beforeMinion of beforePlayer.board) {
          if (beforeMinion.instanceId === targetKey) continue
          const after = minionById(
            outcome.postFocalState,
            beforeMinion.instanceId
          )?.minion
          if (
            !after ||
            after.attack !== beforeMinion.attack ||
            after.health !== beforeMinion.health ||
            after.maxHealth !== beforeMinion.maxHealth
          )
            changed.push(beforeMinion.instanceId)
        }
      }
      actual = changed
      passed = changed.length === 0
      break
    }
    case 'draw-count': {
      const draws = cardEvents.filter((event) => event.action === 'draw')
      actual = { count: draws.length, cards: draws.map((event) => event.data?.cardId) }
      passed = draws.length === expected.count
      break
    }
    case 'destroy-damaged-target': {
      const damageBefore = beforeTarget?.minion.health < beforeTarget?.minion.maxHealth
      const destroyedEvent = cardEvents.some(
        (event) =>
          event.action === 'destroy' && event.data?.target === target?.instanceId
      )
      actual = {
        targetCardId: beforeTarget?.minion.cardId ?? null,
        health: beforeTarget?.minion.health ?? null,
        maxHealth: beforeTarget?.minion.maxHealth ?? null,
        destroyed: !afterTarget,
        destroyEvent: destroyedEvent
      }
      passed = Boolean(damageBefore && !afterTarget && destroyedEvent)
      break
    }
    case 'beast-buff': {
      const before = beforeTarget?.minion
      const after = afterTarget?.minion
      actual =
        before && after
          ? {
              cardId: before.cardId,
              attackDelta: after.attack - before.attack,
              healthDelta: after.maxHealth - before.maxHealth,
              keywords: [
                ...(after.keywords ?? []),
                ...(after.enchantments ?? []).flatMap((enchantment) =>
                  (enchantment.keywords ?? []).filter(
                    (keyword) => !(after.keywords ?? []).includes(keyword)
                  )
                )
              ]
            }
          : null
      passed = Boolean(
        before &&
        after &&
        before.cardId === 'basic_bloodfen_raptor' &&
        after.attack - before.attack === expected.attack &&
        after.maxHealth - before.maxHealth === expected.health &&
        ((after.keywords ?? []).includes(expected.keyword) ||
          (after.enchantments ?? []).some((enchantment) =>
            (enchantment.keywords ?? []).includes(expected.keyword)
          ))
      )
      break
    }
    case 'destroy-threshold-target': {
      const before = beforeTarget?.minion
      const destroyEvent = cardEvents.some(
        (event) =>
          event.action === 'destroy' && event.data?.target === target?.instanceId
      )
      actual = {
        targetAttack: before?.attack ?? null,
        destroyed: !afterTarget,
        destroyEvent
      }
      passed = Boolean(
        before && before.attack >= expected.attack && !afterTarget && destroyEvent
      )
      break
    }
    case 'transform-sheep': {
      const after = afterTarget?.minion
      const transformEvent = cardEvents.find(
        (event) =>
          event.action === 'transform' && event.data?.target === target?.instanceId
      )
      actual = after
        ? { cardId: after.cardId, attack: after.attack, health: after.health }
        : (transformEvent?.data ?? null)
      passed = Boolean(
        after &&
        String(after.cardId) === expected.cardId &&
        after.attack === expected.attack &&
        after.health === expected.health
      )
      break
    }
    case 'take-control': {
      const before = beforeTarget
      const after = afterTarget
      actual =
        before && after
          ? {
              originalController: before.player.participantId,
              currentController: after.minion.controllerId,
              ownerId: after.minion.ownerId,
              isOnActorBoard: actorAfter.board.some(
                (minion) => minion.instanceId === target.instanceId
              )
            }
          : null
      passed = Boolean(
        before &&
        after &&
        before.player.participantId === opponentBefore.participantId &&
        after.minion.controllerId === actorBefore.participantId &&
        after.minion.ownerId === before.minion.ownerId &&
        actorAfter.board.some((minion) => minion.instanceId === target.instanceId) &&
        !opponentAfter.board.some((minion) => minion.instanceId === target.instanceId)
      )
      break
    }
    case 'destroy-and-buff-source': {
      const targetDestroyed = Boolean(beforeTarget && !afterTarget)
      const source = focalMinion(outcome.postFocalState, outcome)?.minion
      actual = source
        ? {
            targetDestroyed,
            attack: source.attack,
            health: source.health,
            baseAttack: source.baseAttack,
            baseHealth: source.baseHealth
          }
        : { targetDestroyed, source: null }
      passed = Boolean(
        targetDestroyed &&
        beforeTarget?.minion.cardId === 'basic_murloc_raider' &&
        source &&
        source.attack - (source.baseAttack ?? 0) === expected.attack &&
        source.maxHealth - (source.baseHealth ?? 0) === expected.health
      )
      break
    }
    case 'current-cost': {
      const card = actorBefore.hand.find(
        (candidate) => candidate.instanceId === outcome.focalInstanceId
      )
      actual = card ? { currentCost: card.currentCost, baseCost: card.baseCost } : null
      passed = Boolean(card && card.currentCost === expected.cost)
      break
    }
    case 'followup-random-damage': {
      const followupEvents = eventRows(outcome, true)
      const matching = followupEvents.filter(
        (event) =>
          event.sourceCardId === scenario.focalCardId && event.action === 'damage'
      )
      const triggers = followupEvents.filter(
        (event) =>
          event.type === 'trigger-activated' &&
          event.source?.cardId === scenario.focalCardId &&
          event.trigger === 'on-summon'
      )
      actual = {
        triggerCount: triggers.length,
        damageAmounts: matching.map((event) => event.data?.amount ?? null)
      }
      passed =
        triggers.length > 0 &&
        matching.length === 1 &&
        matching[0].data?.amount === expected.amount
      break
    }
    case 'weapon-each-player': {
      actual = outcome.postFocalState.players.map((player) => ({
        participantId: player.participantId,
        weaponCardId: player.weapon?.cardId ?? null
      }))
      passed = outcome.postFocalState.players.every((player) => player.weapon !== null)
      break
    }
    case 'mech-health-buff':
    case 'minion-target-buff': {
      const before = beforeTarget?.minion
      const after = afterTarget?.minion
      actual =
        before && after
          ? {
              cardId: before.cardId,
              attackDelta: after.attack - before.attack,
              maxHealthDelta: after.maxHealth - before.maxHealth
            }
          : null
      passed = Boolean(
        before &&
        after &&
        (oracle.type !== 'mech-health-buff' ||
          before.cardId === 'goblins_vs_gnomes_snowchugger') &&
        after.attack - before.attack === (expected.attack ?? 0) &&
        after.maxHealth - before.maxHealth === expected.health
      )
      break
    }
    case 'hero-identity-unchanged': {
      const before = {
        heroId: String(actorBefore.heroId),
        heroPowerId: String(actorBefore.heroPower.id)
      }
      const after = {
        heroId: String(actorAfter.heroId),
        heroPowerId: String(actorAfter.heroPower.id)
      }
      actual = { before, after }
      passed = stableJson(before) === stableJson(after)
      expectedDescription =
        'The focal card does not change the actor hero or hero power identity.'
      break
    }
    case 'quest-progress': {
      const questBefore = actorBefore.quest
      const questAfter = actorAfter.quest
      actual =
        questBefore && questAfter
          ? {
              before: questBefore.progress,
              after: questAfter.progress,
              target: questAfter.target
            }
          : null
      passed = Boolean(
        questBefore &&
        questAfter &&
        questAfter.progress - questBefore.progress === expected.delta
      )
      break
    }
    case 'play-dead-spiders': {
      const count = (state) =>
        stateActor(state, outcome).board.filter(
          (minion) => minion.cardId === expected.cardId
        ).length
      const beforeCount = count(outcome.preActionState)
      const afterCount = count(outcome.postFocalState ?? outcome.state)
      actual = { beforeCount, afterCount, increase: afterCount - beforeCount }
      passed = afterCount - beforeCount === expected.count
      break
    }
    case 'temporary-control': {
      const afterFocal = minionTarget(outcome.postFocalState, target)
      const afterDuration = minionTarget(outcome.state, target)
      actual =
        afterFocal && afterDuration
          ? {
              temporaryController: afterFocal.minion.controllerId,
              returnedController: afterDuration.minion.controllerId,
              originalOwner: beforeTarget?.minion.ownerId
            }
          : null
      passed = Boolean(
        beforeTarget &&
        afterFocal &&
        afterDuration &&
        afterFocal.minion.controllerId === actorBefore.participantId &&
        afterDuration.minion.controllerId === beforeTarget.minion.ownerId
      )
      break
    }
    case 'damage-total-followup': {
      const followupEvents = eventRows(outcome, true)
      const endTurnTrigger = followupEvents.some(
        (event) =>
          event.type === 'trigger-activated' &&
          event.source?.cardId === scenario.focalCardId &&
          event.trigger === 'end-of-turn'
      )
      const damages = followupEvents.filter(
        (event) =>
          event.sourceCardId === scenario.focalCardId && event.action === 'damage'
      )
      actual = {
        endTurnTrigger,
        damageAmounts: damages.map((event) => event.data?.amount ?? null)
      }
      passed =
        endTurnTrigger &&
        damages.length > 0 &&
        damages.some((event) => event.data?.amount === expected.amount)
      break
    }
    case 'adjacent-aura': {
      const before = actorBefore.board.find(
        (minion) => minion.instanceId !== outcome.focalInstanceId
      )
      const after = before
        ? minionById(outcome.postFocalState, before.instanceId)?.minion
        : null
      const enemyBefore = opponentBefore.board[0]
      const enemyAfter = enemyBefore
        ? minionById(outcome.postFocalState, enemyBefore.instanceId)?.minion
        : null
      actual = {
        friendlyAttackDelta: before && after ? after.attack - before.attack : null,
        enemyAttackDelta:
          enemyBefore && enemyAfter ? enemyAfter.attack - enemyBefore.attack : null
      }
      passed = Boolean(
        before &&
        after &&
        after.attack - before.attack === expected.attack &&
        enemyBefore &&
        enemyAfter &&
        enemyAfter.attack === enemyBefore.attack
      )
      break
    }
    case 'damage-total': {
      const damages = cardEvents.filter((event) => event.action === 'damage')
      const total = damages.reduce((sum, event) => sum + (event.data?.amount ?? 0), 0)
      actual = { hitCount: damages.length, requestedDamageTotal: total }
      passed = total === expected.amount
      break
    }
    case 'rejected-no-mutation': {
      actual = {
        accepted: Boolean(outcome.result?.accepted),
        stateUnchanged:
          stableJson(outcome.preActionState) === stableJson(outcome.state),
        rngUnchanged:
          stableJson(outcome.preActionRngState) === stableJson(outcome.rngState),
        legalTargets: outcome.requiredTargetCount
      }
      passed = Boolean(
        outcome.result &&
        !outcome.result.accepted &&
        outcome.requiredTargetCount > 0 &&
        actual.stateUnchanged &&
        actual.rngUnchanged
      )
      expectationStatus = 'established'
      break
    }
    default:
      fail('No pilot oracle evaluator exists for ' + oracle.type)
  }
  return assertion(
    'pilot-' + oracle.id,
    passed,
    expectedDescription,
    actual,
    { cardId: scenario.focalCardId, source: 'frozen card text or printed stats' },
    expectationStatus ?? 'provisional'
  )
}

function minionSurfaceByParticipant(state, participantId) {
  const player = statePlayer(state, participantId)
  if (!player) return []
  return player.board.map((minion) => ({
    instanceId: minion.instanceId,
    cardId: String(minion.cardId),
    ownerId: minion.ownerId ?? null,
    controllerId: minion.controllerId ?? null,
    attack: minion.attack,
    health: minion.health,
    maxHealth: minion.maxHealth,
    damageTaken: minion.damageTaken ?? null,
    keywords: [...(minion.keywords ?? [])].sort(),
    silenced: minion.silenced ?? false,
    frozenUntilTurn: minion.frozenUntilTurn ?? null,
    divineShield: minion.divineShield ?? false,
    stealth: minion.stealth ?? false,
    dormant: minion.dormant ?? false
  }))
}

function minionStateChanges(before, after, excludedInstanceId) {
  const beforeMinions = before.players.flatMap((player) =>
    minionSurfaceByParticipant(before, player.participantId)
  )
  const afterMinions = after.players.flatMap((player) =>
    minionSurfaceByParticipant(after, player.participantId)
  )
  const beforeById = new Map(beforeMinions.map((minion) => [minion.instanceId, minion]))
  const afterById = new Map(afterMinions.map((minion) => [minion.instanceId, minion]))
  const changes = []
  for (const [instanceId, minion] of beforeById) {
    if (instanceId === excludedInstanceId) continue
    const current = afterById.get(instanceId)
    if (!current)
      changes.push({ kind: 'removed', instanceId, cardId: minion.cardId, before: minion })
    else if (stableJson(minion) !== stableJson(current))
      changes.push({
        kind: 'updated',
        instanceId,
        cardId: minion.cardId,
        before: minion,
        after: current
      })
  }
  for (const [instanceId, minion] of afterById) {
    if (instanceId === excludedInstanceId || beforeById.has(instanceId)) continue
    changes.push({ kind: 'added', instanceId, cardId: minion.cardId, after: minion })
  }
  return changes
}

function heroStateChanges(before, after) {
  const changes = []
  for (const beforePlayer of before.players) {
    const afterPlayer = statePlayer(after, beforePlayer.participantId)
    if (!afterPlayer) continue
    const beforeHero = {
      heroId: String(beforePlayer.heroId),
      heroPowerId: String(beforePlayer.heroPower.id),
      health: beforePlayer.hero.health,
      armor: beforePlayer.hero.armor,
      attack: beforePlayer.hero.attack
    }
    const afterHero = {
      heroId: String(afterPlayer.heroId),
      heroPowerId: String(afterPlayer.heroPower.id),
      health: afterPlayer.hero.health,
      armor: afterPlayer.hero.armor,
      attack: afterPlayer.hero.attack
    }
    if (stableJson(beforeHero) !== stableJson(afterHero))
      changes.push({
        participantId: beforePlayer.participantId,
        before: beforeHero,
        after: afterHero
      })
  }
  return changes
}

function weaponStateChanges(before, after) {
  const weapons = (state) =>
    state.players.map((player) => ({
      participantId: player.participantId,
      weapon: player.weapon
        ? {
            cardId: String(player.weapon.cardId),
            attack: player.weapon.attack,
            durability: player.weapon.durability,
            maxDurability: player.weapon.maxDurability
          }
        : null
    }))
  const beforeWeapons = new Map(
    weapons(before).map((entry) => [entry.participantId, entry.weapon])
  )
  return weapons(after).flatMap((entry) => {
    const previous = beforeWeapons.get(entry.participantId)
    return stableJson(previous) === stableJson(entry.weapon)
      ? []
      : [
          {
            participantId: entry.participantId,
            before: previous ?? null,
            after: entry.weapon
          }
        ]
  })
}

function effectClauseTraceCoverage(clauses, traceEntries, cardId, focalInstanceId) {
  const focalEntries = traceEntries.filter(
    (entry) =>
      entry.sourceCardId === cardId &&
      (!focalInstanceId || entry.sourceInstanceId === focalInstanceId)
  )
  const clauseRows = clauses.map((clause) => {
    const actionSegment = 'actions[' + clause.rootActionIndex + ']'
    const playPrefix =
      'play-card.' + clause.trigger + '[' + clause.triggerIndex + ']'
    const triggerPrefix = 'trigger.' + clause.trigger + '.'
    const pendingChoicePrefix =
      clause.action === 'adapt' ? 'pending-choice.adapt.' : null
    const matches = focalEntries.filter(
      (entry) =>
        entry.actionPath.includes(actionSegment) &&
        (entry.actionPath.includes(playPrefix) ||
          entry.actionPath.startsWith(triggerPrefix) ||
          (pendingChoicePrefix !== null &&
            entry.actionPath.startsWith(pendingChoicePrefix)))
    )
    return {
      clauseId: clause.id,
      trigger: clause.trigger,
      action: clause.action,
      metadataPath: clause.metadataPath,
      traceStatus: matches.length > 0 ? 'trace-path-observed' : 'no-matching-trace-path',
      matchingTracePaths: [...new Set(matches.map((entry) => entry.actionPath))].sort()
    }
  })
  return {
    declaredActionClauseCount: clauses.length,
    traceObservedClauseCount: clauseRows.filter(
      (clause) => clause.traceStatus === 'trace-path-observed'
    ).length,
    focalTracePaths: [...new Set(focalEntries.map((entry) => entry.actionPath))].sort(),
    clauses: clauseRows
  }
}

function interactionObservation(scenario, first, specification) {
  const traceStart = first.preActionState.effectTrace?.length ?? 0
  const traceEntries = (first.state.effectTrace ?? []).slice(traceStart)
  const declaredClauses = specification?.effectClauses ?? []
  const clauseCoverage = effectClauseTraceCoverage(
    declaredClauses,
    traceEntries,
    scenario.focalCardId,
    first.focalInstanceId
  )
  const postFocalState = first.postFocalState ?? first.preActionState
  const changedHeroes = heroStateChanges(first.preActionState, postFocalState)
  const followupObservations = []
  let beforeFollowup = postFocalState
  for (let index = 0; index < (first.followupCommands ?? []).length; index += 1) {
    const afterFollowup = first.followupStates?.[index]
    if (!afterFollowup) continue
    const command = first.followupCommands[index]
    const result = first.followupResults?.[index]
    const addedTrace = (afterFollowup.effectTrace ?? []).slice(
      beforeFollowup.effectTrace?.length ?? 0
    )
    followupObservations.push({
      index,
      command,
      accepted: result?.accepted ?? null,
      resultCode: result?.code ?? null,
      effectTraceEntryCount: addedTrace.length,
      effectTracePaths: [...new Set(addedTrace.map((entry) => entry.actionPath))].sort(),
      focalTracePaths: [
        ...new Set(
          addedTrace
            .filter((entry) => entry.sourceCardId === scenario.focalCardId)
            .map((entry) => entry.actionPath)
        )
      ].sort(),
      changedMinions: minionStateChanges(beforeFollowup, afterFollowup),
      changedHeroes: heroStateChanges(beforeFollowup, afterFollowup),
      changedWeapons: weaponStateChanges(beforeFollowup, afterFollowup)
    })
    beforeFollowup = afterFollowup
  }
  const fixtureMinions = first.setupCommands
    .filter((command) => command?.type === 'dev-summon-minion')
    .map((command) => ({ participantId: command.participantId, cardId: command.cardId }))
  return {
    fixtureProfile: first.fixtureProfile,
    actor: first.actor,
    actorParticipantId: first.actorParticipantId,
    opponentParticipantId: first.opponentParticipantId,
    fixtureMinions,
    beforeActorBoard: minionSurfaceByParticipant(
      first.preActionState,
      first.actorParticipantId
    ),
    beforeOpponentBoard: minionSurfaceByParticipant(
      first.preActionState,
      first.opponentParticipantId
    ),
    focalCommandAccepted:
      first.entryPath === 'opening-quest'
        ? first.questRegistered
        : Boolean(first.result?.accepted),
    selectedTargets: first.command?.targets ?? [],
    stateChangeCheckpoint: first.postFocalState
      ? 'immediately-after-focal-play'
      : 'after-opening-objective-followups',
    bystanderMinionChanges: minionStateChanges(
      first.preActionState,
      first.postFocalState ?? first.state,
      first.focalBoardInstanceId ?? first.focalInstanceId
    ),
    focalBoardInstanceId: first.focalBoardInstanceId ?? null,
    changedHeroes,
    followupObservations,
    traceEntryCount: traceEntries.length,
    effectTrace: clauseCoverage,
    followups: (first.followupResults ?? []).map((result, index) => ({
      command: first.followupCommands?.[index] ?? null,
      accepted: result.accepted,
      code: result.code,
      message: result.message
    })),
    turnBoundaries: (first.followupCommands ?? [])
      .filter((command) => command?.type === 'end-turn')
      .map((command) => command.participantId)
  }
}

function summarizeOutcome(scenario, first, replay, error, specification) {
  if (error) {
    const setupBlocked = error.name === 'CardScenarioSetupError'
    const result = {
      recordType: 'scenario-outcome',
      scenarioId: scenario.scenarioId,
      campaignId: scenario.campaignId,
      phase: scenario.phase,
      focalCardId: scenario.focalCardId,
      status: setupBlocked ? 'Blocked/unsupported' : 'Blocked/unsupported',
      error: {
        name: error.name || 'Error',
        message: errorText(error),
        code: error.code ?? null
      },
      assertions: [],
      semanticCoverage: 'untested',
      completedAt: new Date().toISOString()
    }
    return result
  }

  const quest = first.entryPath === 'opening-quest'
  const accepted = Boolean(first.result && first.result.accepted)
  const replayConsistent = compareRun(first, replay)
  const assertionRecords = []
  if (quest) {
    assertionRecords.push(
      assertion(
        'opening-quest-registered',
        first.questRegistered,
        'Focal quest installed for selected actor',
        findQuest(first.initialState, first.actorParticipantId, first.cardId)
      )
    )
  }
  if (scenario.expectedCommandOutcome === 'rejected-no-state-change') {
    const unchanged = stableJson(first.preActionState) === stableJson(first.state)
    const rngUnchanged =
      stableJson(first.preActionRngState) === stableJson(first.rngState)
    assertionRecords.push(
      assertion(
        'gameplay-command-rejected-without-state-change',
        Boolean(first.result && !first.result.accepted && unchanged && rngUnchanged),
        'A card missing required targets is rejected without changing state or RNG.',
        {
          accepted: first.result?.accepted ?? null,
          stateUnchanged: unchanged,
          rngUnchanged,
          requiredTargetCount: first.requiredTargetCount
        }
      )
    )
  } else if (!quest) {
    assertionRecords.push(
      assertion(
        'gameplay-command-accepted',
        accepted,
        'The declared gameplay command is accepted.',
        first.result
          ? {
              accepted: first.result.accepted,
              code: first.result.code,
              message: first.result.message
            }
          : null
      )
    )
  }
  if (
    (first.followupResults ?? []).length > 0 &&
    scenario.followupPolicy !== 'observe-only'
  ) {
    assertionRecords.push(
      assertion(
        'followup-gameplay-commands-accepted',
        first.followupResults.every((result) => result.accepted),
        'Every declared follow-up gameplay command is accepted.',
        first.followupResults.map((result) => ({
          accepted: result.accepted,
          code: result.code,
          message: result.message
        }))
      )
    )
  }
  assertionRecords.push(
    assertion(
      'match-invariants-valid',
      !first.invariantError,
      'All opening-match structural invariants hold',
      first.invariantError ?? 'valid'
    ),
    assertion(
      'same-seed-replay-consistent',
      replayConsistent,
      'Canonical captured outcomes are identical',
      replayConsistent ? 'identical' : 'different'
    )
  )
  for (const oracle of scenario.oracle ?? [])
    assertionRecords.push(checkPilotOracle(scenario, first, oracle))
  const assertions = assertionRecords
  const behaviorCoverage =
    scenario.phase === 'interaction'
      ? interactionObservation(scenario, first, specification)
      : undefined
  const result = {
    recordType: 'scenario-outcome',
    scenarioId: scenario.scenarioId,
    campaignId: scenario.campaignId,
    phase: scenario.phase,
    focalCardId: scenario.focalCardId,
    status: outcomeStatus(assertions, false),
    entryPath: first.entryPath,
    actor: first.actor,
    fixtureProfile: first.fixtureProfile,
    seed: first.seed,
    assertions,
    semanticCoverage:
      scenario.phase === 'interaction'
        ? 'mixed-board-interaction-and-trace-observed-semantics-unverified'
        : (scenario.oracle ?? []).length > 0
        ? 'provisional-card-assertions-executed'
        : 'observed-unverified',
    commandAccepted: quest ? null : accepted,
    effectTraceEntryCount:
      (first.state.effectTrace ?? []).length -
      (first.preActionState.effectTrace ?? []).length,
    focalInstanceId: first.focalInstanceId ?? null,
    ...(behaviorCoverage ? { behaviorCoverage } : {}),
    completedAt: new Date().toISOString()
  }
  if (
    result.status === 'Failed established expectation' ||
    result.status === 'Suspected issue'
  )
    result.findingId =
      'finding-' + sha256(scenario.scenarioId + ':' + result.status).slice(0, 16)
  return result
}

function findQuest(state, participantId, cardId) {
  const player = statePlayer(state, participantId)
  const quest = player?.quest
  return quest && String(quest.cardId) === cardId
    ? {
        cardId: quest.cardId,
        goal: quest.goal,
        progress: quest.progress,
        target: quest.target
      }
    : (quest ?? null)
}

function createFinding(scenario, outcome, first, replay, spec, manifest) {
  const failed = outcome.assertions.filter((item) => item.status === 'failed')
  const evidencePath = 'evidence/' + scenario.scenarioId + '.json'
  const companions = new Set()
  for (const command of first.setupCommands ?? [])
    if (
      command &&
      typeof command.cardId === 'string' &&
      command.cardId !== scenario.focalCardId
    )
      companions.add(command.cardId)
  return {
    findingId: outcome.findingId,
    campaignId: manifest.campaignId,
    focalCardId: scenario.focalCardId,
    companions: [...companions].sort(),
    affectedScenarioIds: [scenario.scenarioId],
    observation: failed
      .map(
        (item) =>
          item.id +
          ': expected ' +
          JSON.stringify(item.expected) +
          ', got ' +
          JSON.stringify(item.actual)
      )
      .join('; '),
    proposedSeverity: failed.some((item) => item.id === 'match-invariants-valid')
      ? 'high'
      : 'medium',
    confidence:
      'medium for command/invariant mismatch; provisional for all semantic interpretation',
    expectedVersusActual: failed,
    expectationStatus: spec.specificationStatus,
    setup: first.setupCommands ?? [],
    gameplayCommand: first.command ?? null,
    seed: scenario.seed,
    inputFingerprint: manifest.inputFingerprint.fingerprint,
    replayId: scenario.scenarioId,
    replayConsistent: compareRun(first, replay),
    evidencePath,
    beforeStateReference: evidencePath + '#initialState',
    afterStateReference: evidencePath + '#state',
    traceReference: evidencePath + '#effectTrace',
    reproductionCount: 2,
    reduction: {
      attempted: false,
      reason: 'The baseline harness has no prerequisite-preserving reducer yet.'
    },
    legalGameplayReproduction: false,
    suspectedSharedCause: null,
    openQuestions: [
      'Does the intended rules text require additional timing, target, or surrounding-card expectations?'
    ],
    recommendedNextReviewAction:
      'Review the frozen card text, scenario command, and referenced evidence.',
    repairStatus: 'deferred'
  }
}

function writeEvidence(campaignDirectory, scenario, first, replay, error, outcome) {
  const filePath = path.join(
    campaignDirectory,
    'evidence',
    scenario.scenarioId + '.json'
  )
  const evidence = {
    scenario,
    error: error
      ? {
          name: error.name || 'Error',
          message: errorText(error),
          stack: error.stack ?? null
        }
      : null,
    outcome,
    firstRun: first ?? null,
    replayRun: replay ?? null
  }
  safeWriteJson(filePath, evidence)
}

function currentCardStatuses(inventory, outcomeMap) {
  const latestByCard = new Map()
  const phaseOrder = { baseline: 0, interaction: 1, pilot: 2 }
  for (const record of outcomeMap.values()) {
    const prior = latestByCard.get(record.focalCardId)
    if (!prior || (phaseOrder[record.phase] ?? -1) >= (phaseOrder[prior.phase] ?? -1))
      latestByCard.set(record.focalCardId, record)
  }
  return inventory.map((item) => ({
    ...item,
    outcome: latestByCard.get(item.cardId) ?? null
  }))
}

function statusText(status) {
  if (!status) return 'Untested'
  if (status === 'Observed, unverified') return 'Observed, unverified'
  return status
}

function makeProgressMarkdown(manifest, checkpoint, inventory, outcomeMap) {
  const rows = currentCardStatuses(inventory, outcomeMap)
  const interactionVisited = [...outcomeMap.values()].filter(
    (outcome) => outcome.phase === 'interaction' && outcome.status !== 'Interrupted'
  ).length
  const bySource = new Map()
  for (const row of rows) {
    const group = bySource.get(row.source) ?? []
    group.push(row)
    bySource.set(row.source, group)
  }
  const lines = [
    '# Card testing progress',
    '',
    'Current campaign: [' +
      manifest.campaignId +
      '](card-testing/' +
      manifest.campaignId +
      '/REPORT.md)',
    '',
    'Campaign state: **' +
      checkpoint.status +
      '**; phase **' +
      checkpoint.phase +
      '**; baseline cards **' +
      checkpoint.baselineVisited +
      '/' +
      manifest.catalog.cardCount +
      '**; interaction scenarios **' +
      interactionVisited +
      '/' +
      (manifest.phases.interactionScenarioCount ?? 0) +
      '**; total scenarios **' +
      checkpoint.scenariosVisited +
      '/' +
      manifest.phases.scenarios +
      '**.',
    '',
    'Results labeled “Observed, unverified” have reproducible setup, command, state, trace, replay, and invariant evidence, but lack a reviewed card-specific semantic oracle. Failed and blocked cases remain visible for human review.',
    '',
    '## Source-file progress',
    '',
    '| Source file or generated family | Cards | Tested | Failed | Blocked | Untested |',
    '| --- | ---: | ---: | ---: | ---: | ---: |'
  ]
  for (const [source, group] of [...bySource.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const tested = group.filter(
      (row) => row.outcome && row.outcome.status !== 'Blocked/unsupported'
    ).length
    const failed = group.filter(
      (row) =>
        (row.outcome && row.outcome.status === 'Failed established expectation') ||
        (row.outcome && row.outcome.status === 'Suspected issue')
    ).length
    const blocked = group.filter(
      (row) => row.outcome && row.outcome.status === 'Blocked/unsupported'
    ).length
    lines.push(
      '| `' +
        source +
        '` | ' +
        group.length +
        ' | ' +
        tested +
        ' | ' +
        failed +
        ' | ' +
        blocked +
        ' | ' +
        (group.length - tested - blocked) +
        ' |'
    )
  }
  lines.push('', '## Card-by-card status', '')
  for (const [source, group] of [...bySource.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    lines.push(
      '### `' + source + '`',
      '',
      '| Card ID | Type | Campaign status | Assertion coverage | Evidence |',
      '| --- | --- | --- | --- | --- |'
    )
    for (const row of group) {
      const outcome = row.outcome
      const assertionCoverage = outcome
        ? outcome.assertions.map((item) => item.id + ':' + item.status).join(', ')
        : 'not run'
      const evidence = outcome
        ? '[scenario](' +
          'card-testing/' +
          manifest.campaignId +
          '/evidence/' +
          outcome.scenarioId +
          '.json)'
        : '—'
      lines.push(
        '| `' +
          row.cardId +
          '` | ' +
          row.type +
          ' | ' +
          statusText(outcome?.status) +
          ' | ' +
          assertionCoverage +
          ' | ' +
          evidence +
          ' |'
      )
    }
    lines.push('')
  }
  return lines.join('\n') + '\n'
}

function latestCards(inventory, outcomeMap) {
  return currentCardStatuses(inventory, outcomeMap)
}

function makeCoverage(manifest, inventory, outcomes, specifications) {
  const rows = latestCards(inventory, outcomes)
  return {
    schemaVersion: 1,
    campaignId: manifest.campaignId,
    generatedAt: new Date().toISOString(),
    catalogCardCount: rows.length,
    plannedScenarioCount: manifest.phases.scenarios,
    executedScenarioCount: [...outcomes.values()].filter(isTerminalOutcome).length,
    cards: rows.map((row) => ({
      cardId: row.cardId,
      expansionId: row.expansionId,
      source: row.source,
      sourceKind: row.sourceKind,
      type: row.type,
      mechanicTags: specifications?.get(row.cardId)?.mechanicTags ?? [],
      effectClauses: specifications?.get(row.cardId)?.effectClauses ?? [],
      status: row.outcome?.status ?? 'Untested',
      scenarios: [...outcomes.values()]
        .filter((outcome) => outcome.focalCardId === row.cardId)
        .map((outcome) => ({
          scenarioId: outcome.scenarioId,
          phase: outcome.phase,
          status: outcome.status,
          actor: outcome.actor ?? null,
          planned: true,
          generated: true,
          setupValid: outcome.status !== 'Blocked/unsupported',
          executed: outcome.status !== 'Blocked/unsupported',
          asserted: outcome.assertions.map((item) => ({
            id: item.id,
            status: item.status
          })),
          reviewed: false
        }))
    }))
  }
}

function reportCounts(outcomes) {
  const counts = new Map()
  for (const outcome of outcomes.values())
    counts.set(outcome.status, (counts.get(outcome.status) ?? 0) + 1)
  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))
  )
}

function makeReport(manifest, checkpoint, inventory, outcomes, findings, specifications) {
  const cards = latestCards(inventory, outcomes)
  const statusCounts = reportCounts(outcomes)
  const interactionOutcomes = [...outcomes.values()].filter(
    (outcome) => outcome.phase === 'interaction'
  )
  const blocked = cards.filter((card) => card.outcome?.status === 'Blocked/unsupported')
  const baselineCards = new Set(
    [...outcomes.values()]
      .filter(
        (outcome) => outcome.phase === 'baseline' && outcome.status !== 'Interrupted'
      )
      .map((outcome) => outcome.focalCardId)
  )
  const untested = cards.filter((card) => !baselineCards.has(card.cardId))
  const lines = [
    '# Card testing campaign report',
    '',
    '- Campaign: `' + manifest.campaignId + '`',
    '- State: **' + checkpoint.status + '**',
    '- Inputs: `' + manifest.inputFingerprint.fingerprint + '`',
    '- Git commit: `' + manifest.git.commit + '`',
    '- Catalog: ' +
      manifest.catalog.cardCount +
      ' entries (' +
      manifest.catalog.staticCardCount +
      ' static, ' +
      manifest.catalog.dynamicZombeastCount +
      ' dynamic Zombeast forms).',
    '- Results: ' +
      checkpoint.scenariosVisited +
      '/' +
      manifest.phases.scenarios +
      ' scenarios; ' +
      checkpoint.baselineVisited +
      '/' +
      manifest.catalog.cardCount +
      ' cards have baseline visits; ' +
      interactionOutcomes.length +
      '/' +
      (manifest.phases.interactionScenarioCount ?? 0) +
      ' have broad interaction results.',
    '- Card statuses: ' + JSON.stringify(statusCounts),
    '- Automated findings: ' + findings.length,
    '- AI review: not configured; no model calls were made.',
    '',
    '## What this campaign checks',
    '',
    'Every baseline scenario uses a fresh seeded match, tries an opening quest through its opening-objective path or plays the focal card through the public gameplay command, checks state invariants, and replays the same input. The interaction phase repeats every catalog entry from the opposite player role with Taunt, Beast, Mech, Murloc, a Deathrattle minion, Divine Shield, high/low-stat bystanders, damaged minions on both sides, and weapons equipped on both heroes. It resolves pending card choices by selecting the first legal option, attempts a summon, spell, and healing companion, uses the hero power and attempts a weapon-backed hero attack after the focal card, then crosses both players’ turn boundaries to expose trigger, duration, and bystander behavior. Follow-up rejections are recorded as observations, not assumed defects. The 27-card pilot adds text-derived provisional behavior checks and a required-target rejection case. Full initial, pre-action, final, RNG, event-trace, follow-up, and replay evidence is stored by scenario.',
    '',
    'The interaction phase compares declared action clauses with source-card effect-trace paths and records selected targets, immediate bystander changes, and each follow-up step’s trace paths and minion, hero, and weapon changes. A trace path shows that the interpreter reached a path; it does not prove that the resulting damage, target selection, lifecycle, or bystander changes are correct. The scripted healing, hero-power, attack, and turn actions are interaction probes; they do not provide an independent semantic oracle. No per-card semantic specification has human approval in this campaign, so every card remains in the review queue.',
    '',
    '## Input identity',
    '',
    '- Harness: `' + manifest.harnessVersion + '`',
    '- Node: `' + manifest.runtime.node + '`',
    '- Dependency lock: `' + manifest.inputFingerprint.lockSha256 + '`',
    '- Catalog fingerprint: `' + manifest.catalog.sha256 + '`',
    '- Working-tree changes recorded at start: ' +
      manifest.git.workingTreeChanges.length,
    '',
    '## Findings',
    ''
  ]
  if (findings.length === 0)
    lines.push(
      'No command, invariant, or replay discrepancy was recorded in completed scenarios.'
    )
  else {
    for (const finding of findings) {
      lines.push(
        '- **' +
          finding.findingId +
          '** — `' +
          finding.focalCardId +
          '`: ' +
          finding.observation +
          ' [evidence](evidence/' +
          finding.replayId +
          '.json).'
      )
    }
  }
  lines.push(
    '',
    '## Baseline-blocked and untested cards',
    '',
    blocked.length
      ? blocked
          .map((card) => '- `' + card.cardId + '` — ' + card.outcome.error?.message)
          .join('\n')
      : 'None recorded.',
    '',
    untested.length
      ? untested.map((card) => '- `' + card.cardId + '`').join('\n')
      : 'None; every catalog entry has a baseline outcome.',
    '',
    '## Human review queue and complete catalog index',
    '',
    'All ' +
      cards.length +
      ' entries are listed because no card-specific semantic specification has human approval. Review the higher-priority rows first: a missing trace path means the current setup did not produce trace evidence for a declared action clause, not that the card is necessarily broken. Matching paths also need value, targeting, duration, and bystander checks against the intended rules.',
    '',
    '| Review priority | Card ID | Expansion / source | Declared effect clauses | Interaction observation | Human-review reason | Baseline | Interaction | Pilot |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'
  )
  for (const card of cards) {
    const cardOutcomes = [...outcomes.values()].filter(
      (outcome) => outcome.focalCardId === card.cardId
    )
    const baseline = cardOutcomes.find((outcome) => outcome.phase === 'baseline')
    const interaction = cardOutcomes.find((outcome) => outcome.phase === 'interaction')
    const pilot = cardOutcomes.find((outcome) => outcome.phase === 'pilot')
    const clauses =
      specifications?.get(card.cardId)?.effectClauses ?? card.effectClauses ?? []
    const effectCoverage = interaction?.behaviorCoverage?.effectTrace
    const clauseRows = effectCoverage?.clauses ?? []
    const missingClauses = clauseRows.filter(
      (clause) => clause.traceStatus !== 'trace-path-observed'
    )
    const traceSummary = interaction
      ? clauses.length
        ? (effectCoverage?.traceObservedClauseCount ?? 0) +
          '/' +
          clauses.length +
          ' clauses with trace paths; ' +
          (effectCoverage?.focalTracePaths?.length ?? 0) +
          ' focal paths'
        : 'No action clauses declared; inspect stats/keywords'
      : 'not run'
    const rejectedFollowups = (interaction?.behaviorCoverage?.followups ?? []).filter(
      (followup) => !followup.accepted
    )
    const interactionAssertions = interaction?.assertions ?? []
    const hasMismatch = interactionAssertions.some(
      (item) => item.status === 'failed'
    )
    const pilotFailures = (pilot?.assertions ?? []).filter(
      (item) => item.status === 'failed'
    )
    const priority =
      !interaction
        ? 'Interaction not run'
        : interaction.status === 'Blocked/unsupported'
          ? 'Unblock scenario'
          : hasMismatch || pilotFailures.length > 0
            ? 'Investigate behavior mismatch'
            : missingClauses.length > 0 || rejectedFollowups.length > 0
              ? 'Inspect coverage gap'
              : 'Review semantics'
    let reviewReason
    if (!interaction)
      reviewReason = 'No completed mixed-board interaction result.'
    else if (interaction.status === 'Blocked/unsupported')
      reviewReason = 'Scenario setup or execution was blocked: ' + interaction.error?.message
    else if (hasMismatch)
      reviewReason = 'Interaction assertion discrepancy: ' + interactionAssertions
        .filter((item) => item.status === 'failed')
        .map((item) => item.id)
        .join(', ')
    else if (pilotFailures.length > 0)
      reviewReason =
        'Provisional card-text oracle failed: ' +
        pilotFailures
          .map((item) => item.id + ' expected ' + JSON.stringify(item.expected) +
            ' but observed ' + JSON.stringify(item.actual))
          .join('; ') +
        '. Compare the declared effects with the printed card text.'
    else if (missingClauses.length > 0)
      reviewReason =
        'No matching trace path for: ' +
        missingClauses
          .map((clause) => clause.trigger + '/' + clause.action)
          .join(', ') +
        '; confirm the trigger setup and compare the implementation with card text.'
    else if (clauses.length > 0)
      reviewReason =
        'Action paths were traced, but amounts, target selection, timing, lifecycle, and bystander effects lack an independent reviewed oracle.'
    else
      reviewReason =
        'No action clauses were declared; verify printed stats/keywords, keyword behavior, targeting restrictions, and adjacent interactions.'
    if (rejectedFollowups.length > 0)
      reviewReason +=
        ' Companion follow-up rejection(s): ' +
        rejectedFollowups
          .map((followup) => followup.code ?? followup.message ?? 'unknown')
          .join(', ') +
        '.'
    const actionList = clauses.length
      ? clauses.map((clause) => clause.trigger + '/' + clause.action).join(', ')
      : '—'
    const baselineLink = baseline
      ? '[evidence](evidence/' + baseline.scenarioId + '.json)'
      : '—'
    const interactionLink = interaction
      ? '[evidence](evidence/' + interaction.scenarioId + '.json)'
      : '—'
    const pilotLink = pilot ? '[evidence](evidence/' + pilot.scenarioId + '.json)' : '—'
    lines.push(
      '| ' +
        priority +
        ' | `' +
        card.cardId +
        '` | `' +
        card.expansionId +
        '` / `' +
        card.source +
        '` | ' +
        actionList.replace(/\|/gu, '\\|') +
        ' | ' +
        traceSummary.replace(/\|/gu, '\\|') +
        ' | ' +
        reviewReason.replace(/\|/gu, '\\|') +
        ' | ' +
        baselineLink +
        ' | ' +
        interactionLink +
        ' | ' +
        pilotLink +
        ' |'
    )
  }
  lines.push(
    '',
    '## Replay instructions',
    '',
    'Run `node scripts/card-testing.cjs replay ' +
      manifest.campaignId +
      ' <scenario-id>` from the repository root. The replay command rejects changed frozen source inputs.',
    '',
    '## Review limits',
    '',
    'The current harness does not claim exhaustive pairwise or lifecycle coverage, does not implement automatic case reduction, and has no configured AI provider. The report preserves these gaps instead of counting commands as verified behaviors.',
    ''
  )
  return lines.join('\n')
}

function writeViews(
  campaignDirectory,
  manifest,
  checkpoint,
  inventory,
  outcomeRecords,
  findingRecords,
  specifications
) {
  const outcomes = latestOutcomeMap(outcomeRecords)
  safeWriteJson(
    path.join(campaignDirectory, 'coverage.json'),
    makeCoverage(manifest, inventory, outcomes, specifications)
  )
  safeWriteText(
    path.join(campaignDirectory, 'REPORT.md'),
    makeReport(manifest, checkpoint, inventory, outcomes, findingRecords, specifications)
  )
  safeWriteText(
    PROGRESS_PATH,
    makeProgressMarkdown(manifest, checkpoint, inventory, outcomes)
  )
}

function printStatus(campaignDirectory) {
  const manifest = readJson(path.join(campaignDirectory, 'manifest.json'))
  const checkpoint = readJson(path.join(campaignDirectory, 'checkpoint.json'))
  const outcomes = latestOutcomeMap(
    readJsonl(path.join(campaignDirectory, 'results.jsonl'))
  )
  const payload = {
    campaignId: manifest.campaignId,
    status: checkpoint.status,
    phase: checkpoint.phase,
    baselineVisited: checkpoint.baselineVisited,
    baselineTotal: manifest.catalog.cardCount,
    interactionVisited: checkpoint.interactionVisited ?? 0,
    interactionTotal: manifest.phases.interactionScenarioCount ?? 0,
    scenariosVisited: checkpoint.scenariosVisited,
    scenariosTotal: manifest.phases.scenarios,
    currentScenarioId: checkpoint.currentScenarioId,
    outcomeCounts: reportCounts(outcomes),
    lastHeartbeat: checkpoint.lastHeartbeat
  }
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n')
}

function parseOptions(args) {
  const result = {
    positional: [],
    maxScenarios: Number.MAX_SAFE_INTEGER,
    maxRuntimeMs: 4 * 60 * 60 * 1000
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--max-scenarios' || arg === '--max-runtime-ms' || arg === '--parent') {
      const value = args[index + 1]
      if (!value) fail('Missing value after ' + arg)
      index += 1
      if (arg === '--max-scenarios') result.maxScenarios = Number(value)
      else if (arg === '--max-runtime-ms') result.maxRuntimeMs = Number(value)
      else result.parent = value
    } else if (arg.startsWith('--')) fail('Unknown option: ' + arg)
    else result.positional.push(arg)
  }
  if (!Number.isInteger(result.maxScenarios) || result.maxScenarios < 1)
    fail('--max-scenarios must be a positive integer.')
  if (!Number.isFinite(result.maxRuntimeMs) || result.maxRuntimeMs < 1000)
    fail('--max-runtime-ms must be at least 1000.')
  return result
}

function activePid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

async function runCampaign(campaignDirectory, resume) {
  const manifestPath = path.join(campaignDirectory, 'manifest.json')
  const checkpointPath = path.join(campaignDirectory, 'checkpoint.json')
  const manifest = readJson(manifestPath)
  const checkpoint = readJson(checkpointPath)
  assertFrozenInputs(manifest, true)

  const lockPath = path.join(campaignDirectory, 'worker.lock')
  if (fs.existsSync(lockPath)) {
    const lock = readJson(lockPath)
    if (activePid(lock.pid))
      fail('Campaign already has a live worker process ' + lock.pid + '.')
    if (checkpoint.currentScenarioId) {
      appendJsonl(path.join(campaignDirectory, 'events.jsonl'), {
        event: 'interrupted-after-restart',
        scenarioId: checkpoint.currentScenarioId,
        detectedAt: new Date().toISOString()
      })
      appendJsonl(path.join(campaignDirectory, 'results.jsonl'), {
        recordType: 'scenario-outcome',
        scenarioId: checkpoint.currentScenarioId,
        campaignId: manifest.campaignId,
        phase: checkpoint.phase,
        focalCardId: checkpoint.currentCardId,
        status: 'Interrupted',
        completedAt: new Date().toISOString()
      })
    }
  }

  const engine = await loadEngine()
  let scenarios
  let inventory
  try {
    inventory = makeInventory(engine)
    scenarios = createQueue(engine, manifest.campaignId)
    validateCatalogReferences(engine, scenarios)
    if (scenarios.length !== manifest.phases.scenarios)
      fail('Current scenario inventory differs from frozen campaign manifest.')
  } catch (error) {
    await engine.server.close()
    throw error
  }
  const specsPath = path.join(campaignDirectory, 'specifications.json')
  const specifications = new Map(readJson(specsPath).map((spec) => [spec.cardId, spec]))
  const existingScenarioRecords = readJsonl(
    path.join(campaignDirectory, 'scenarios.jsonl')
  )
  const scenarioPlans = new Set(
    existingScenarioRecords
      .filter((record) => record.recordType === 'scenario-plan')
      .map((record) => record.scenarioId)
  )
  let outcomeRecords = readJsonl(path.join(campaignDirectory, 'results.jsonl'))
  let findingRecords = readJsonl(path.join(campaignDirectory, 'findings.jsonl'))
  let outcomes = latestOutcomeMap(outcomeRecords)
  const completed = new Set(
    [...outcomes.entries()]
      .filter(([, outcome]) => isTerminalOutcome(outcome))
      .map(([id]) => id)
  )
  let nextIndex = scenarios.findIndex((scenario) => !completed.has(scenario.scenarioId))
  if (nextIndex < 0) nextIndex = scenarios.length
  const startedAt = Date.now()
  const maxScenarioCount = manifest.budgets.maxScenarios
  const maxRuntimeMs = manifest.budgets.maxRuntimeMs
  let pauseRequested = false
  const handleSignal = () => {
    pauseRequested = true
  }
  process.on('SIGINT', handleSignal)
  process.on('SIGTERM', handleSignal)
  safeWriteJson(lockPath, {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    resume
  })
  checkpoint.status = 'running'
  checkpoint.lastHeartbeat = new Date().toISOString()
  checkpoint.nextIndex = nextIndex
  checkpoint.currentScenarioId = null
  checkpoint.currentCardId = null
  checkpoint.phase = scenarios[nextIndex]?.phase ?? 'complete'
  checkpoint.interactionVisited = [...completed].filter((id) =>
    id.startsWith('interaction-')
  ).length
  safeWriteJson(checkpointPath, checkpoint)
  appendJsonl(path.join(campaignDirectory, 'events.jsonl'), {
    event: resume ? 'worker-resumed' : 'worker-started',
    pid: process.pid,
    at: new Date().toISOString(),
    nextIndex
  })

  let sinceView = 0
  let fingerprintCheckIndex = nextIndex
  let queueFailure = null
  try {
    for (let index = nextIndex; index < scenarios.length; index += 1) {
      const scenario = scenarios[index]
      const elapsed = Date.now() - startedAt
      if (completed.size - nextIndex >= maxScenarioCount || elapsed >= maxRuntimeMs) {
        checkpoint.status = 'paused'
        checkpoint.pauseReason =
          elapsed >= maxRuntimeMs
            ? 'runtime-budget-exhausted'
            : 'scenario-budget-exhausted'
        checkpoint.nextIndex = index
        checkpoint.lastHeartbeat = new Date().toISOString()
        break
      }
      if (index - fingerprintCheckIndex >= 10) {
        assertFrozenInputs(manifest, false)
        fingerprintCheckIndex = index
      }
      const pauseMarker = path.join(campaignDirectory, 'pause.request')
      if (pauseRequested || fs.existsSync(pauseMarker)) {
        checkpoint.status = 'paused'
        checkpoint.pauseReason = 'operator-requested'
        checkpoint.nextIndex = index
        checkpoint.lastHeartbeat = new Date().toISOString()
        if (fs.existsSync(pauseMarker)) fs.rmSync(pauseMarker)
        break
      }

      if (!scenarioPlans.has(scenario.scenarioId)) {
        appendJsonl(path.join(campaignDirectory, 'scenarios.jsonl'), {
          recordType: 'scenario-plan',
          ...scenario
        })
        scenarioPlans.add(scenario.scenarioId)
      }
      checkpoint.status = 'running'
      checkpoint.phase = scenario.phase
      checkpoint.nextIndex = index
      checkpoint.currentScenarioId = scenario.scenarioId
      checkpoint.currentCardId = scenario.focalCardId
      checkpoint.scenariosVisited = completed.size
      checkpoint.baselineVisited = scenarios
        .slice(0, manifest.catalog.cardCount)
        .filter((item) => completed.has(item.scenarioId)).length
      checkpoint.lastHeartbeat = new Date().toISOString()
      safeWriteJson(checkpointPath, checkpoint)
      appendJsonl(path.join(campaignDirectory, 'events.jsonl'), {
        event: 'scenario-started',
        scenarioId: scenario.scenarioId,
        cardId: scenario.focalCardId,
        phase: scenario.phase,
        at: new Date().toISOString()
      })

      let first = null
      let replay = null
      let error = null
      try {
        first = engine.runCatalogCardScenario({
          cardId: scenario.focalCardId,
          seed: scenario.seed,
          actor: scenario.actor,
          fixtureProfile:
      scenario.setup.fixtureProfile === 'mixed-board-interaction-v2'
              ? 'mixed-board-interaction-v2'
              : undefined,
          followupPolicy: scenario.followupPolicy,
          inputSelection: scenario.inputSelection,
          followups: scenario.followups
        })
        replay = engine.runCatalogCardScenario({
          cardId: scenario.focalCardId,
          seed: scenario.seed,
          actor: scenario.actor,
          fixtureProfile:
      scenario.setup.fixtureProfile === 'mixed-board-interaction-v2'
              ? 'mixed-board-interaction-v2'
              : undefined,
          followupPolicy: scenario.followupPolicy,
          inputSelection: scenario.inputSelection,
          followups: scenario.followups
        })
      } catch (caught) {
        error = caught
      }
      const spec = specifications.get(scenario.focalCardId)
      const outcome = summarizeOutcome(scenario, first, replay, error, spec)
      if (first && replay && outcome.findingId) {
        const finding = createFinding(scenario, outcome, first, replay, spec, manifest)
        findingRecords.push(finding)
        appendJsonl(path.join(campaignDirectory, 'findings.jsonl'), finding)
      }
      writeEvidence(campaignDirectory, scenario, first, replay, error, outcome)
      if (first) {
        const executedScenario = {
          recordType: 'scenario-execution',
          scenarioId: scenario.scenarioId,
          setupCommands: first.setupCommands,
          behaviorCommand: first.command ?? null,
          commandResult: first.result ?? null,
          followupCommands: first.followupCommands ?? [],
          followupResults: first.followupResults ?? [],
          followupStateCount: first.followupStates?.length ?? 0,
          eventTrace: (first.state.effectTrace ?? []).slice(
            first.preActionState.effectTrace?.length ?? 0
          ),
          entryPath: first.entryPath,
          actor: first.actor,
          seed: first.seed
        }
        appendJsonl(path.join(campaignDirectory, 'scenarios.jsonl'), executedScenario)
      }
      appendJsonl(path.join(campaignDirectory, 'results.jsonl'), outcome)
      outcomeRecords.push(outcome)
      outcomes.set(outcome.scenarioId, outcome)
      completed.add(scenario.scenarioId)
      appendJsonl(path.join(campaignDirectory, 'events.jsonl'), {
        event: 'scenario-completed',
        scenarioId: scenario.scenarioId,
        status: outcome.status,
        at: new Date().toISOString()
      })
      checkpoint.nextIndex = index + 1
      checkpoint.currentScenarioId = null
      checkpoint.currentCardId = null
      checkpoint.scenariosVisited = completed.size
      checkpoint.baselineVisited = Math.min(
        manifest.catalog.cardCount,
        [...completed].filter((id) => id.startsWith('baseline-')).length
      )
      checkpoint.interactionVisited = [...completed].filter((id) =>
        id.startsWith('interaction-')
      ).length
      checkpoint.lastHeartbeat = new Date().toISOString()
      checkpoint.pauseReason = null
      sinceView += 1
      if (sinceView >= 25 || index === scenarios.length - 1) {
        safeWriteJson(checkpointPath, checkpoint)
        writeViews(
          campaignDirectory,
          manifest,
          checkpoint,
          inventory,
          outcomeRecords,
          findingRecords,
          specifications
        )
        sinceView = 0
      } else {
        safeWriteJson(checkpointPath, checkpoint)
      }
      if (outcome.status === 'Blocked/unsupported') {
        // A blocked card remains an explicit result; the ordered queue still advances.
      }
    }
    if (checkpoint.status === 'running') {
      const allBaselineTerminal = scenarios
        .slice(0, manifest.catalog.cardCount)
        .every((scenario) => completed.has(scenario.scenarioId))
      checkpoint.status =
        completed.size === scenarios.length
          ? 'complete'
          : allBaselineTerminal
            ? 'paused'
            : 'paused'
      if (completed.size === scenarios.length) checkpoint.pauseReason = null
      checkpoint.nextIndex = scenarios.findIndex(
        (scenario) => !completed.has(scenario.scenarioId)
      )
      if (checkpoint.nextIndex < 0) checkpoint.nextIndex = scenarios.length
    }
    assertFrozenInputs(manifest, true)
  } catch (caught) {
    queueFailure = caught
    checkpoint.status = errorText(caught).includes('Frozen source')
      ? 'input-changed'
      : 'failed'
    checkpoint.pauseReason = errorText(caught)
  } finally {
    checkpoint.lastHeartbeat = new Date().toISOString()
    checkpoint.currentScenarioId = null
    checkpoint.currentCardId = null
    safeWriteJson(checkpointPath, checkpoint)
    writeViews(
      campaignDirectory,
      manifest,
      checkpoint,
      inventory,
      outcomeRecords,
      findingRecords,
      specifications
    )
    process.off('SIGINT', handleSignal)
    process.off('SIGTERM', handleSignal)
    fs.rmSync(lockPath, { force: true })
    await engine.server.close()
  }

  process.stdout.write(
    JSON.stringify(
      {
        campaignId: manifest.campaignId,
        status: checkpoint.status,
        baselineVisited: checkpoint.baselineVisited,
        interactionVisited: checkpoint.interactionVisited ?? 0,
        scenariosVisited: checkpoint.scenariosVisited,
        scenariosTotal: manifest.phases.scenarios,
        currentIndex: checkpoint.nextIndex,
        outcomeCounts: reportCounts(outcomes),
        report: path.join(campaignDirectory, 'REPORT.md')
      },
      null,
      2
    ) + '\n'
  )
  if (queueFailure) throw queueFailure
}

function deriveSourceFiles(engine) {
  return engine.entries.map((entry) => ({
    cardId: String(entry.card.id),
    source: cardSourceLabel(entry),
    card: entry.card
  }))
}

async function startCampaign(options) {
  const campaignId =
    options.positional[0] ??
    new Date().toISOString().replace(/[:.]/gu, '-').replace('T', '_').replace('Z', 'Z')
  const campaignDirectory = safeCampaignPath(campaignId)
  if (fs.existsSync(campaignDirectory)) fail('Campaign already exists: ' + campaignId)
  const engine = await loadEngine()
  try {
    const inventory = makeInventory(engine)
    const scenarios = createQueue(engine, campaignId)
    validateCatalogReferences(engine, scenarios)
    const missingPilot = PILOT_CARD_IDS.filter((id) => !engine.cardById.has(id))
    if (missingPilot.length)
      fail('Pilot inventory is incomplete: ' + missingPilot.join(', '))
    const manifest = buildManifest(campaignId, engine, scenarios, options)
    const campaignSpecs = engine.entries.map(specificationFor)
    const checkpoint = {
      schemaVersion: 1,
      campaignId,
      status: 'planned',
      phase: 'baseline',
      nextIndex: 0,
      currentScenarioId: null,
      currentCardId: null,
      scenariosVisited: 0,
      baselineVisited: 0,
      interactionVisited: 0,
      lastHeartbeat: new Date().toISOString(),
      pauseReason: null
    }
    fs.mkdirSync(path.join(campaignDirectory, 'evidence'), { recursive: true })
    safeWriteJson(path.join(campaignDirectory, 'manifest.json'), manifest)
    safeWriteJson(path.join(campaignDirectory, 'checkpoint.json'), checkpoint)
    safeWriteJson(path.join(campaignDirectory, 'specifications.json'), campaignSpecs)
    const specificationMap = new Map(campaignSpecs.map((spec) => [spec.cardId, spec]))
    safeWriteJson(
      path.join(campaignDirectory, 'coverage.json'),
      makeCoverage(manifest, inventory, new Map(), specificationMap)
    )
    for (const file of [
      'scenarios.jsonl',
      'results.jsonl',
      'findings.jsonl',
      'monitor-notes.jsonl',
      'events.jsonl'
    ])
      fs.writeFileSync(path.join(campaignDirectory, file), '', 'utf8')
    safeWriteText(
      path.join(campaignDirectory, 'REPORT.md'),
      makeReport(manifest, checkpoint, inventory, new Map(), [], specificationMap)
    )
    safeWriteText(
      PROGRESS_PATH,
      makeProgressMarkdown(manifest, checkpoint, inventory, new Map())
    )
    process.stdout.write(
      'Created campaign ' +
        campaignId +
        ' for ' +
        inventory.length +
        ' catalog entries.\n'
    )
  } finally {
    await engine.server.close()
  }
  await runCampaign(campaignDirectory, false)
}

function pauseCampaign(campaignDirectory) {
  const checkpointPath = path.join(campaignDirectory, 'checkpoint.json')
  const checkpoint = readJson(checkpointPath)
  const lockPath = path.join(campaignDirectory, 'worker.lock')
  if (fs.existsSync(lockPath) && activePid(readJson(lockPath).pid)) {
    fs.writeFileSync(
      path.join(campaignDirectory, 'pause.request'),
      new Date().toISOString() + '\n',
      'utf8'
    )
    process.stdout.write(
      'Pause requested; the worker will stop after its current scenario.\n'
    )
    return
  }
  if (checkpoint.status === 'complete') fail('A completed campaign cannot be paused.')
  checkpoint.status = 'paused'
  checkpoint.pauseReason = 'operator-requested-before-resume'
  checkpoint.lastHeartbeat = new Date().toISOString()
  safeWriteJson(checkpointPath, checkpoint)
  process.stdout.write('Campaign paused at the last durable checkpoint.\n')
}

async function replayScenario(campaignDirectory, scenarioId) {
  const manifest = readJson(path.join(campaignDirectory, 'manifest.json'))
  assertFrozenInputs(manifest, true)
  const scenarioRecords = readJsonl(path.join(campaignDirectory, 'scenarios.jsonl'))
  const plan = scenarioRecords.find(
    (record) =>
      record.recordType === 'scenario-plan' && record.scenarioId === scenarioId
  )
  if (!plan) fail('Unknown scenario id: ' + scenarioId)
  const engine = await loadEngine()
  try {
    const first = engine.runCatalogCardScenario({
      cardId: plan.focalCardId,
      seed: plan.seed,
      actor: plan.actor,
      fixtureProfile:
        plan.setup.fixtureProfile === 'mixed-board-interaction-v2'
          ? 'mixed-board-interaction-v2'
          : undefined,
      followupPolicy: plan.followupPolicy,
      inputSelection: plan.inputSelection,
      followups: plan.followups
    })
    const replay = engine.runCatalogCardScenario({
      cardId: plan.focalCardId,
      seed: plan.seed,
      actor: plan.actor,
      fixtureProfile:
        plan.setup.fixtureProfile === 'mixed-board-interaction-v2'
          ? 'mixed-board-interaction-v2'
          : undefined,
      followupPolicy: plan.followupPolicy,
      inputSelection: plan.inputSelection,
      followups: plan.followups
    })
    const consistent = compareRun(first, replay)
    const targetPath = path.join(
      campaignDirectory,
      'evidence',
      scenarioId + '.replay-' + Date.now() + '.json'
    )
    safeWriteJson(targetPath, {
      scenario: plan,
      firstRun: first,
      replayRun: replay,
      consistent
    })
    process.stdout.write(
      JSON.stringify(
        {
          scenarioId,
          consistent,
          evidence: path.relative(campaignDirectory, targetPath).replace(/\\/gu, '/')
        },
        null,
        2
      ) + '\n'
    )
    if (!consistent) process.exitCode = 2
  } finally {
    await engine.server.close()
  }
}

async function preflight() {
  const inputFingerprint = fingerprintInputs()
  const engine = await loadEngine()
  try {
    const inventory = makeInventory(engine)
    const scenarios = createQueue(engine, 'preflight')
    validateCatalogReferences(engine, scenarios)
    const questEntry = engine.entries.find(
      (entry) => entry.card.type === 'Spell' && entry.card.quest
    )
    const zombeastEntry = engine.entries.find(
      (entry) => entry.sourceKind === 'dynamic-zombeast'
    )
    const ordinaryEntry = engine.entries.find(
      (entry) => entry.card.type !== 'Spell' || !entry.card.quest
    )
    if (!questEntry || !zombeastEntry || !ordinaryEntry)
      fail('Preflight inventory is missing an expected special entry path.')
    const checks = []
    for (const entry of [ordinaryEntry, questEntry, zombeastEntry]) {
      const first = engine.runCatalogCardScenario({
        cardId: String(entry.card.id),
        seed: 0x70ef0000 + checks.length,
        actor: checks.length % 2 === 0 ? 'first' : 'second'
      })
      const replay = engine.runCatalogCardScenario({
        cardId: String(entry.card.id),
        seed: 0x70ef0000 + checks.length,
        actor: checks.length % 2 === 0 ? 'first' : 'second'
      })
      const isQuest = first.entryPath === 'opening-quest'
      if (isQuest ? !first.questRegistered : !first.result?.accepted)
        fail('Preflight gameplay check failed for ' + entry.card.id)
      if (first.invariantError)
        fail(
          'Preflight invariant check failed for ' +
            entry.card.id +
            ': ' +
            first.invariantError
        )
      if (!compareRun(first, replay))
        fail('Preflight replay check failed for ' + entry.card.id)
      checks.push({
        cardId: String(entry.card.id),
        entryPath: first.entryPath,
        accepted: isQuest ? first.questRegistered : Boolean(first.result?.accepted),
        replayConsistent: true,
        invariantError: null
      })
    }
    const provisionalFailure = assertion(
      'preflight-provisional-reporter-check',
      false,
      'synthetic provisional expectation should be reported as suspected',
      'synthetic mismatch',
      undefined,
      'provisional'
    )
    const establishedFailure = assertion(
      'preflight-established-reporter-check',
      false,
      'synthetic established expectation should be reported as failed',
      'synthetic mismatch'
    )
    if (outcomeStatus([provisionalFailure], false) !== 'Suspected issue')
      fail('Preflight reporter did not flag provisional mismatches as suspected.')
    if (outcomeStatus([establishedFailure], false) !== 'Failed established expectation')
      fail('Preflight reporter did not preserve established failure severity.')

    const pilotChecks = []
    for (const pilotScenario of scenarios.filter(
      (scenario) => scenario.phase === 'pilot'
    )) {
      const first = engine.runCatalogCardScenario({
        cardId: pilotScenario.focalCardId,
        seed: pilotScenario.seed,
        actor: pilotScenario.actor,
        inputSelection: pilotScenario.inputSelection,
        followups: pilotScenario.followups
      })
      const replay = engine.runCatalogCardScenario({
        cardId: pilotScenario.focalCardId,
        seed: pilotScenario.seed,
        actor: pilotScenario.actor,
        inputSelection: pilotScenario.inputSelection,
        followups: pilotScenario.followups
      })
      if (!compareRun(first, replay))
        fail('Preflight pilot replay check failed for ' + pilotScenario.scenarioId)
      const outcome = summarizeOutcome(pilotScenario, first, replay, null)
      pilotChecks.push({
        cardId: pilotScenario.focalCardId,
        caseId: pilotScenario.caseId,
        status: outcome.status,
        assertions: outcome.assertions.map((item) => ({
          id: item.id,
          status: item.status,
          ...(item.status === 'failed'
            ? { expected: item.expected, actual: item.actual }
            : {})
        }))
      })
    }
    const broadCaseIds = [
      'basic_houndmaster',
      'basic_fireball',
      'basic_tracking',
      'classic_sprint',
      'league_of_explorers_sir_finley_mrrgglton',
      'classic_arathi_weaponsmith',
      'classic_the_black_knight',
      'whispers_of_the_old_gods_doom',
      String(questEntry.card.id),
      String(zombeastEntry.card.id)
    ]
    const interactionChecks = []
    for (const cardId of [...new Set(broadCaseIds)]) {
      const interactionScenario = scenarios.find(
        (scenario) =>
          scenario.phase === 'interaction' && scenario.focalCardId === cardId
      )
      if (!interactionScenario)
        fail('Preflight interaction scenario is missing for ' + cardId)
      const options = {
        cardId,
        seed: interactionScenario.seed,
        actor: interactionScenario.actor,
        fixtureProfile: 'mixed-board-interaction-v2',
        followupPolicy: 'observe-only',
        inputSelection: interactionScenario.inputSelection,
        followups: interactionScenario.followups
      }
      const first = engine.runCatalogCardScenario(options)
      const replay = engine.runCatalogCardScenario(options)
      if (!compareRun(first, replay))
        fail('Preflight interaction replay check failed for ' + cardId)
      if (first.invariantError)
        fail('Preflight interaction invariant check failed for ' + cardId)
      if (first.fixtureProfile !== 'mixed-board-interaction-v2')
        fail('Preflight interaction fixture profile was not applied for ' + cardId)
      if (!first.preActionState.players.every((player) => player.weapon !== null))
        fail('Preflight interaction is missing a player weapon for ' + cardId)
      if (
        !first.followupCommands?.some((command) => command?.type === 'use-hero-power') ||
        !first.followupCommands?.some((command) => command?.type === 'attack-character')
      )
        fail('Preflight interaction is missing its post-card hero actions for ' + cardId)
      if (cardId === 'classic_arathi_weaponsmith') {
        const heroPowerIndex = first.followupCommands.findIndex(
          (command) => command?.type === 'use-hero-power'
        )
        const heroPowerResult = first.followupResults[heroPowerIndex]
        if (heroPowerIndex < 0 || heroPowerResult?.code === 'extra-input')
          fail('Preflight did not adapt the hero-power input after ' + cardId)
      }
      if (cardId === 'classic_the_black_knight') {
        const attackIndex = first.followupCommands.findIndex(
          (command) => command?.type === 'attack-character'
        )
        if (
          attackIndex < 0 ||
          first.followupResults[attackIndex]?.code === 'invalid-target'
        )
          fail('Preflight hero attack did not respect Taunt after ' + cardId)
      }
      if (cardId === 'whispers_of_the_old_gods_doom') {
        const heroPowerIndex = first.followupCommands.findIndex(
          (command) => command?.type === 'use-hero-power'
        )
        if (
          heroPowerIndex < 0 ||
          first.followupResults[heroPowerIndex]?.code === 'stale-target'
        )
          fail('Preflight hero-power targeting became stale after ' + cardId)
      }
      const entry = engine.entries.find(
        (candidate) => String(candidate.card.id) === cardId
      )
      if (!entry) fail('Preflight interaction inventory entry is missing for ' + cardId)
      const outcome = summarizeOutcome(
        interactionScenario,
        first,
        replay,
        null,
        specificationFor(entry)
      )
      interactionChecks.push({
        cardId,
        entryPath: first.entryPath,
        focalCommandAccepted:
          first.entryPath === 'opening-quest'
            ? first.questRegistered
            : Boolean(first.result?.accepted),
        bystanderChanges:
          outcome.behaviorCoverage?.bystanderMinionChanges.length ?? 0,
        focalTracePaths:
          outcome.behaviorCoverage?.effectTrace.focalTracePaths.length ?? 0,
        focalBoardInstanceId: first.focalBoardInstanceId ?? null,
        weaponFixture: first.preActionState.players.map(
          (player) => player.weapon?.cardId ?? null
        ),
        heroPowerAttempted: first.followupCommands?.some(
          (command) => command?.type === 'use-hero-power'
        ) ?? false,
        heroPowerAccepted: (() => {
          const index = first.followupCommands?.findIndex(
            (command) => command?.type === 'use-hero-power'
          ) ?? -1
          return index >= 0 ? first.followupResults?.[index]?.accepted ?? false : false
        })(),
        heroPowerResultCode: (() => {
          const index = first.followupCommands?.findIndex(
            (command) => command?.type === 'use-hero-power'
          ) ?? -1
          return index >= 0 ? first.followupResults?.[index]?.code ?? null : null
        })(),
        heroAttackAttempted: first.followupCommands?.some(
          (command) => command?.type === 'attack-character'
        ) ?? false,
        followupsObserved: first.followupResults?.length ?? 0,
        replayConsistent: true
      })
    }
    const current = fingerprintInputs()
    if (current.fingerprint !== inputFingerprint.fingerprint)
      fail('Source inputs changed while preflight was running.')
    const artifactsDirectory = path.join(ROOT, 'Artifacts')
    fs.accessSync(artifactsDirectory, fs.constants.W_OK)
    process.stdout.write(
      JSON.stringify(
        {
          status: 'passed',
          catalogEntries: inventory.length,
          staticEntries: inventory.filter(
            (entry) => entry.sourceKind !== 'dynamic-zombeast'
          ).length,
          dynamicZombeasts: inventory.filter(
            (entry) => entry.sourceKind === 'dynamic-zombeast'
          ).length,
          scenarioSchemasValidated: scenarios.length,
          representativeReplayChecks: checks,
          interactionReplayChecks: interactionChecks,
          pilotReplayChecks: pilotChecks,
          provisionalReporterCheck: 'passed',
          inputFingerprint: inputFingerprint.fingerprint,
          artifactDestinationWritable: true
        },
        null,
        2
      ) + '\n'
    )
  } finally {
    await engine.server.close()
  }
}

async function main() {
  const operation = process.argv[2]
  const options = parseOptions(process.argv.slice(3))
  if (operation === 'preflight') return preflight()
  if (operation === 'start') return startCampaign(options)
  if (!['status', 'pause', 'resume', 'replay', 'report'].includes(operation)) {
    process.stdout.write(
      'Usage: node scripts/card-testing.cjs <preflight|start|status|pause|resume|replay|report> <campaign-id> [scenario-id]\n'
    )
    process.exitCode = 1
    return
  }
  const campaignId = options.positional[0]
  if (!campaignId) fail('Campaign id is required.')
  const campaignDirectory = safeCampaignPath(campaignId)
  if (!fs.existsSync(campaignDirectory)) fail('Campaign does not exist: ' + campaignId)
  if (operation === 'status') return printStatus(campaignDirectory)
  if (operation === 'pause') return pauseCampaign(campaignDirectory)
  if (operation === 'resume') return runCampaign(campaignDirectory, true)
  if (operation === 'replay') {
    const scenarioId = options.positional[1]
    if (!scenarioId) fail('Scenario id is required for replay.')
    return replayScenario(campaignDirectory, scenarioId)
  }
  if (operation === 'report') {
    const manifest = readJson(path.join(campaignDirectory, 'manifest.json'))
    const checkpoint = readJson(path.join(campaignDirectory, 'checkpoint.json'))
    const outcomes = readJsonl(path.join(campaignDirectory, 'results.jsonl'))
    const findings = readJsonl(path.join(campaignDirectory, 'findings.jsonl'))
    const inventory = readJson(path.join(campaignDirectory, 'coverage.json')).cards.map(
      (card) => ({
        cardId: card.cardId,
        expansionId: card.expansionId,
        source: card.source,
        sourceKind: card.sourceKind,
        type: card.type ?? 'unknown',
        effectClauses: card.effectClauses ?? []
      })
    )
    safeWriteText(
      path.join(campaignDirectory, 'REPORT.md'),
      makeReport(manifest, checkpoint, inventory, latestOutcomeMap(outcomes), findings)
    )
    process.stdout.write(path.join(campaignDirectory, 'REPORT.md') + '\n')
  }
}

main().catch((error) => {
  process.stderr.write((error && error.stack) || String(error))
  process.stderr.write('\n')
  process.exitCode = 1
})
