import { CARD_CATALOG } from '../../content/cards'
import type { OpeningMatchState, OpeningPlayerState } from '../opening-match-types'
import type { PlayerId } from '../match-types'
import { authoritativeEntityIds } from './zone-state'

export class MatchInvariantError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MatchInvariantError'
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new MatchInvariantError(message)
}

function cardIdList(player: OpeningPlayerState): readonly string[] {
  return authoritativeEntityIds(player)
}

/** Validates authoritative zones and resource bounds after every accepted command. */
export function assertOpeningMatchInvariants(state: OpeningMatchState): void {
  assert(
    Number.isInteger(state.revision) && state.revision >= 0,
    'Revision must be non-negative.'
  )
  assert(state.players.length === 2, 'A match must have exactly two players.')
  const participantIds = new Set([state.playerOneId, state.playerTwoId])
  assert(participantIds.size === 2, 'A match must have two distinct participant ids.')
  assert(
    state.players.every((player) => participantIds.has(player.participantId)),
    'Every player must be registered in the match participant ids.'
  )

  const ids = state.players.flatMap(cardIdList)
  const heroIds = state.players.flatMap((player) =>
    player.hero.instanceId ? [player.hero.instanceId] : []
  )
  assert(
    new Set([...ids, ...heroIds]).size === ids.length + heroIds.length,
    'An entity is present in two authoritative zones.'
  )

  const ordinals: number[] = []
  const activeAttachmentIds: string[] = []
  const recordOrdinal = (value: number | undefined, label: string): void => {
    if (value === undefined) return
    assert(
      Number.isInteger(value) && value >= 0,
      `${label} has an invalid creation ordinal.`
    )
    ordinals.push(value)
  }
  const checkOwnership = (
    ownerId: PlayerId | undefined,
    controllerId: PlayerId | undefined,
    participantId: PlayerId,
    label: string,
    requireController = true
  ): void => {
    if (ownerId !== undefined)
      assert(participantIds.has(ownerId), `${label} has an unknown owner.`)
    if (controllerId !== undefined) {
      assert(participantIds.has(controllerId), `${label} has an unknown controller.`)
      if (requireController)
        assert(
          controllerId === participantId,
          `${label} has an invalid controller placement.`
        )
    }
  }

  for (const player of state.players) {
    assert(player.hand.length <= 10, `Hand limit exceeded for ${player.participantId}.`)
    assert(
      player.board.length <= 7,
      `Board limit exceeded for ${player.participantId}.`
    )
    assert(
      Number.isInteger(player.mana.maximum) &&
        player.mana.maximum >= 0 &&
        player.mana.maximum <= 10,
      'Mana maximum is out of range.'
    )
    const temporaryMana = player.mana.temporary ?? 0
    assert(
      Number.isInteger(temporaryMana) && temporaryMana >= 0,
      'Temporary mana is invalid.'
    )
    assert(
      Number.isInteger(player.mana.available) &&
        player.mana.available >= 0 &&
        player.mana.available <= player.mana.maximum + temporaryMana,
      'Available mana is invalid.'
    )
    const overloadLocked = player.mana.overloadLocked ?? 0
    const overloadNextTurn = player.mana.overloadNextTurn ?? 0
    assert(
      Number.isInteger(overloadLocked) && overloadLocked >= 0 && overloadLocked <= 10,
      'Locked overload is invalid.'
    )
    assert(
      Number.isInteger(overloadNextTurn) &&
        overloadNextTurn >= 0 &&
        overloadNextTurn <= 10,
      'Pending overload is invalid.'
    )
    assert(player.fatigueDamage >= 1, 'Fatigue damage must be positive.')
    assert(
      player.hero.maxHealth >= 1 &&
        player.hero.health >= 0 &&
        player.hero.health <= player.hero.maxHealth,
      'Hero health is invalid.'
    )
    assert(player.hero.armor >= 0, 'Hero armor must be non-negative.')
    assert(player.hero.attack >= 0, 'Hero attack must be non-negative.')
    if (player.hero.damageTaken !== undefined)
      assert(
        player.hero.damageTaken === player.hero.maxHealth - player.hero.health,
        `Hero ${player.participantId} has inconsistent damage.`
      )
    recordOrdinal(player.hero.creationOrdinal, `Hero ${player.participantId}`)
    recordOrdinal(
      player.heroPower.creationOrdinal,
      `Hero power ${player.participantId}`
    )
    assert(
      Number.isInteger(player.heroPower.cost) &&
        player.heroPower.cost >= 0 &&
        player.heroPower.cost <= 10,
      `Hero power ${player.participantId} has an invalid cost.`
    )

    const zones = [
      ['deck', player.deck],
      ['hand', player.hand],
      ['revealed', player.revealedCards ?? []],
      ['discarded', player.discardedCards ?? []]
    ] as const
    for (const [zone, cards] of zones) {
      for (const card of cards) {
        assert(
          typeof card.instanceId === 'string' && card.instanceId.length > 0,
          'Card has no instance id.'
        )
        assert(
          typeof card.cardId === 'string' && card.cardId.length > 0,
          `Card ${card.instanceId} has no card id.`
        )
        assert(
          CARD_CATALOG.get(card.cardId) !== undefined,
          `Card ${card.instanceId} references an unknown card ${card.cardId}.`
        )
        assert(
          card.zone === zone,
          `Card ${card.instanceId} has an invalid zone (expected ${zone}, got ${card.zone}).`
        )
        if (card.currentCost !== undefined)
          assert(
            Number.isInteger(card.currentCost) && card.currentCost >= 0,
            `Card ${card.instanceId} has a negative or non-integer cost.`
          )
        if (card.baseCost !== undefined)
          assert(
            Number.isInteger(card.baseCost) && card.baseCost >= 0,
            `Card ${card.instanceId} has an invalid base cost.`
          )
        checkOwnership(
          card.ownerId,
          card.controllerId,
          player.participantId,
          `Card ${card.instanceId}`
        )
        recordOrdinal(card.creationOrdinal, `Card ${card.instanceId}`)
      }
    }

    for (const minion of player.board) {
      assert(
        typeof minion.instanceId === 'string' && minion.instanceId.length > 0,
        'Board minion has no instance id.'
      )
      assert(
        CARD_CATALOG.get(minion.cardId)?.type === 'Minion',
        `Board entity ${minion.instanceId} does not reference a minion card.`
      )
      assert(
        minion.health > 0 && minion.health <= minion.maxHealth,
        `Board minion ${minion.instanceId} has invalid health.`
      )
      assert(
        minion.maxHealth >= 1,
        `Minion ${minion.instanceId} has invalid maximum health.`
      )
      assert(minion.attack >= 0, `Minion ${minion.instanceId} has invalid attack.`)
      if (minion.damageTaken !== undefined)
        assert(
          minion.damageTaken === minion.maxHealth - minion.health,
          `Minion ${minion.instanceId} has inconsistent damage.`
        )
      checkOwnership(
        minion.ownerId,
        minion.controllerId,
        player.participantId,
        `Minion ${minion.instanceId}`
      )
      recordOrdinal(minion.creationOrdinal, `Minion ${minion.instanceId}`)
      for (const attachment of [
        ...(minion.enchantments ?? []),
        ...(minion.grantedTriggers ?? []),
        ...(minion.attachedEffects ?? [])
      ]) {
        assert(
          typeof attachment.id === 'string' && attachment.id.length > 0,
          `Minion ${minion.instanceId} has an attachment without an id.`
        )
        activeAttachmentIds.push(attachment.id)
      }
    }
    if (player.weapon) {
      assert(
        CARD_CATALOG.get(player.weapon.cardId)?.type === 'Weapon',
        `Weapon ${player.weapon.instanceId} does not reference a weapon card.`
      )
      assert(
        player.weapon.attack >= 0 &&
          player.weapon.durability >= 0 &&
          player.weapon.durability <= player.weapon.maxDurability,
        `Weapon ${player.weapon.instanceId} has invalid durability.`
      )
      checkOwnership(
        player.weapon.ownerId,
        player.weapon.controllerId,
        player.participantId,
        `Weapon ${player.weapon.instanceId}`
      )
      recordOrdinal(player.weapon.creationOrdinal, `Weapon ${player.weapon.instanceId}`)
    }
    for (const secret of player.secrets ?? []) {
      assert(
        CARD_CATALOG.get(secret.cardId)?.type === 'Spell',
        `Secret ${secret.instanceId} does not reference a spell card.`
      )
      checkOwnership(
        secret.ownerId,
        secret.controllerId,
        player.participantId,
        `Secret ${secret.instanceId}`
      )
      recordOrdinal(secret.creationOrdinal, `Secret ${secret.instanceId}`)
    }
    for (const entry of player.graveyard ?? []) {
      assert(
        entry.minion.health <= 0,
        `Graveyard minion ${entry.minion.instanceId} is alive.`
      )
      checkOwnership(
        entry.ownerId,
        entry.controllerId,
        player.participantId,
        `Graveyard minion ${entry.minion.instanceId}`,
        false
      )
      recordOrdinal(
        entry.minion.creationOrdinal,
        `Graveyard minion ${entry.minion.instanceId}`
      )
    }
  }

  const ordinalSet = new Set(ordinals)
  assert(
    ordinalSet.size === ordinals.length,
    'Creation ordinals must be globally unique.'
  )
  assert(
    new Set(activeAttachmentIds).size === activeAttachmentIds.length,
    'Active minion attachment ids must be globally unique.'
  )
  if (state.nextEntityOrdinal !== undefined) {
    assert(
      Number.isInteger(state.nextEntityOrdinal) && state.nextEntityOrdinal >= 0,
      'Next entity ordinal is invalid.'
    )
    const maxOrdinal = ordinals.length > 0 ? Math.max(...ordinals) : -1
    assert(
      state.nextEntityOrdinal > maxOrdinal,
      'Next entity ordinal must be greater than every allocated entity ordinal.'
    )
  }
}
