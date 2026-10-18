import { CENTER, placement } from '../../../visual-components/layout'

/** Landing-local pixels and seconds. */
export const MINION_LANDING_CRACKS_LAYOUT = {
  name: 'Minion landing cracks',
  cracks: placement(
    { x: 0, y: -18 },
    { width: 256, height: 256 },
    {
      anchor: CENTER,
      scale: 1.35,
      note: 'Fixed beneath the landing minion, slightly above its center.'
    }
  ),
  minimumAttack: 7,
  appearDuration: 0.07,
  fadeStart: 3,
  fadeDuration: 0.8
} as const
