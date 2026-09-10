import { CARD_CATALOG, HERO_POWER_CATALOG } from '../../game/content'
import type { JsonObject, JsonValue } from '../../shared/ipc/ai'
import type { MatchLogRecord } from '../../shared/ipc/match-logs'

type Data = Record<string, JsonValue>
const object = (value: unknown): JsonObject =>
  value && typeof value === 'object' ? (value as JsonObject) : {}
const list = (value: unknown): JsonObject[] =>
  Array.isArray(value) ? value.map(object) : []
const text = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/[\r\n\t]+/g, ' ').trim() : ''
const card = (id: unknown): string =>
  CARD_CATALOG.get(String(id))?.name ??
  HERO_POWER_CATALOG.get(String(id))?.displayName ??
  'a card'
const key = (command: JsonObject): string =>
  JSON.stringify(command, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value
  )

/** Discard large AI inputs before they enter the disk queue. Gameplay still feeds TXT. */
export function compactAiRecord(record: MatchLogRecord): MatchLogRecord | undefined {
  if (record.stream !== 'decisions') return record
  const data = record.data
  switch (record.kind) {
    case 'potion-offers':
      return {
        ...record,
        data: {
          options: data.options ?? [],
          origin: data.origin ?? 'card',
          stage: data.stage ?? '',
          cost: data.cost ?? null
        }
      }
    case 'provider-request':
      return {
        ...record,
        data: {
          model: data.model ?? object(data.config).modelId ?? '',
          planning: data.planning ?? Boolean(object(data.request).deck)
        }
      }
    case 'provider-response':
      return {
        ...record,
        data: {
          model: data.model ?? data.modelId ?? '',
          strategy: data.strategy ?? object(object(data.response).plan).strategy ?? ''
        }
      }
    case 'deck-plan-active':
      return {
        ...record,
        data: { strategy: data.strategy ?? object(data.plan).strategy ?? '' }
      }
    case 'selection':
      return {
        ...record,
        data: {
          source: data.source ?? 'unknown',
          reasonCode: data.reasonCode ?? 'unknown',
          phase: data.phase ?? 'turn',
          policyId: data.policyId ?? '',
          candidateCount: data.candidateCount ?? 0,
          hasCompleteOutcome: data.hasCompleteOutcome ?? false,
          lethalCandidateCount: data.lethalCandidateCount ?? 0,
          observation: data.observation ?? null,
          candidates: data.candidates ?? [],
          actions: data.actions ?? [],
          commands: data.commands ?? [],
          explanation: data.explanation ?? data.rationale ?? data.reason ?? '',
          evidence: data.evidence ?? null,
          riskFlags: data.riskFlags ?? [],
          guaranteedLethal: data.guaranteedLethal ?? false,
          rejectable: data.rejectable ?? false
        }
      }
    case 'boundary-effects':
      return {
        ...record,
        data: {
          participantId: data.participantId ?? '',
          sourceParticipantId: data.sourceParticipantId ?? null,
          commandType: data.commandType ?? 'unknown',
          beforeTurnNumber: data.beforeTurnNumber ?? 0,
          afterTurnNumber: data.afterTurnNumber ?? 0,
          eventTypes: data.eventTypes ?? [],
          cardsDrawn: data.cardsDrawn ?? 0,
          cardsBurned: data.cardsBurned ?? 0,
          fatigueDamage: data.fatigueDamage ?? 0,
          drawnCardIds: data.drawnCardIds ?? [],
          burnedCardIds: data.burnedCardIds ?? []
        }
      }
    case 'lethal-search':
      return {
        ...record,
        data: {
          expandedNodes: data.expandedNodes ?? 0,
          elapsedMs: data.elapsedMs ?? 0,
          exhausted: data.exhausted ?? false,
          found: data.found ?? false
        }
      }
    case 'decision-timing':
    case 'continuation-timing':
      return {
        ...record,
        data: {
          phase: data.phase ?? 'turn',
          elapsedMs: data.elapsedMs ?? 0
        }
      }
    case 'provider-failure':
    case 'warning':
    case 'error': {
      const detail = list(data.details)
        .map((entry) => text(entry.error) || text(entry.message))
        .find(Boolean)
      return {
        ...record,
        data: {
          error: text(data.error) || detail || text(data.message) || 'Decision failed.'
        }
      }
    }
    default:
      return undefined
  }
}

