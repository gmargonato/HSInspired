import {
  HERO_POWER_CATALOG,
  type HeroPowerDefinition
} from '../../game-rules/content/hero-powers'
import { asPlayerId, type HeroPowerTargetRef } from '../../game-rules/match'
import { CARD_CATALOG, cardHasTribe } from '../../game-rules/content/cards'
import { HERO_POWER_ANIM_LAYOUT } from './hero-power-anim-layout'

export const PREVIEW_LOCAL = asPlayerId('hero-power-preview-local')
export const PREVIEW_REMOTE = asPlayerId('hero-power-preview-remote')

export const PREVIEW_TARGETS = [
  {
    key: 'friendly-hero',
    label: 'Friendly hero',
    target: { kind: 'hero', participantId: PREVIEW_LOCAL }
  },
  {
    key: 'enemy-hero',
    label: 'Opposing hero',
    target: { kind: 'hero', participantId: PREVIEW_REMOTE }
  },
  {
    key: 'friendly-minion',
    label: 'Friendly minion',
    target: {
      kind: 'minion',
      participantId: PREVIEW_LOCAL,
      instanceId: 'preview-friendly-yeti'
    }
  },
  {
    key: 'enemy-minion',
    label: 'Enemy minion',
    target: {
      kind: 'minion',
      participantId: PREVIEW_REMOTE,
      instanceId: 'preview-enemy-yeti'
    }
  }
] as const satisfies readonly {
  key: string
  label: string
  target: HeroPowerTargetRef
}[]

export type PreviewTarget = (typeof PREVIEW_TARGETS)[number]

export const PREVIEW_POWERS = [...HERO_POWER_CATALOG.all].sort(
  (a, b) =>
    a.classId.localeCompare(b.classId) || a.displayName.localeCompare(b.displayName)
)

export function previewTargets(power: HeroPowerDefinition): readonly PreviewTarget[] {
  return PREVIEW_TARGETS.filter(({ target }) => {
    switch (power.targeting) {
      case 'any-character':
        return true
      case 'minion':
        return target.kind === 'minion'
      case 'enemy-minion':
        return target.kind === 'minion' && target.participantId === PREVIEW_REMOTE
      case 'friendly-minion':
        return target.kind === 'minion' && target.participantId === PREVIEW_LOCAL
      case 'friendly-beast':
        return (
          target.kind === 'minion' &&
          target.participantId === PREVIEW_LOCAL &&
          cardHasTribe(
            CARD_CATALOG.require(HERO_POWER_ANIM_LAYOUT.minion.cardId),
            'Beast'
          )
        )
      case 'none':
        return false
    }
  })
}

export function defaultPreviewTarget(
  power: HeroPowerDefinition
): PreviewTarget | undefined {
  if (power.effect.kind === 'damage-enemy-hero') return PREVIEW_TARGETS[1]
  const choices = previewTargets(power)
  const healing =
    power.effect.kind === 'restore-character' ||
    power.effect.kind === 'restore-and-buff-minion'
  return (
    choices.find(({ key }) => key === (healing ? 'friendly-minion' : 'enemy-minion')) ??
    choices[0]
  )
}
