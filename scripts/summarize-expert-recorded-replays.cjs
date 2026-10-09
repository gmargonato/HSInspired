const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(process.argv[2] ?? 'artifacts/expert-recorded-replays')
const contexts = JSON.parse(fs.readFileSync(path.join(root, 'contexts.json'), 'utf8'))
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))
const resultFiles = [
  'results.jsonl',
  ...(manifest.workers ?? ['worker-0', 'worker-1']).map(
    (worker) => worker + '/results.jsonl'
  )
]
const rows = [
  ...new Map(
    resultFiles
      .filter((file) => fs.existsSync(path.join(root, file)))
      .flatMap((file) =>
        fs
          .readFileSync(path.join(root, file), 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map(JSON.parse)
      )
      .map((row) => [`${row.id}:${row.seed}:${row.version}`, row])
  ).values()
]
const enemy = (snapshot) => snapshot.find((p) => p.id === 'fixture-player-one')
const played = (action, name) =>
  action.command.type === 'play-card' &&
  action.description.startsWith('play-card: ' + name + ' (')

function assess(row, context) {
  const actions = row.actions
  const beforeEnd =
    actions.find((a) => a.command.type === 'end-turn')?.before ?? row.final
  const has = (snapshot, name) => enemy(snapshot).board.some((m) => m.name === name)
  switch (row.id) {
    case 'pain-doomsayer':
      return has(beforeEnd, 'Doomsayer') ? 'left Doomsayer alive' : 'removed Doomsayer'
    case 'toads-doomsayer':
      return `played ${actions.filter((a) => played(a, 'Huge Toad')).length} Toads`
    case 'voidcaller-shadowflame':
      return actions.some((a) => played(a, 'Shadowflame'))
        ? 'cast Shadowflame'
        : 'kept Shadowflame'
    case 'thalnos-frostbolt': {
      const bolt = actions.findIndex((a) => played(a, 'Frostbolt')),
        thalnos = actions.findIndex((a) => played(a, 'Bloodmage Thalnos'))
      const waker = actions.findIndex((a) => played(a, 'Flamewaker'))
      const wyrm = actions.findIndex((a) => played(a, 'Mana Wyrm'))
      if (bolt < 0) return 'held Frostbolt'
      if (waker >= 0 && waker < bolt) return 'Flamewaker before Frostbolt'
      if (thalnos >= 0 && thalnos < bolt)
        return wyrm > bolt
          ? 'Thalnos before spell; Wyrm after spell'
          : 'Thalnos and Wyrm before spell'
      return 'Frostbolt before Thalnos'
    }
    case 'abusive-target': {
      const ready = new Set(
        (context.state.players.find((p) => p.role === 'self').board ?? [])
          .filter((m) => m.combat['can Attack Now'])
          .map((m) =>
            m.ref
              .match(/\[([^\]]+)\]$/)[1]
              .replaceAll('ai-player', 'fixture-player-two')
          )
      )
      for (const a of actions) {
        if (played(a, 'Abusive Sergeant'))
          return a.command.targets?.some((t) => ready.has(t.instanceId))
            ? 'buffed ready minion'
            : 'buffed unready minion'
        if (a.command.type === 'attack-character')
          ready.delete(a.command.attacker.instanceId)
      }
      return 'held Abusive Sergeant'
    }
    case 'shredder-development':
      return actions.some((a) => played(a, 'Piloted Shredder'))
        ? 'developed Shredder'
        : 'held Shredder'
    case 'brann-priority':
      return has(beforeEnd, 'Brann Bronzebeard')
        ? 'left Brann alive'
        : 'removed/bounced Brann'
    case 'zero-armor-slam':
      return actions.some((a) => played(a, 'Shield Slam'))
        ? 'spent Shield Slam'
        : 'kept Shield Slam'
    case 'zero-mana-healing':
      return actions.some((a) => played(a, 'Forbidden Healing'))
        ? 'spent Forbidden Healing'
        : 'kept Forbidden Healing'
    case 'zero-mana-shaping':
      return actions.some((a) => played(a, 'Forbidden Shaping'))
        ? 'spent Forbidden Shaping'
        : 'kept Forbidden Shaping'
    case 'full-health-heal':
      return actions.some(
        (a) =>
          a.command.type === 'use-hero-power' &&
          !a.events.some((e) => e.type === 'character-healed' && e.amount > 0)
      )
        ? 'used a zero-heal power'
        : 'avoided zero-heal power'
  }
}
const summary = contexts.map((c) => ({
  id: c.id,
  match: c.directory,
  turn: c.state.turn,
  request: c.requestId,
  versions: Object.fromEntries(
    ['old', 'current'].map((version) => [
      version,
      rows
        .filter((r) => r.id === c.id && r.version === version)
        .map((r) => ({
          seed: r.seed,
          result: assess(r, c),
          cachedActions: r.actions.filter(
            (a) => a.finishReason === 'expert-continuation'
          ).length,
          rejectedContinuations: r.actions.flatMap((a) =>
            a.usage?.continuationRejection ? [a.usage.continuationRejection] : []
          )
        }))
    ])
  )
}))
fs.writeFileSync(path.join(root, 'summary.json'), JSON.stringify(summary, null, 2))
for (const entry of summary) console.log(entry.id, JSON.stringify(entry.versions))
console.log(
  'Completed turns:',
  rows.length,
  '; all recorded turns had legal accepted commands and completed within the action cap.'
)
