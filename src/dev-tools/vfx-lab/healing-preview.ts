import type { PointData } from 'pixi.js'
import type { HealingArea } from '../../visual-components/effects/healing-effect'
import { AOE_ZONES, type VfxLabSettings } from './vfx-lab-model'
import { VFX_LAB_LAYOUT as L } from './vfx-lab-layout'

export function healingPreview(
  settings: VfxLabSettings,
  excluded: ReadonlySet<string>
) {
  const areas: HealingArea[] = [],
    candidates: (PointData & { id: string; kind: 'hero' | 'minion' })[] = []
  for (const { key } of AOE_ZONES) {
    if (!settings[key]) continue
    const visualKey = (
      settings.opponentCaster
        ? key.replace(/friendly|enemy/, (s) =>
            s === 'friendly' ? 'enemy' : 'friendly'
          )
        : key
    ) as typeof key
    const zone = L.aoe.zones[visualKey]
    // Coverage geometry describes the board surface, not the minion hit row.
    // Heroes receive the shared bloom rather than a second stacked board wave.
    if (visualKey === 'friendlyBoard' || visualKey === 'enemyBoard') {
      const surface = L.aoe.blasts[visualKey]
      areas.push({ ...surface.position, ...surface.size })
    }
    const count = key.endsWith('Board')
      ? Math.max(0, Math.min(7, settings.previewMinions))
      : 1
    for (let i = 0; i < count; i++)
      candidates.push({
        id: key + '-' + i,
        kind: key.endsWith('Board') ? 'minion' : 'hero',
        x: zone.position.x + (i - (count - 1) / 2) * L.aoe.previewTargets.gap,
        y: zone.position.y
      })
  }
  if (settings.friendlyBoard && settings.enemyBoard) {
    const surface = L.aoe.blasts.bothBoards
    areas.splice(0, areas.length, { ...surface.position, ...surface.size })
  }
  return {
    areas,
    candidates,
    recipients: candidates.filter((p) => !excluded.has(p.id))
  }
}
