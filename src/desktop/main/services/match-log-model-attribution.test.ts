import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { MatchLogRepository } from './match-log-repository'
import { MatchLogTranscript } from './match-log-transcript'
import { AiDecisionTranscript } from './ai-decision-transcript'
import {
  AI_LOG_SCHEMA_VERSION,
  type JsonObject,
  type JsonValue
} from '../../contracts/ipc/ai'
import type { MatchLogRecord } from '../../contracts/ipc/match-logs'

describe('match log model attribution', () => {
  it.each(['easy', 'expert'])(
    'records %s difficulty, engine revision and resolved resources',
    async (aiDifficulty) => {
      const root = await mkdtemp(join(tmpdir(), 'hsinspired-match-logs-'))
      try {
        const repository = new MatchLogRepository(root)
        await repository.initialize()
        const metadata = {
          aiDifficulty,
          aiResources: { turnBudgetMs: 60_000, planSearchLimitMs: 30_000 },
          aiEngine: { modelId: 'hardware-local-v2', policyRevision: 'test-policy' }
        }
        const matchId = await repository.start(7, metadata)
        await repository.finish(matchId, 'abandoned')
        const directoryName = (await readdir(root))[0]!
        const markdown = await readFile(
          join(root, directoryName, 'ai-decisions.md'),
          'utf8'
        )
        expect(markdown.toLowerCase()).toContain(aiDifficulty)
        expect(markdown).toContain('test-policy')
        expect(markdown).toContain('hardware-local-v2')
        expect(markdown).toContain('turn 60s')
        expect(markdown).toContain('initial plan 30s')
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  )

  it('records the responding model separately from the configured model', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hsinspired-match-logs-'))
    try {
      const repository = new MatchLogRepository(root)
      await repository.initialize()
      const matchId = await repository.start(7, {
        aiConfig: { modelId: 'gpt-5.4-nano' }
      })
      const directoryName = (await readdir(root))[0]!
      const markdownPath = join(root, directoryName, 'ai-decisions.md')
      const started = await readFile(markdownPath, 'utf8')
      expect(started).toContain('Configured model: gpt-5.4-nano')
      expect(started).toContain('Responding model: none recorded')
      expect(started).not.toContain('hardware-local-v2')

      await repository.append(matchId, {
        stream: 'decisions',
        kind: 'response-received',
        timestamp: new Date().toISOString(),
        data: { modelId: 'hardware-local-v2' }
      })
      await repository.finish(matchId, 'abandoned')

      const finished = await readFile(markdownPath, 'utf8')
      expect(finished).toContain('Responding model: hardware-local-v2')
      expect(finished).toContain('Configured model: gpt-5.4-nano')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not claim an AI model when no response was received', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hsinspired-match-logs-'))
    try {
      const repository = new MatchLogRepository(root)
      await repository.initialize()
      const matchId = await repository.start(7, {
        aiConfig: { modelId: 'gpt-5.4-nano' }
      })
      const directoryName = (await readdir(root))[0]!
      await repository.finish(matchId, 'abandoned')
      const markdown = await readFile(
        join(root, directoryName, 'ai-decisions.md'),
        'utf8'
      )
      expect(markdown).toContain('Configured model: gpt-5.4-nano')
      expect(markdown).toContain('Responding model: none recorded')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

// Gameplay presentation and the two-file persistence lifecycle stay covered together.
describe('readable match log', () => {
  it('writes exactly two readable files, even with the retired raw-transcript flag', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hsinspired-match-logs-'))
    vi.stubEnv('HSINSPIRED_AI_FULL_TRANSCRIPT', '1')
    try {
      const repository = new MatchLogRepository(root)
      await repository.initialize()
      const metadata = {
        curatedOpponent: {
          deckName: 'Test deck',
          classId: 'Mage',
          catalogVersion: 4,
          source: { title: 'Source title', url: 'https://example.com/deck' },
          strategy: { text: 'Verbose strategy text' }
        },
        generatedOpponent: {
          construction: [{ layer: 'curve', selected: 'card', reason: 'reason' }]
        }
      }
      const id = await repository.start(7, metadata)
      const appended = [
        repository.append(id, matchStart),
        repository.append(id, {
          stream: 'decisions',
          kind: 'response-received',
          timestamp: matchStart.timestamp,
          data: { modelId: 'hardware-local-v2' }
        })
      ]
      await repository.finish(id, 'abandoned')
      await Promise.all(appended)
      const directory = join(root, (await readdir(root))[0]!)
      expect((await readdir(directory)).sort()).toEqual([
        'ai-decisions.md',
        'match.txt'
      ])
      const text = await readFile(join(directory, 'match.txt'), 'utf8')
      expect(text).toMatch(/Started: \d{4}-\d{2}-\d{2} at \d{2}:\d{2}:\d{2}\.\d{3} UTC/)
      expect(text).toContain('Local Player (LP): Jaina Proudmoore (Mage)')
      expect(text).toContain('Remote Player (RP): Uther Lightbringer (Paladin)')
      expect(text).toContain('First player: RP')
      expect(text).toContain('Match abandoned before it ended.')
      for (const omitted of [
        'Catalog version',
        'Source title',
        'example.com',
        'Verbose strategy',
        'Opponent deck construction'
      ])
        expect(text).not.toContain(omitted)
      const markdown = await readFile(join(directory, 'ai-decisions.md'), 'utf8')
      expect(markdown).toContain('# AI decisions')
      expect(markdown).toContain('Status: abandoned\nRecording incomplete: no')
    } finally {
      vi.unstubAllEnvs()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('recovers interrupted Markdown without changing recorded searches or repeating warnings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hsinspired-match-logs-'))
    try {
      const repository = new MatchLogRepository(root)
      await repository.initialize()
      await repository.start(7, {})
      const directory = join(root, (await readdir(root))[0]!)
      const markdownPath = join(directory, 'ai-decisions.md')
      const original = await readFile(markdownPath, 'utf8')
      await writeFile(markdownPath + '.tmp', 'stale interrupted atomic write')
      await new MatchLogRepository(root).initialize()
      const recovered = await readFile(markdownPath, 'utf8')
      expect(recovered).toContain('Status: interrupted\nRecording incomplete: yes')
      expect(recovered).toContain(original.slice(original.indexOf('# AI decisions')))
      expect(recovered).toContain('The previous session ended unexpectedly.')
      expect(await readFile(join(directory, 'match.txt'), 'utf8')).toContain(
        'The previous session ended unexpectedly.'
      )
      expect((await readdir(directory)).sort()).toEqual([
        'ai-decisions.md',
        'match.txt'
      ])
      await new MatchLogRepository(root).initialize()
      expect(await readFile(markdownPath, 'utf8')).toBe(recovered)
      expect(
        (await readFile(join(directory, 'match.txt'), 'utf8')).match(
          /The previous session ended unexpectedly\./g
        )
      ).toHaveLength(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each([4, 5, 6, AI_LOG_SCHEMA_VERSION])(
    'preserves legacy schema %s folders and their interruption recovery',
    async (schemaVersion) => {
      const root = await mkdtemp(join(tmpdir(), 'hsinspired-match-logs-'))
      try {
        const directory = join(
          root,
          '2026-11-10T14-50-31-678Z_00000000-0000-0000-0000-000000000000'
        )
        await mkdir(directory)
        await writeFile(join(directory, 'match.txt'), 'Historical match\n')
        await writeFile(
          join(directory, 'ai-conversation.txt'),
          'Historical conversation\n'
        )
        await writeFile(
          join(directory, 'ai.json'),
          JSON.stringify({
            schemaVersion,
            status: 'in-progress',
            decisions: [{ plays: [{ result: 'pending' }] }]
          })
        )
        await new MatchLogRepository(root).initialize()
        expect(
          JSON.parse(await readFile(join(directory, 'ai.json'), 'utf8'))
        ).toMatchObject({
          status: 'interrupted',
          recordingIncomplete: true,
          decisions: [{ plays: [{ result: 'unknown' }] }]
        })
        expect(await readFile(join(directory, 'ai-conversation.txt'), 'utf8')).toBe(
          'Historical conversation\n'
        )
        expect((await readdir(directory)).sort()).toEqual([
          'ai-conversation.txt',
          'ai.json',
          'match.txt'
        ])
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  )

  it('flushes before finish and preserves completion when late AI records arrive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hsinspired-match-logs-'))
    try {
      const repository = new MatchLogRepository(root)
      await repository.initialize()
      const id = await repository.start(7, {})
      const appended = [
        repository.append(id, matchStart),
        repository.append(
          id,
          command({
            matchEnded: true,
            events: [{ type: 'match-ended', winnerId: null }]
          })
        )
      ]
      const finish = repository.finish(id, 'abandoned')
      await finish
      await Promise.all(appended)
      await repository.append(id, {
        stream: 'decisions',
        kind: 'response-received',
        timestamp: matchStart.timestamp,
        data: { modelId: 'late-model' }
      })
      await repository.finish(id, 'interrupted')
      const directory = join(root, (await readdir(root))[0]!)
      const markdown = await readFile(join(directory, 'ai-decisions.md'), 'utf8')
      expect(markdown).toContain('Status: completed\nRecording incomplete: no')
      expect(markdown).toContain('Responding model: late-model')
      const text = await readFile(join(directory, 'match.txt'), 'utf8')
      expect(text).toContain('The match ends in a draw.')
      expect(text).not.toContain('Match abandoned')
      await new MatchLogRepository(root).initialize()
      expect(await readFile(join(directory, 'ai-decisions.md'), 'utf8')).toBe(markdown)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('surfaces append failures and persists the incomplete warning when writes recover', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hsinspired-match-logs-'))
    try {
      const repository = new MatchLogRepository(root)
      await repository.initialize()
      const id = await repository.start(7, {})
      const directory = join(root, (await readdir(root))[0]!)
      const gameplayPath = join(directory, 'match.txt')
      await rm(gameplayPath)
      await mkdir(gameplayPath)
      await expect(repository.append(id, matchStart)).rejects.toThrow()
      expect(() => repository.assertHealthy(id)).toThrow('match log write failed')
      await expect(repository.append(id, matchStart)).rejects.toThrow(
        'match log write failed'
      )
      await rm(gameplayPath, { recursive: true })
      await writeFile(gameplayPath, 'Recovered write access\n')
      await repository.finish(id, 'abandoned')
      const markdown = await readFile(join(directory, 'ai-decisions.md'), 'utf8')
      expect(markdown).toContain('Recording incomplete: yes')
      expect(markdown).toContain('A match log write failed.')
      expect(await readFile(gameplayPath, 'utf8')).toContain(
        'Match recording is incomplete because logging failed.'
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('marks backlog overflow incomplete and still finishes the accepted records', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hsinspired-match-logs-'))
    try {
      const repository = new MatchLogRepository(root)
      await repository.initialize()
      const id = await repository.start(7, {})
      const pending = Array.from({ length: 256 }, () =>
        repository.append(id, { ...matchStart, kind: 'unhandled-record' })
      )
      await expect(repository.append(id, matchStart)).rejects.toThrow(
        'backlog exceeded'
      )
      await repository.finish(id, 'abandoned')
      await Promise.all(pending)
      const directory = join(root, (await readdir(root))[0]!)
      const markdown = await readFile(join(directory, 'ai-decisions.md'), 'utf8')
      expect(markdown).toContain('Recording incomplete: yes')
      expect(markdown).toContain('backlog exceeded its limit')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('assigns LP/RP by role, not first-player order, and retains both opening hands', () => {
    const transcript = new MatchLogTranscript()
    const text = transcript.format(matchStart)
    expect(text).toBe(
      'Local Player (LP): Jaina Proudmoore (Mage)\n' +
        'Remote Player (RP): Uther Lightbringer (Paladin)\n' +
        'First player: RP\n\nOpening hands\n\n' +
        '- LP: Fireball.\n- RP: Chillwind Yeti.\n'
    )
    expect(
      transcript.format(
        command({
          events: [
            {
              type: 'mulligan-resolved',
              participantId: 'local',
              returnedCards: [{ cardId: 'basic_fireball' }],
              replacementCards: [{ cardId: 'basic_chillwind_yeti' }]
            },
            {
              type: 'mulligan-resolved',
              participantId: 'remote',
              returnedCards: [],
              replacementCards: []
            },
            {
              type: 'coin-granted',
              participantId: 'local',
              card: { instanceId: 'local:coin', cardId: 'basic_the_coin' }
            }
          ]
        })
      )
    ).toContain(
      '- LP replaces Fireball.\n- LP receives Chillwind Yeti.\n- RP keeps all opening cards.\n- LP receives The Coin.'
    )
  })

  it('groups turns and shortens only the active player, without moving end-turn effects', () => {
    const transcript = startedTranscript('remote')
    const text = transcript.format(
      command({
        command: { type: 'end-turn' },
        actor: 'remote',
        players: [{ participantId: 'remote', manaBefore: 1 }],
        events: [
          {
            type: 'card-drawn',
            participantId: 'remote',
            card: { instanceId: 'remote:draw-1', cardId: 'basic_fireball' }
          },
          {
            type: 'turn-started',
            participantId: 'local',
            turnNumber: 2,
            mana: { available: 2, maximum: 3, overloadLocked: 1 }
          },
          {
            type: 'card-drawn',
            participantId: 'local',
            card: { instanceId: 'local:draw-1', cardId: 'basic_chillwind_yeti' }
          },
          {
            type: 'card-drawn',
            participantId: 'remote',
            card: { instanceId: 'remote:draw-2', cardId: 'basic_fireball' }
          }
        ]
      })
    )
    expect(text).toBe(
      '- Ends the turn with 1 mana remaining.\n- Draws Fireball.\n\nTurn 2 - LP\n\nMana: 2/3\n\n- Has 1 mana crystals locked by Overload.\n- Draws Chillwind Yeti.\n- RP draws Fireball.\n'
    )
  })

  it('emits one opening turn heading when the engine supplies both start events', () => {
    const transcript = new MatchLogTranscript()
    transcript.format(matchStart)
    const text = transcript.format(
      command({
        events: [
          {
            type: 'opening-turn-started',
            participantId: 'remote',
            mana: { available: 1, maximum: 1 }
          },
          {
            type: 'turn-started',
            participantId: 'remote',
            turnNumber: 1,
            mana: { available: 1, maximum: 1 }
          }
        ]
      })
    )
    expect(text.match(/Turn 1 - RP/g)).toHaveLength(1)
    expect(text).toContain('Mana: 1/1')
  })

  it('keeps card placement, entry stats, targets, and action failures readable', () => {
    const transcript = startedTranscript('local')
    const played = transcript.format(
      command({
        command: { type: 'play-card', cardInstanceId: 'local:yeti', position: 0 },
        actor: 'local',
        source: { cardId: 'basic_chillwind_yeti', cost: 4 },
        events: [
          {
            type: 'minion-played',
            participantId: 'local',
            position: 0,
            minion: {
              instanceId: 'local:yeti',
              cardId: 'basic_chillwind_yeti',
              attack: 4,
              health: 5
            }
          },
          {
            type: 'minion-summoned',
            participantId: 'local',
            position: 0,
            minion: {
              instanceId: 'local:yeti',
              cardId: 'basic_chillwind_yeti',
              attack: 4,
              health: 5
            }
          }
        ]
      })
    )
    expect(played).toBe(
      '- Plays Chillwind Yeti for 4 mana, in board position 1.\n  - Chillwind Yeti enters with 4 attack and 5 health.\n'
    )
    const rejected = transcript.format(
      command({
        command: {
          type: 'play-card',
          cardInstanceId: 'local:fireball',
          targets: [{ kind: 'hero', participantId: 'remote' }]
        },
        actor: 'local',
        source: { cardId: 'basic_fireball', cost: 4 },
        accepted: false,
        code: 'not-enough-mana'
      })
    )
    expect(rejected).toContain(
      "Attempts to play Fireball for 4 mana, targeting RP's hero."
    )
    expect(rejected).toContain('The action fails because there is not enough mana.')
  })

  it.each([true, false])(
    'records final entry changes without duplicating entry or explicit effects (effect=%s)',
    (withEffect) => {
      const transcript = startedTranscript('local')
      const entry = {
        participantId: 'local',
        position: 0,
        minion: {
          instanceId: 'local:yeti',
          cardId: 'basic_chillwind_yeti',
          attack: 4,
          health: 5
        }
      }
      const text = transcript.format(
        command({
          actor: 'local',
          command: { type: 'play-card', cardInstanceId: 'local:yeti', position: 0 },
          source: { cardId: 'basic_chillwind_yeti', cost: 4 },
          events: [
            { type: 'minion-played', ...entry },
            ...(withEffect
              ? [
                  {
                    type: 'effect-resolved',
                    action: 'modify',
                    data: {
                      target: 'local:yeti',
                      attackBefore: 4,
                      attackAfter: 6,
                      healthBefore: 5,
                      healthAfter: 5
                    }
                  }
                ]
              : []),
            {
              type: 'minion-summoned',
              ...entry,
              minion: { ...entry.minion, attack: 6 }
            }
          ]
        })
      )
      expect(text.match(/enters with/g)).toHaveLength(1)
      expect(text).toContain('enters with 4 attack and 5 health.')
      expect(text.match(/now has/g)).toHaveLength(1)
      expect(text).toContain('now has 6 attack and 5 health.')
    }
  )

  it('keeps combat, duplicate-minion targets, damage, shields, deaths and the explicit winner', () => {
    const transcript = startedTranscript('local')
    const record = command({
      actor: 'local',
      command: {
        type: 'attack-character',
        attacker: { kind: 'minion', instanceId: 'local:yeti' },
        defender: { kind: 'minion', instanceId: 'remote:yeti-2' }
      },
      entities: [
        {
          id: 'local:yeti',
          participantId: 'local',
          cardId: 'basic_chillwind_yeti',
          position: 1
        },
        {
          id: 'remote:yeti-1',
          participantId: 'remote',
          cardId: 'basic_chillwind_yeti',
          position: 1
        },
        {
          id: 'remote:yeti-2',
          participantId: 'remote',
          cardId: 'basic_chillwind_yeti',
          position: 2
        }
      ],
      events: [
        {
          type: 'combat-started',
          combatId: 'combat',
          attacker: {
            participantId: 'local',
            character: { kind: 'minion', instanceId: 'local:yeti' }
          },
          defender: {
            participantId: 'remote',
            character: { kind: 'minion', instanceId: 'remote:yeti-2' }
          }
        },
        {
          type: 'effect-resolved',
          action: 'damage',
          data: { target: 'local:yeti', shieldConsumed: true }
        },
        {
          type: 'effect-resolved',
          action: 'damage',
          data: { target: 'remote:yeti-2', actualDamage: 4, healthAfter: 0 }
        },
        {
          type: 'death-batch-started',
          deaths: [{ kind: 'minion', instanceId: 'remote:yeti-2' }]
        },
        { type: 'match-ended', winnerId: 'local' }
      ]
    })
    const unchanged = structuredClone(record)
    const text = transcript.format(record)
    expect(text).toContain(
      "LP's Chillwind Yeti attacks RP's Chillwind Yeti in position 2."
    )
    expect(text).toContain(
      "LP's Chillwind Yeti's Divine Shield absorbs the damage and is removed."
    )
    expect(text).toContain(
      "RP's Chillwind Yeti in position 2 takes 4 damage and has 0 health remaining."
    )
    expect(text).toContain("RP's Chillwind Yeti in position 2 dies.")
    expect(text).toContain('- LP wins.')
    expect(record).toEqual(unchanged)
  })

  it('keeps fatigue, burns, healing, armor, secrets, transforms, choices and timeout events', () => {
    const transcript = startedTranscript('local')
    const text = transcript.format(
      command({
        actor: 'local',
        command: { type: 'timeout' },
        entities: [
          {
            id: 'remote:yeti',
            participantId: 'remote',
            cardId: 'basic_chillwind_yeti',
            position: 1
          }
        ],
        events: [
          { type: 'fatigue', participantId: 'local', amount: 2 },
          {
            type: 'card-burned',
            participantId: 'local',
            card: { instanceId: 'local:burn', cardId: 'basic_fireball' }
          },
          {
            type: 'character-healed',
            participantId: 'remote',
            character: { kind: 'hero' },
            amount: 3,
            healthAfter: 20
          },
          { type: 'armor-gained', participantId: 'local', amount: 2, armorAfter: 2 },
          {
            type: 'effect-resolved',
            action: 'transform',
            data: { target: 'remote:yeti', cardId: 'basic_sheep' }
          },
          {
            type: 'effect-resolved',
            action: 'reveal',
            controllerId: 'remote',
            data: { participantId: 'remote', cardId: 'classic_counterspell' }
          },
          {
            type: 'discover-started',
            participantId: 'local',
            candidates: [
              { cardId: 'basic_fireball' },
              { cardId: 'basic_chillwind_yeti' }
            ]
          },
          { type: 'match-ended', winnerId: null }
        ]
      })
    )
    for (const expected of [
      "LP's turn timer expires.",
      'The fatigue penalty is 2 damage.',
      'Fireball is burned.',
      "RP's hero restores 3 health and has 20 health remaining.",
      "LP's hero gains 2 armor",
      'transforms into Sheep.',
      'RP reveals Counterspell.',
      "LP's options: Fireball, Chillwind Yeti.",
      'The match ends in a draw.'
    ])
      expect(text).toContain(expected)
    expect(text).not.toContain('undefined')
  })
})

const matchStart: MatchLogRecord = {
  stream: 'events',
  kind: 'match-start',
  timestamp: '2026-11-10T14:50:31.678Z',
  data: {
    participants: [
      { participantId: 'remote', label: 'Remote Player', heroId: 'uther' },
      { participantId: 'local', label: 'Local Player', heroId: 'jaina' }
    ],
    firstPlayerId: 'remote',
    hands: [
      { participantId: 'remote', cards: ['basic_chillwind_yeti'] },
      { participantId: 'local', cards: ['basic_fireball'] }
    ]
  }
}
function command(data: JsonObject): MatchLogRecord {
  return {
    stream: 'events',
    kind: 'command',
    timestamp: matchStart.timestamp,
    data: { command: { type: 'confirm-mulligan' }, ...data }
  }
}
function startedTranscript(owner: string): MatchLogTranscript {
  const transcript = new MatchLogTranscript()
  transcript.format(matchStart)
  transcript.format(
    command({
      events: [
        {
          type: 'turn-started',
          participantId: owner,
          turnNumber: 1,
          mana: { available: 1, maximum: 1 }
        }
      ]
    })
  )
  return transcript
}

describe('AI decision Markdown', () => {
  it('freezes names and copy labels for each search, including grouping and retained plans', () => {
    const transcript = decisionTranscript()
    transcript.accept(decisionRequest('before', 4))
    transcript.accept(decisionResponse('before', 4))
    const next = decisionRequest('after', 5)
    const messages = (next.data.request as JsonObject).messages as JsonObject[]
    const facts = JSON.parse(String(messages[0]!.content))
    facts.state.players[0].hand.forEach((card: { name: string }) => {
      card.name = 'Sheep'
    })
    facts.state.players[1].board[0].name = 'Chillwind Yeti'
    ;(messages[0] as Record<string, JsonValue>).content = JSON.stringify(facts)
    transcript.accept(next)
    transcript.accept(decisionResponse('after', 5))
    const [before, after] = transcript.render().split('### Search 2')
    expect(before).toContain('**Argent Horserider**')
    expect(before).toContain('Argent Horserider #2 in position 2')
    expect(before).toContain('LP board: Shielded Minibot')
    expect(before).toContain('Selected plan (not execution): Play Argent Horserider #1')
    expect(before).not.toContain('Sheep')
    expect(before).not.toContain('Chillwind Yeti')
    expect(after).toContain('**Sheep**')
    expect(after).toContain('Sheep #2 in position 2')
    expect(after).toContain('LP board: Chillwind Yeti')
    expect(after).toContain('Selected plan (not execution): Play Sheep #1')
    expect(after).not.toContain('Argent Horserider')
  })

  it('preserves different choose-one options for the same card and placement', () => {
    const transcript = decisionTranscript()
    transcript.accept(decisionRequest('r1', 4))
    const response = decisionResponse('r1', 4)
    const options = ((response.data.usage as JsonObject).searchSummary as JsonObject)
      .options as Record<string, JsonValue>[]
    options.forEach((option, index) => {
      Object.assign(option.intent as JsonObject, {
        source: 'remote:rider-1',
        position: 0,
        option: index ? 'draw' : 'summon'
      })
    })
    transcript.accept(response)
    const markdown = transcript.render()
    expect(markdown).toContain('Play Argent Horserider #1 in position 1; choice summon')
    expect(markdown).toContain('Play Argent Horserider #1 in position 1; choice draw')
  })

  it('groups cached commits and reused actions under one search, keeping scores and exact line support distinct', () => {
    const transcript = decisionTranscript()
    const request = decisionRequest('r1', 4)
    transcript.accept(request)
    const response = decisionResponse('r1', 4)
    transcript.accept({ ...response, kind: 'turn-plan' })
    transcript.accept({ ...response, data: { ...response.data, durationMs: 0 } })
    transcript.accept(
      executed('r1', 4, {
        type: 'play-card',
        participantId: 'remote',
        cardInstanceId: 'remote:rider-1',
        position: 0
      })
    )
    transcript.accept(decisionRequest('r2', 5))
    transcript.accept({
      ...decisionResponse('r2', 5),
      data: { usage: { mode: 'expert-continuation' }, choice: { actionId: 'a0' } }
    })
    transcript.accept(executed('r2', 5, { type: 'end-turn', participantId: 'remote' }))
    const markdown = transcript.render()
    expect(markdown.match(/### Search /g)).toHaveLength(1)
    expect(markdown.match(/RP hand:/g)).toHaveLength(1)
    expect(markdown).toContain('duration 4.05s')
    expect(markdown).toContain('score +0.069610; 34 visits')
    expect(markdown).toContain('Exact-line support: search 1: 5')
    expect(markdown).toContain('Selected plan (not execution)')
    expect(markdown).toContain('reused plan, no fresh search')
    expect(markdown).toContain('Argent Horserider #1 in position 1')
    expect(markdown).toContain('Argent Horserider #2 in position 2')
    expect(markdown).toContain('search seed 1234')
    expect(markdown).not.toContain('undefined')
  })

  it('does not hide ninth options, missing values, truncation, or the difference from the actual shortlist', () => {
    const transcript = decisionTranscript()
    transcript.accept(decisionRequest('r1', 4))
    const response = decisionResponse('r1', 4)
    const usage = response.data.usage as Record<string, JsonValue>
    const summary = usage.searchSummary as Record<string, JsonValue>
    const options = summary.options as Record<string, JsonValue>[]
    const first = options[0]!
    first.consensusExpectedValue = 0.02
    const world = (first.worlds as Record<string, JsonValue>[])[0]!
    world.sequence = {
      ...(world.sequence as JsonObject),
      originalLength: 10,
      truncated: true
    }
    ;(first.worlds as JsonObject[]).push({
      worldIndex: 1,
      sequence: {
        ...(world.sequence as JsonObject),
        originalLength: 2,
        truncated: false,
        supportVisits: 3
      }
    })
    options.push(
      ...Array.from({ length: 7 }, (_, index) => ({
        actionId: `missing-${index}`,
        intent: {
          type: 'end-turn',
          source: null,
          targets: [],
          position: null,
          option: null
        },
        evaluated: index !== 6,
        consensusIncluded: false,
        expectedValue: null,
        consensusExpectedValue: null,
        visits: null,
        worlds: []
      }))
    )
    summary.legalActionCount = 9
    summary.evaluatedActionCount = 8
    summary.worlds = [
      { worldIndex: 0, status: 'partial', timedOut: true, sequencesOmitted: 2 }
    ]
    transcript.accept(response)
    const markdown = transcript.render()
    expect(markdown).toContain('9 legal first moves; 8 evaluated')
    expect(markdown).toContain('score +0.020000')
    expect(markdown).toContain('All evaluated samples combined: +0.069610')
    expect(markdown).toContain('score not recorded; visits not recorded')
    expect(markdown).toContain('not evaluated')
    expect(markdown).toContain(
      'Original full-line support: search 1: 5; displayed prefix truncated from 10 actions'
    )
    expect(markdown).toContain('Exact-line support: search 2: 3; partial line')
    expect(markdown).toContain('time limit reached')
    expect(markdown).toContain('2 per-search continuations not retained')
  })

  it('records overrides, rejected actions and changed plans without calling a selected move executed', () => {
    const transcript = decisionTranscript()
    transcript.accept(decisionRequest('r1', 4))
    const response = decisionResponse('r1', 4)
    Object.assign(response.data, { choice: { actionId: 'a1' } })
    const usage = response.data.usage as Record<string, JsonValue>
    usage.decisionProvenance = {
      workerActionId: 'a0',
      returnedActionId: 'a1',
      overridden: true,
      continuationChanged: true,
      reason: 'Safety check',
      fallback: true,
      returnedFinishReason: 'expert-continuation-fallback'
    }
    transcript.accept(response)
    expect(transcript.render()).toContain('No execution recorded.')
    transcript.accept({
      ...executed('r1', 4, {
        type: 'play-card',
        participantId: 'remote',
        cardInstanceId: 'remote:rider-2',
        position: 1
      }),
      data: {
        ...executed('r1', 4, {}).data,
        command: {
          type: 'play-card',
          participantId: 'remote',
          cardInstanceId: 'remote:rider-2',
          position: 1
        },
        accepted: false,
        message: 'Stale revision'
      }
    })
    const markdown = transcript.render()
    expect(markdown).toContain('Argent Horserider #2 in position 2 — selected')
    expect(markdown).toContain(
      'selection changed from Play Argent Horserider #1 in position 1 to Play Argent Horserider #2 in position 2: Safety check'
    )
    expect(markdown).toContain('controller changed the planned continuation')
    expect(markdown).toContain('fallback: expert-continuation-fallback')
    expect(markdown).toContain('rejected: Stale revision')
  })

  it('keeps forced turn-ending actions with their original turn and handles mulligan without fabricated searches', () => {
    const transcript = decisionTranscript()
    transcript.accept({
      ...command({
        actor: 'remote',
        command: { type: 'end-turn', participantId: 'remote' },
        beforeRevision: 7,
        beforeTurnNumber: 4,
        afterTurnNumber: 5
      }),
      revision: 8,
      turnNumber: 5
    })
    const forced = executed('forced', 7, { type: 'end-turn', participantId: 'remote' })
    transcript.accept({
      ...forced,
      turnNumber: 5,
      data: { ...forced.data, source: 'forced' }
    })
    const markdown = transcript.render()
    expect(markdown).toContain('## Turn 4 · RP')
    expect(markdown).not.toContain('## Turn 5')
    expect(markdown).toContain('only legal move, no search')
    expect(markdown).not.toContain('### Search')
  })

  it('preserves a fresh end-turn review search separately from the follow-up search', () => {
    const transcript = decisionTranscript()
    transcript.accept(decisionRequest('r1', 4))
    const reviewed = decisionResponse('r1', 4)
    transcript.accept({ ...reviewed, kind: 'end-turn-review' })
    const next = decisionResponse('r1', 4)
    ;(
      (next.data.usage as JsonObject).searchSummary as Record<string, JsonValue>
    ).searchId = 'search2'
    transcript.accept(next)
    transcript.accept(executed('r1', 4, { type: 'end-turn', participantId: 'remote' }))
    const markdown = transcript.render()
    expect(markdown.match(/### Search /g)).toHaveLength(2)
    expect(markdown).toContain('End turn was selected but not executed')
    const [first, second] = markdown.split('### Search 2')
    expect(first).toContain('No execution recorded')
    expect(second).toContain('End turn (accepted)')
  })

  it('renders execution-only hero attacks, targeted powers and choices with exact ownership', () => {
    const transcript = decisionTranscript()
    transcript.accept(
      executed('forced1', 4, {
        type: 'attack-character',
        participantId: 'remote',
        attacker: { kind: 'hero' },
        defender: { kind: 'hero' }
      })
    )
    transcript.accept(
      executed('forced2', 5, {
        type: 'use-hero-power',
        participantId: 'remote',
        target: { kind: 'hero', participantId: 'remote' }
      })
    )
    transcript.accept(
      executed('forced3', 6, {
        type: 'choose-card-option',
        participantId: 'remote',
        sourceCardInstanceId: 'remote:choice',
        choice: 'draw'
      })
    )
    const markdown = transcript.render()
    expect(markdown).toContain("RP's hero attacks LP's hero")
    expect(markdown).toContain("Use remote:hero-power → RP's hero")
    expect(markdown).toContain('Choose draw for remote:choice')
  })

  it.each([
    {
      failures: [],
      expected: null
    },
    {
      failures: ['world 2: Worker unavailable'],
      expected: 'failed searches: world 2: Worker unavailable'
    },
    {
      failures: ['world 1 returned no result', 'world 3: [worker]\nfailed'],
      expected:
        'failed searches: world 1 returned no result, world 3: \\[worker\\] failed'
    }
  ])('preserves failed search diagnostics: $failures', ({ failures, expected }) => {
    const transcript = decisionTranscript()
    transcript.accept(decisionRequest('r1', 4))
    const response = decisionResponse('r1', 4)
    const usage = response.data.usage as JsonObject
    const summary = usage.searchSummary as JsonObject
    summary.failedWorlds = failures
    transcript.accept(response)
    const markdown = transcript.render()
    if (expected) expect(markdown).toContain(expected)
    else expect(markdown).not.toContain('failed searches:')
    expect(markdown).not.toContain('NaN')
  })

  it('uses fair state only, whitelists metadata, and keeps genuinely missing records explicit', () => {
    const transcript = decisionTranscript({
      apiKey: 'secret-do-not-log',
      headers: { Authorization: 'another-secret' }
    })
    const request = decisionRequest('r1', 4)
    transcript.accept(request)
    transcript.accept({
      ...decisionResponse('r1', 4),
      data: { modelId: 'hardware-local-v2', choice: { actionId: 'a0' } }
    })
    const markdown = transcript.render()
    expect(markdown).not.toContain('secret-do-not-log')
    expect(markdown).not.toContain('another-secret')
    expect(markdown).toContain('LP hand: 4 cards; hidden cards are not shown')
    expect(markdown).toContain('evaluated count not recorded')
    expect(markdown).toContain('score not recorded')
    expect(markdown).toContain('No execution recorded')
  })
})

function decisionTranscript(metadata: JsonObject = {}): AiDecisionTranscript {
  const transcript = new AiDecisionTranscript(
    {
      aiDifficulty: 'expert',
      seed: 42,
      aiResources: { turnBudgetMs: 60_000 },
      ...metadata
    },
    matchStart.timestamp
  )
  transcript.accept(matchStart)
  return transcript
}
function decisionRequest(id: string, revision: number): MatchLogRecord {
  const state = {
    turn: 4,
    players: [
      {
        role: 'self',
        hero: { instanceId: 'remote:hero', health: 30, armor: 0 },
        mana: { available: 3, maximum: 2, temporary: 1 },
        board: [],
        hand: [
          {
            ref: 'remote:rider-1',
            name: 'Argent Horserider',
            type: 'Minion',
            cost: 3,
            attack: 2,
            health: 1
          },
          {
            ref: 'remote:rider-2',
            name: 'Argent Horserider',
            type: 'Minion',
            cost: 3,
            attack: 2,
            health: 1
          }
        ]
      },
      {
        role: 'opponent',
        hero: { instanceId: 'local:hero', health: 30, armor: 0 },
        mana: { available: 0, maximum: 2 },
        board: [
          {
            ref: 'local:minibot',
            name: 'Shielded Minibot',
            attack: 2,
            health: 2,
            position: 0,
            activeKeywords: ['divine-shield'],
            currentStatus: { shieldActive: false }
          }
        ],
        handSize: 4
      }
    ]
  }
  return {
    stream: 'decisions',
    kind: 'request-started',
    timestamp: matchStart.timestamp,
    decisionId: id,
    revision,
    turnNumber: 4,
    data: {
      expectedRevision: revision,
      phase: 'action',
      actions: [
        {
          id: 'a0',
          intent: {
            type: 'play-card',
            source: 'remote:rider-1',
            targets: [],
            position: 0,
            option: null
          }
        },
        {
          id: 'a1',
          intent: {
            type: 'play-card',
            source: 'remote:rider-2',
            targets: [],
            position: 1,
            option: null
          }
        }
      ],
      request: { messages: [{ role: 'user', content: JSON.stringify({ state }) }] }
    }
  }
}
function decisionResponse(id: string, revision: number): MatchLogRecord {
  const options = [0, 1].map((index) => ({
    actionId: `a${index}`,
    evaluated: true,
    consensusIncluded: true,
    intent: {
      type: 'play-card',
      source: `remote:rider-${index + 1}`,
      targets: [],
      position: index,
      option: null
    },
    expectedValue: index ? 0.066526 : 0.06961,
    votes: index ? 1 : 2,
    visits: 34,
    sampledWorlds: 3,
    worlds: [
      {
        worldIndex: 0,
        sequence: {
          intents: [
            {
              type: 'play-card',
              source: `remote:rider-${index + 1}`,
              targets: [],
              position: index,
              option: null
            },
            {
              type: 'attack-character',
              source: `remote:rider-${index + 1}`,
              targets: ['local:minibot'],
              position: null,
              option: null
            }
          ],
          supportVisits: 5,
          originalLength: 2,
          truncated: false,
          ending: 'partial'
        }
      }
    ]
  }))
  return {
    stream: 'decisions',
    kind: 'response-received',
    timestamp: matchStart.timestamp,
    decisionId: id,
    revision,
    turnNumber: 4,
    data: {
      modelId: 'hardware-local-v2',
      durationMs: 4050,
      choice: { actionId: 'a0' },
      usage: {
        mode: 'expert-sampled-search',
        searchSummary: {
          version: 1,
          searchId: 'search1',
          seed: 1234,
          durationMs: 4050,
          legalActionCount: 2,
          evaluatedActionCount: 2,
          settings: { planSearchLimitMs: 30_000, replanSearchLimitMs: 4_000 },
          options,
          worlds: [
            { worldIndex: 0, status: 'completed', timedOut: false, sequencesOmitted: 0 }
          ]
        },
        plannedActionIntents: options[0]!.worlds[0]!.sequence.intents,
        decisionProvenance: { overridden: false, fallback: false }
      }
    }
  }
}
function executed(id: string, revision: number, command: JsonObject): MatchLogRecord {
  return {
    stream: 'decisions',
    kind: 'action-executed',
    timestamp: matchStart.timestamp,
    decisionId: id,
    turnNumber: 4,
    data: { expectedRevision: revision, source: 'model', accepted: true, command }
  }
}
