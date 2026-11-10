import { CARD_CATALOG } from '../../../game-rules/content/cards/card-catalog'
import { HERO_CATALOG } from '../../../game-rules/content/heroes/hero-catalog'
import type { JsonObject } from '../../contracts/ipc/ai'
import type { MatchLogRecord } from '../../contracts/ipc/match-logs'

type Data = Record<string, unknown>
const object = (value: unknown): Data =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Data) : {}
const rows = (value: unknown): Data[] => (Array.isArray(value) ? value.map(object) : [])
const values = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
const text = (value: unknown, fallback = 'not recorded'): string =>
  typeof value === 'string' && value ? value.replace(/[\r\n]+/g, ' ') : fallback
const escape = (value: string): string => value.replace(/([\\`*_[\]<>])/g, '\\$1')
const score = (value: unknown): string => {
  const n = number(value)
  return n === undefined ? 'not recorded' : `${n >= 0 ? '+' : ''}${n.toFixed(6)}`
}
const cardName = (id: unknown): string => {
  const key = String(id ?? '')
  return CARD_CATALOG.get(key)?.name ?? HERO_CATALOG.get(key)?.displayName ?? key
}

interface Context {
  id: string
  revision?: number
  turn: number
  actor: string
  phase: string
  state: Data
  actions: Data[]
  names: ReadonlyMap<string, { name: string; owner: string }>
}
interface Entry {
  context: Context
  kind: 'search' | 'mulligan' | 'no-search'
  summary: Data
  usage: Data
  response: Data
  selected?: string
  actual: string[]
  notes: string[]
}

/** A whitelisted, readable projection of observed requests and outcomes, not reasoning. */
export class AiDecisionTranscript {
  private readonly participants = new Map<string, { label: string; heroId: string }>()
  private readonly names = new Map<string, { name: string; owner: string }>()
  private renderingNames?: Context['names']
  private readonly contexts = new Map<string, Context>()
  private readonly entries: Entry[] = []
  private readonly searches = new Map<string, Entry>()
  private readonly requests = new Map<string, Entry>()
  private readonly models = new Set<string>()
  private readonly commands = new Map<number, Data>()
  private seed: unknown
  private settings: Data = {}
  private policy?: string
  private firstPlayer?: string

  constructor(
    private readonly metadata: JsonObject,
    private readonly startedAt: string
  ) {
    this.seed = metadata.seed
    this.policy = text(object(metadata.aiEngine).policyRevision, '') || undefined
  }

  private owner(ref: unknown): string {
    const key = text(ref, '')
    return (
      [...this.participants.keys()].find(
        (id) => key === id || key.startsWith(`${id}:`)
      ) ?? ''
    )
  }

  private label(id: string): string {
    return this.participants.get(id)?.label ?? (id ? 'AI' : 'Player not recorded')
  }

  private learn(value: unknown): void {
    if (Array.isArray(value)) return value.forEach((item) => this.learn(item))
    if (!value || typeof value !== 'object') return
    const row = object(value)
    const ref = row.ref ?? row.instanceId ?? row.id
    const name = row.name ?? (row.cardId ? cardName(row.cardId) : undefined)
    if (typeof ref === 'string' && typeof name === 'string')
      this.names.set(ref, { name, owner: this.owner(ref) })
    Object.values(row).forEach((item) => this.learn(item))
  }

  private name(ref: unknown, owned = false): string {
    const key = text(ref, '')
    const owner = this.owner(key)
    const names = this.renderingNames ?? this.names
    const known = names.get(key)
    if (key.endsWith(':hero')) return `${this.label(owner)}'s hero`
    if (!known) return escape(key || 'unrecorded target')
    const copies = [...names].filter(
      ([, other]) => other.name === known.name && other.owner === known.owner
    )
    const copy =
      copies.length > 1 ? ` #${copies.findIndex(([id]) => id === key) + 1}` : ''
    return `${owned && owner ? `${this.label(owner)}'s ` : ''}${escape(known.name)}${copy}`
  }

  private intent(intent: Data): string {
    const targets = values(intent.targets).map((ref) => this.name(ref, true))
    const targeting = targets.length ? ` → ${targets.join(', ')}` : ''
    const position = number(intent.position)
    switch (intent.type) {
      case 'play-card':
        return `Play ${this.name(intent.source)}${position === undefined ? '' : ` in position ${position + 1}`}${targeting}${intent.option == null ? '' : `; choice ${escape(String(intent.option))}`}`
      case 'attack-character':
        return `${this.name(intent.source, true)} attacks ${targets.join(', ') || 'unrecorded target'}`
      case 'use-hero-power':
        return `Use ${this.name(intent.source)}${targeting}`
      case 'end-turn':
        return 'End turn'
      case 'choose-discover-card':
        return `Discover ${this.name(intent.source)}`
      case 'choose-card-option':
        return `Choose ${escape(text(intent.option))} for ${this.name(intent.source)}${targeting}`
      case 'activate-board-object':
        return `Activate ${this.name(intent.source)}${targeting}`
      default:
        return `${text(intent.type, 'Action not recorded')}${intent.source ? `: ${this.name(intent.source)}` : ''}${targeting}${intent.option ? `; option ${escape(String(intent.option))}` : ''}`
    }
  }

  private command(command: Data, context: Context): string {
    const action = context.actions.find(
      (row) => JSON.stringify(row.command) === JSON.stringify(command)
    )
    if (action?.intent) return this.intent(object(action.intent))
    const actor = text(command.participantId, context.actor)
    const opponent = [...this.participants.keys()].find((id) => id !== actor) ?? ''
    const ref = (value: unknown, fallbackOwner = opponent): unknown => {
      const target = object(value)
      return (
        target.instanceId ??
        (target.kind === 'hero'
          ? `${text(target.participantId, fallbackOwner)}:hero`
          : undefined)
      )
    }
    if (command.type === 'confirm-mulligan') {
      const replace = values(
        command.replaceInstanceIds ?? command.cardInstanceIds ?? command.replace
      )
      return replace.length
        ? `Replace ${replace.map((id) => this.name(id)).join(', ')}`
        : 'Keep the opening hand'
    }
    return this.intent({
      type: command.type,
      source:
        command.sourceCardInstanceId ??
        command.boardObjectInstanceId ??
        command.cardInstanceId ??
        ref(command.attacker, actor) ??
        (command.type === 'use-hero-power' ? `${actor}:hero-power` : undefined),
      targets: command.defender
        ? [ref(command.defender)]
        : command.target
          ? [ref(command.target)]
          : command.type === 'activate-board-object'
            ? [command.cardInstanceId]
            : values(command.targets).map((target) => ref(target)),
      position: command.position,
      option: command.choice ?? command.optionId ?? command.choiceId
    })
  }

  private context(record: MatchLogRecord): Context {
    const id = record.decisionId ?? text(record.data.requestId, '')
    return (
      this.contexts.get(id) ?? {
        id,
        revision: number(record.data.expectedRevision) ?? record.revision,
        turn: number(record.data.turn) ?? record.turnNumber ?? 0,
        actor: this.owner(object(record.data.command).participantId),
        phase: text(record.data.phase, 'action'),
        state: {},
        actions: [],
        names: new Map(this.names)
      }
    )
  }

  private entry(context: Context, kind: Entry['kind']): Entry {
    const entry: Entry = {
      context,
      kind,
      summary: {},
      usage: {},
      response: {},
      actual: [],
      notes: []
    }
    this.entries.push(entry)
    this.requests.set(context.id, entry)
    return entry
  }

  private outcomes(events: unknown): string[] {
    const result: string[] = []
    for (const event of rows(events)) {
      const data = object(event.data)
      if (event.type === 'effect-resolved' && event.action === 'damage') {
        if (data.shieldConsumed === true)
          result.push(`${this.name(data.target, true)} lost Divine Shield`)
        else if (number(data.actualDamage) !== undefined)
          result.push(
            `${this.name(data.target, true)} took ${data.actualDamage} damage${number(data.healthAfter) === undefined ? '' : ` (${data.healthAfter} health left)`}`
          )
      }
      if (event.type === 'death-batch-started')
        for (const death of rows(event.deaths))
          if (death.instanceId) result.push(`${this.name(death.instanceId, true)} died`)
      if (event.type === 'match-ended')
        result.push(
          event.winnerId
            ? `${this.label(String(event.winnerId))} won`
            : 'match ended in a draw'
        )
    }
    return [...new Set(result)]
  }

  accept(record: MatchLogRecord): void {
    const d = record.data
    if (record.kind === 'match-start') {
      for (const participant of rows(d.participants))
        this.participants.set(String(participant.participantId), {
          label: participant.label === 'Local Player' ? 'LP' : 'RP',
          heroId: String(participant.heroId)
        })
      this.seed = d.seed ?? this.seed
      this.firstPlayer = text(d.firstPlayerId, '')
      return
    }
    if (record.stream === 'events' && record.kind === 'command') {
      this.learn(d.entities)
      const input = object(d.command)
      const source = object(d.source)
      if (input.cardInstanceId && source.cardId)
        this.names.set(String(input.cardInstanceId), {
          name: cardName(source.cardId),
          owner: this.owner(input.cardInstanceId)
        })
      const revision = number(d.beforeRevision)
      if (revision !== undefined) this.commands.set(revision, d)
      return
    }
    if (record.stream !== 'decisions') return
    const id = record.decisionId ?? text(d.requestId, '')
    if (record.kind === 'request-started') {
      const messages = rows(object(d.request).messages)
      let state: Data = {}
      for (const message of [...messages].reverse()) {
        try {
          const facts = object(JSON.parse(String(message.content)))
          if (Object.keys(object(facts.state)).length) {
            state = object(facts.state)
            break
          }
        } catch {
          /* Historical text-only requests may not include structured state. */
        }
      }
      const previous = this.contexts.get(id)
      if (!Object.keys(state).length) state = previous?.state ?? {}
      this.learn(state)
      const self = rows(state.players).find((player) => player.role === 'self')
      const actor =
        this.owner(object(self?.hero).instanceId) ||
        this.owner(rows(object(state.self).hand)[0]?.ref) ||
        previous?.actor ||
        ''
      this.contexts.set(id, {
        id,
        actor,
        state,
        revision: number(d.expectedRevision) ?? record.revision,
        turn: number(state.turn) ?? record.turnNumber ?? 0,
        phase: text(d.phase, 'action'),
        actions: rows(d.actions).length ? rows(d.actions) : (previous?.actions ?? []),
        names: new Map(this.names)
      })
      for (const player of rows(state.players)) {
        const power = object(player.heroPower)
        if (power.ref && power.name)
          this.names.set(String(power.ref), {
            name: String(power.name),
            owner: this.owner(power.ref)
          })
      }
      return
    }
    const context = this.context(record)
    if (
      record.kind === 'turn-plan' ||
      record.kind === 'response-received' ||
      Object.keys(object(object(d.usage).searchSummary)).length > 0
    ) {
      if (typeof d.modelId === 'string') this.models.add(d.modelId)
      const usage = object(d.usage)
      const summary = object(usage.searchSummary)
      const mode = text(usage.mode ?? d.finishReason, '')
      const continuation = mode.includes('continuation') && !Object.keys(summary).length
      let entry: Entry | undefined
      if (continuation) {
        entry = [...this.entries]
          .reverse()
          .find(
            (item) =>
              item.context.turn === context.turn && item.context.actor === context.actor
          )
        entry ??= this.entry(context, 'no-search')
        this.requests.set(id, entry)
      } else {
        const key = `${id}|${context.revision ?? ''}|${text(summary.searchId, String(summary.seed ?? ''))}`
        entry = this.searches.get(key)
        if (!entry) {
          entry = this.entry(
            context,
            context.phase === 'mulligan' || 'replace' in object(d.choice)
              ? 'mulligan'
              : 'search'
          )
          this.searches.set(key, entry)
        }
        entry.summary = summary
        const durationMs = Math.max(
          number(entry.response.durationMs) ?? 0,
          number(d.durationMs) ?? 0
        )
        entry.response = {
          ...d,
          ...(number(d.durationMs) !== undefined ? { durationMs } : {})
        }
        entry.usage = usage
        entry.selected =
          text(
            object(d.choice).actionId ??
              object(object(d.choice).plan).firstActionId ??
              summary.selectedActionId,
            ''
          ) || undefined
        if (Object.keys(object(summary.settings)).length)
          this.settings = object(summary.settings)
        this.policy = text(usage.policyRevision, this.policy ?? '') || undefined
      }
      this.requests.set(id, entry)
      if (record.kind === 'end-turn-review')
        entry.notes.push(
          'End turn was selected but not executed; another review was requested'
        )
      else if (!['turn-plan', 'response-received'].includes(record.kind))
        entry.notes.push(
          `${record.kind.replaceAll('-', ' ')}: ${escape(text(d.reason))}`
        )
      return
    }
    if (record.kind === 'action-executed') {
      const revision = number(d.expectedRevision)
      const captured = revision === undefined ? undefined : this.commands.get(revision)
      const actor = text(object(d.command).participantId, context.actor)
      const turn = number(captured?.beforeTurnNumber) ?? context.turn
      let entry = this.requests.get(id)
      if (!entry)
        entry = [...this.entries]
          .reverse()
          .find((item) => item.context.turn === turn && item.context.actor === actor)
      entry ??= this.entry({ ...context, turn, actor }, 'no-search')
      if (!entry.context.actor) entry.context = { ...entry.context, actor, turn }
      const source = text(d.source, 'not recorded')
      const reused = !entry.context.id || entry.context.id !== id
      let suffix =
        d.accepted === true
          ? 'accepted'
          : d.accepted === false
            ? `rejected: ${text(d.message ?? d.reason ?? d.code)}`
            : 'acceptance not recorded'
      if (source === 'forced') suffix += '; only legal move, no search'
      else if (source.includes('fallback') || source.includes('timeout'))
        suffix += `; ${source.replaceAll('-', ' ')}`
      else if (reused && source === 'model') suffix += '; reused plan, no fresh search'
      const players = rows(captured?.players)
      const player = players.find((row) => row.participantId === actor)
      if (
        player &&
        number(player.manaBefore) !== undefined &&
        number(player.manaAfter) !== undefined &&
        object(d.command).type !== 'end-turn'
      )
        suffix += `; mana ${player.manaBefore} → ${player.manaAfter}`
      entry.actual.push(`${this.command(object(d.command), context)} (${suffix}).`)
      if (d.accepted === true) {
        const outcomes = this.outcomes(d.rawEvents)
        if (outcomes.length) entry.actual.push(`Result: ${outcomes.join('; ')}.`)
      }
      return
    }
    if (
      [
        'failure',
        'cancelled',
        'response-rejected',
        'timeout-fallback',
        'worker-fallback',
        'timeout-retry',
        'end-turn-review',
        'request-superseded'
      ].includes(record.kind)
    ) {
      const entry = this.requests.get(id) ?? this.entry(context, 'no-search')
      const reason = text(d.reason ?? d.message, '')
      entry.notes.push(
        `${record.kind.replaceAll('-', ' ')}${reason ? `: ${escape(reason)}` : ''}`
      )
    }
  }

  private position(context: Context): string[] {
    const players = rows(context.state.players)
    if (!players.length) return ['Position: not recorded.']
    const lines: string[] = []
    for (const player of players) {
      const owner = this.owner(object(player.hero).instanceId)
      const role = owner ? this.label(owner) : text(player.role, 'Player')
      const hero = object(player.hero)
      const mana = object(player.mana)
      lines.push(
        `- ${role}: ${hero.health ?? '?'} health, ${hero.armor ?? '?'} armor; mana ${mana.available ?? '?'}/${mana.maximum ?? '?'}${number(mana.temporary) ? ` (${mana.temporary} temporary)` : ''}.`
      )
      const board = rows(player.board).map((minion) => {
        const status = object(minion.currentStatus)
        const combat = object(minion.combat)
        const keywords = values(minion.activeKeywords)
          .filter((keyword) => keyword !== 'divine-shield' && keyword !== 'stealth')
          .map(String)
        if (status.shieldActive === true) keywords.push('Divine Shield')
        if (status.stealthActive === true) keywords.push('Stealth')
        if (status.isSilenced === true) keywords.push('Silenced')
        const restrictions = values(combat.restrictions).map(String)
        const readiness =
          player.role === 'self'
            ? combat.canAttackNow === true
              ? 'ready to attack'
              : `cannot attack${restrictions.length ? `: ${restrictions.join(', ')}` : ''}`
            : ''
        return `${this.name(minion.ref)} ${minion.attack ?? '?'}/${minion.health ?? '?'}${number(minion.position) === undefined ? '' : ` [position ${Number(minion.position) + 1}]`}${[...keywords, readiness].filter(Boolean).length ? ` (${[...keywords, readiness].filter(Boolean).join(', ')})` : ''}`
      })
      lines.push(`- ${role} board: ${board.join('; ') || 'empty'}.`)
      if (player.role === 'self') {
        const hand = rows(player.hand).map(
          (item) =>
            `${this.name(item.ref)} (${item.cost ?? '?'} mana${number(item.attack) !== undefined ? (number(item.health) !== undefined ? `; ${item.attack}/${item.health}` : `; ${item.attack} attack${number(item.durability) !== undefined ? `, ${item.durability} durability` : ''}`) : ''})`
        )
        lines.push(`- ${role} hand: ${hand.join('; ') || 'empty'}.`)
        const power = object(player.heroPower)
        if (power.name)
          lines.push(
            `- Hero power: ${escape(String(power.name))}, ${power.cost ?? '?'} mana; ${context.actions.length ? (context.actions.some((action) => object(action.intent).type === 'use-hero-power') ? 'legal now' : 'no legal use now') : 'legality not recorded'}.`
          )
      } else
        lines.push(
          `- ${role} hand: ${player.handSize ?? '?'} cards; hidden cards are not shown.`
        )
    }
    return lines
  }

  private options(entry: Entry): string[] {
    const summary = entry.summary
    let options = rows(summary.options)
    const fresh = options.length > 0
    if (!fresh) {
      const consensus = rows(entry.usage.candidateConsensus)
      options = entry.context.actions.map((action) => ({
        ...action,
        actionId: action.id,
        ...consensus.find((row) => row.candidateId === action.id)
      }))
    }
    if (!options.length) return ['Evaluated options and scores were not recorded.']
    const legal = number(summary.legalActionCount) ?? entry.context.actions.length
    const evaluated = number(summary.evaluatedActionCount)
    const lines = [
      `**Options:** ${legal} legal first moves; ${evaluated === undefined ? 'evaluated count not recorded' : `${evaluated} evaluated`}.`
    ]
    const groups = new Map<string, Data[]>()
    for (const option of [...options].sort(
      (a, b) =>
        (number(b.expectedValue) ?? -Infinity) - (number(a.expectedValue) ?? -Infinity)
    )) {
      const intent = object(option.intent)
      const group =
        intent.type === 'play-card'
          ? `play:${entry.context.names.get(String(intent.source))?.name ?? intent.source}`
          : String(option.actionId)
      groups.set(group, [...(groups.get(group) ?? []), option])
    }
    for (const group of groups.values()) {
      const grouped = group.length > 1
      if (grouped)
        lines.push(
          `- **${escape(entry.context.names.get(String(object(group[0]!.intent).source))?.name ?? 'Card options')}**`
        )
      for (const option of group) {
        const prefix = grouped ? '  - ' : '- '
        const actionId = text(option.actionId ?? option.id, '')
        const chosen = entry.selected === actionId
        const move = Object.keys(object(option.intent)).length
          ? this.intent(object(option.intent))
          : escape(text(option.description, actionId || 'Unrecorded move'))
        lines.push(
          `${prefix}${chosen ? '**' : ''}${move}${chosen ? ' — selected**' : ''}: score ${score('consensusExpectedValue' in option ? option.consensusExpectedValue : option.expectedValue)}; ${number(option.visits) === undefined ? 'visits not recorded' : `${option.visits} visits`}${number(option.sampledWorlds) ? `; preferred in ${number(option.votes) ?? 0}/${option.sampledWorlds} searches` : ''}${option.evaluated === false ? '; not evaluated' : ''}${option.consensusIncluded === false ? '; outside the decision shortlist' : ''}.`
        )
        if (
          'consensusExpectedValue' in option &&
          option.consensusExpectedValue !== option.expectedValue
        )
          lines.push(
            `${grouped ? '    ' : '  '}All evaluated samples combined: ${score(option.expectedValue)}; differs from the actual decision shortlist.`
          )
        const worlds = rows(option.worlds)
        if (number(option.expectedValue) === undefined && worlds.length)
          lines.push(
            `${grouped ? '    ' : '  '}World scores: ${worlds.map((world) => `${Number(world.worldIndex) + 1}: ${score(world.finalRecommendationValue ?? world.recommendationValue)}`).join('; ')}.`
          )
        const paths = new Map<string, { sequence: Data; worlds: Data[] }>()
        for (const world of worlds) {
          const sequence = object(world.sequence)
          if (!rows(sequence.intents).length) continue
          const key = JSON.stringify({
            intents: sequence.intents,
            originalLength: sequence.originalLength,
            truncated: sequence.truncated,
            ending: sequence.ending,
            supportScope: sequence.supportScope
          })
          const previous = paths.get(key)
          paths.set(key, { sequence, worlds: [...(previous?.worlds ?? []), world] })
        }
        for (const { sequence, worlds: pathWorlds } of paths.values()) {
          const intents = rows(sequence.intents)
          if (intents.length < 2) continue
          const support = pathWorlds
            .map(
              (world) =>
                `search ${Number(world.worldIndex) + 1}: ${number(object(world.sequence).supportVisits) ?? 'not recorded'}`
            )
            .join(', ')
          lines.push(
            `${grouped ? '    ' : '  '}→ ${intents
              .slice(1)
              .map((intent) => this.intent(intent))
              .join(
                ' → '
              )}. ${sequence.truncated === true ? 'Original full-line' : 'Exact-line'} support: ${support}${sequence.truncated === true ? `; displayed prefix truncated from ${sequence.originalLength} actions` : sequence.ending === 'partial' ? '; partial line' : ''}.`
          )
        }
      }
    }
    if (!fresh)
      lines.push(
        'Only retained ranking data is available; absent values do not mean an option was not evaluated.'
      )
    return lines
  }

  render(): string {
    try {
      return this.renderEntries()
    } finally {
      this.renderingNames = undefined
    }
  }

  private renderEntries(): string {
    const output = [
      '# AI decisions',
      '',
      `Started: ${escape(this.startedAt.replace('T', ' at ').replace('Z', ' UTC'))}`
    ]
    for (const [id, player] of [...this.participants].sort((a, b) =>
      a[1].label.localeCompare(b[1].label)
    )) {
      const hero = HERO_CATALOG.get(player.heroId)
      output.push(
        `${player.label === 'LP' ? 'Local' : 'Remote'} Player (${this.label(id)}): ${escape(cardName(player.heroId))} (${hero?.classId ?? 'unknown class'})`
      )
    }
    if (this.firstPlayer) output.push(`First player: ${this.label(this.firstPlayer)}`)
    output.push(
      `Difficulty: ${escape(text(this.metadata.aiDifficulty))}; match seed: ${number(this.seed) ?? 'not recorded'}.`
    )
    const configured =
      object(this.metadata.aiConfig).modelId ?? object(this.metadata.aiEngine).modelId
    output.push(`Configured model: ${escape(text(configured, 'not recorded'))}`)
    output.push(
      `Responding model: ${[...this.models].map(escape).join(', ') || 'none recorded'}`
    )
    if (this.policy) output.push(`AI policy: ${escape(this.policy)}`)
    const limits = { ...object(this.metadata.aiResources), ...this.settings }
    const budgetLabels: [string, string][] = [
      ['turnBudgetMs', 'turn'],
      ['searchBudgetMs', 'search'],
      ['decisionSearchBudgetMs', 'decision'],
      ['planSearchLimitMs', 'initial plan'],
      ['replanSearchLimitMs', 'replan']
    ]
    const budget = budgetLabels
      .filter(([key]) => number(limits[key]) !== undefined)
      .map(([key, name]) => `${name} ${Number(limits[key]) / 1000}s`)
    if (budget.length) output.push(`Search limits: ${budget.join('; ')}.`)
    if (typeof this.metadata.aiHeroPowerBonusEnabled === 'boolean')
      output.push(
        `AI hero-power bonus: ${this.metadata.aiHeroPowerBonusEnabled ? 'on' : 'off'}.`
      )
    output.push(
      '',
      'Scores rate first moves, not winning percentages. Safety checks can take priority over scores. Visits count first-move evaluations, not whole-line support. Arrows are recorded possible continuations, not actions already played. Copies and positions remain distinct; positions count from the left.',
      ''
    )
    let lastTurn = ''
    let searchNumber = 0
    for (const entry of this.entries) {
      const context = entry.context
      this.renderingNames = context.names
      const turn = `${context.turn}|${context.actor}`
      if (lastTurn !== turn) {
        output.push(
          `## ${context.turn ? `Turn ${context.turn}` : 'Opening'} · ${this.label(context.actor)}`,
          ''
        )
        lastTurn = turn
        searchNumber = 0
      }
      output.push(
        `### ${entry.kind === 'search' ? `Search ${++searchNumber}` : entry.kind === 'mulligan' ? 'Mulligan' : 'Actions without a fresh search'}`,
        ''
      )
      if (entry.kind === 'search') {
        output.push(...this.position(context), '', ...this.options(entry), '')
        if (rows(entry.usage.plannedActionIntents).length)
          output.push(
            `Selected plan (not execution): ${rows(entry.usage.plannedActionIntents)
              .map((intent) => this.intent(intent))
              .join(' → ')}.`,
            ''
          )
      }
      output.push('**Actually played**', '')
      output.push(
        ...(entry.actual.length
          ? entry.actual.map((line) => `- ${line}`)
          : ['- No execution recorded.']),
        ''
      )
      const details: string[] = []
      if (number(entry.summary.seed) !== undefined)
        details.push(`search seed ${entry.summary.seed}`)
      const duration =
        number(entry.summary.durationMs) ?? number(entry.response.durationMs)
      if (duration !== undefined)
        details.push(`duration ${(duration / 1000).toFixed(2)}s`)
      const worlds = rows(entry.summary.worlds)
      if (worlds.length)
        details.push(
          `searches: ${worlds.map((world) => `${Number(world.worldIndex) + 1} ${text(world.status)}${world.timedOut === true ? ' (time limit reached)' : ''}`).join(', ')}`
        )
      const omitted = worlds.reduce(
        (sum, world) => sum + (number(world.sequencesOmitted) ?? 0),
        0
      )
      if (omitted)
        details.push(
          `${omitted} per-search continuations not retained; their first moves remain listed`
        )
      const failedWorlds = rows(entry.summary.failedWorlds)
      if (failedWorlds.length)
        details.push(
          `failed searches: ${failedWorlds.map((world) => `${Number(world.worldIndex) + 1} ${text(world.status)}`).join(', ')}`
        )
      const provenance = object(entry.usage.decisionProvenance)
      const priority = provenance.priority ?? entry.usage.decisionPriority
      if (typeof priority === 'string' && priority !== 'strategy')
        details.push(`selection priority: ${escape(priority.replaceAll('-', ' '))}`)
      const describeAction = (id: unknown): string => {
        const option =
          rows(entry.summary.options).find((row) => row.actionId === id) ??
          context.actions.find((row) => row.id === id)
        return option ? this.intent(object(option.intent)) : text(id)
      }
      if (provenance.overridden === true)
        details.push(
          `selection changed from ${describeAction(provenance.workerActionId)} to ${describeAction(provenance.returnedActionId)}: ${escape(text(provenance.reason))}`
        )
      else if (provenance.overridden === false) details.push('no selection override')
      if (provenance.continuationChanged === true)
        details.push('controller changed the planned continuation')
      if (provenance.fallback === true)
        details.push(
          `fallback: ${escape(text(provenance.returnedFinishReason ?? entry.response.finishReason))}`
        )
      else if (provenance.fallback === false) details.push('no fallback')
      details.push(...entry.notes)
      if (details.length) output.push(`Details: ${details.join('; ')}.`, '')
    }
    if (!this.entries.length) output.push('No AI decisions recorded yet.', '')
    output.push(
      'Only recorded first moves and retained continuations are shown, not the full search tree or detailed opponent reply lines. Missing scores, support or executions are left explicit. Full gameplay effects are in match.txt.',
      ''
    )
    return output.join('\n')
  }
}