interface Decision {
  output: Data
  planned: Array<{ key: string; play: Data }>
}

/** Only small decision summaries and command correlation keys survive a flush. */
export class CompactAiLog {
  private readonly decisions = new Map<string, Decision>()
  private readonly planning = new Set<string>()
  private closed = false

  constructor(private readonly document: Data) {}

  private decision(record: MatchLogRecord): Decision {
    const turn = Number(record.data.beforeTurnNumber ?? record.turnNumber ?? 0)
    const id = record.decisionId || `unattributed-${turn}`
    let decision = this.decisions.get(id)
    if (!decision) {
      decision = {
        output: {
          turn,
          decision: this.decisions.size + 1,
          source: 'unknown',
          plays: []
        },
        planned: []
      }
      this.decisions.set(id, decision)
      ;(this.document.decisions as JsonValue[]).push(decision.output)
    }
    if (decision.output.turn === 0 && turn > 0) decision.output.turn = turn
    return decision
  }

  private action(command: JsonObject, data: JsonObject): string {
    const entities = [...list(data.entities), ...list(data.cards)]
    const participants = list(this.document.participants)
    const label = (id: unknown): string =>
      text(participants.find((player) => player.participantId === id)?.label) ||
      'Remote Player'
    const name = (ref: JsonObject, owner?: JsonValue): string => {
      if (ref.kind === 'hero') return `${label(ref.participantId ?? owner)}'s hero`
      const entity = entities.find((entity) => entity.id === ref.instanceId)
      const details =
        ref.kind === 'minion'
          ? ` [slot ${typeof entity?.position === 'number' ? entity.position : '?'}, ${typeof entity?.attack === 'number' && typeof entity?.health === 'number' ? `${entity.attack}/${entity.health}` : '?'}, id ${text(entity?.id) || text(ref.instanceId)}]`
          : ''
      return `${label(entity?.participantId ?? ref.participantId ?? owner)}'s ${card(entity?.cardId ?? ref.cardId)}${details}`
    }
    const targets = Array.isArray(command.targets)
      ? list(command.targets)
      : command.target
        ? [object(command.target)]
        : []
    const target = targets.length
      ? ` targeting ${targets.map((ref) => name(ref)).join(' and ')}`
      : ''
    switch (command.type) {
      case 'play-card':
        return `Play ${card(object(data.source).cardId)}${target}`
      case 'end-turn':
        return 'End turn'
      case 'timeout':
        return 'End turn after timeout'
      case 'confirm-mulligan': {
        const returned = list(data.events).find(
          (event) => event.type === 'mulligan-resolved'
        )
        const cards = list(returned?.returnedCards)
        return cards.length
          ? `Replace ${cards.map((entry) => card(entry.cardId)).join(', ')}`
          : Array.isArray(command.replaceInstanceIds) &&
              command.replaceInstanceIds.length
            ? 'Replace opening cards'
            : 'Keep the opening hand'
      }
      case 'use-hero-power':
        return `Use ${card(list(data.events).find((event) => event.type === 'hero-power-used')?.heroPowerId).replace(/^a card$/, 'hero power')}${target}`
      case 'choose-discover-card':
        return `Choose ${card(data.choiceCardId)}`
      case 'choose-card-option':
        return `Choose ${text(data.choiceLabel) || 'a card option'}`
      case 'attack-character':
        return `Attack ${name(object(command.defender), participants.find((player) => player.participantId !== data.actor)?.participantId)} with ${name(object(command.attacker), data.actor)}`
      default:
        return 'Perform a game action'
    }
  }

  accept(record: MatchLogRecord): void {
    const data = record.data
    if (record.kind === 'boundary-effects') {
      const effects = (this.document.boundaryEffects as JsonValue[] | undefined) ?? []
      effects.push(data)
      this.document.boundaryEffects = effects
      return
    }
    if (record.kind === 'potion-offers') {
      this.decision(record).output.potionCrafting = data
      return
    }
    if (record.kind === 'provider-request') {
      if (data.model && !this.document.model) this.document.model = data.model
      if (data.planning && record.decisionId) this.planning.add(record.decisionId)
      return
    }
    if (record.kind === 'provider-response' || record.kind === 'deck-plan-active') {
      if (data.model && !this.document.model) this.document.model = data.model
      if (data.strategy) this.document.strategy = data.strategy
      return
    }
    if (record.kind === 'lethal-search') {
      this.decision(record).output.lethalSearch = data
      return
    }
    if (record.kind === 'decision-timing' || record.kind === 'continuation-timing') {
      this.decision(record).output.timing = data
      return
    }
    if (record.kind === 'selection') {
      const decision = this.decision(record)
      for (const previous of this.decisions.values()) {
        if (previous === decision) continue
        for (const { play } of previous.planned)
          if (play.result === 'pending') play.result = 'not executed'
      }
      decision.output.source = data.source ?? 'unknown'
      decision.output.reasonCode = data.reasonCode ?? 'unknown'
      decision.output.phase = data.phase ?? 'turn'
      decision.output.policyId = data.policyId ?? ''
      decision.output.candidateCount = data.candidateCount ?? 0
      decision.output.hasCompleteOutcome = data.hasCompleteOutcome ?? false
      decision.output.lethalCandidateCount = data.lethalCandidateCount ?? 0
      if (data.observation) decision.output.observation = data.observation
      if (data.candidates) decision.output.candidates = data.candidates
      if (data.explanation) decision.output.explanation = data.explanation
      if (data.evidence) decision.output.evidence = data.evidence
      if (data.riskFlags) decision.output.riskFlags = data.riskFlags
      if (data.guaranteedLethal !== undefined)
        decision.output.guaranteedLethal = data.guaranteedLethal
      if (data.rejectable !== undefined) decision.output.rejectable = data.rejectable
      const commands = list(data.commands)
      const actions = Array.isArray(data.actions) ? data.actions : []
      const count = Math.max(commands.length, actions.length)
      for (let index = 0; index < count; index++) {
        const play: Data = {
          action: text(actions[index]) || this.action(commands[index] ?? {}, {}),
          result: this.closed ? 'not executed' : 'pending'
        }
        ;(decision.output.plays as JsonValue[]).push(play)
        decision.planned.push({
          key: commands[index] ? key(commands[index]) : '',
          play
        })
      }
      return
    }
    if (record.kind === 'command') {
      const decision = this.decision(record)
      const command = object(data.command)
      const planned = decision.planned.find(
        (entry) =>
          entry.key === key(command) &&
          ['pending', 'not executed'].includes(String(entry.play.result))
      )
      const play = planned?.play ?? {
        action: this.action(command, data),
        result: 'pending'
      }
      play.action = this.action(command, data)
      play.result = data.accepted === false ? 'rejected' : 'executed'
      play.effects = {
        eventTypes: list(data.events).map((event) => text(event.type) || 'unknown'),
        changes: data.changes ?? [],
        players: data.players ?? []
      }
      if (data.accepted === false)
        play.error =
          text(data.message) || text(data.code) || 'Rejected by the game rules.'
      if (!planned) (decision.output.plays as JsonValue[]).push(play)
      return
    }
    if (['provider-failure', 'warning', 'error'].includes(record.kind)) {
      const message = text(data.error)
      if (!record.decisionId || this.planning.has(record.decisionId)) {
        const errors = (this.document.errors as string[] | undefined) ?? []
        if (!errors.includes(message)) errors.push(message)
        this.document.errors = errors
      } else {
        const decision = this.decision(record)
        // A provider failure is more specific than the later generic fallback warning.
        if (!decision.output.error || record.kind === 'provider-failure')
          decision.output.error = message
      }
    }
  }

  finish(incomplete = false): void {
    this.closed = true
    for (const decision of this.decisions.values()) {
      for (const { play } of decision.planned)
        if (play.result === 'pending')
          play.result = incomplete ? 'unknown' : 'not executed'
    }
  }
}
