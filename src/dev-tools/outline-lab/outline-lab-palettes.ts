import type {
  OutlinePaletteName,
  OutlinePresetName
} from '../../visual-components/effects/outline-tuning'

/** Only colors used by the effect's production states are offered in the lab. */
export const OUTLINE_LAB_PALETTES: Record<
  OutlinePresetName | 'ghost',
  readonly {
    readonly palette: OutlinePaletteName
    readonly label: string
  }[]
> = {
  card: [
    { palette: 'green', label: 'Playable' },
    { palette: 'blue', label: 'Valid drop' }
  ],
  'bonus-card': [
    { palette: 'orange', label: 'Enhanced' },
    { palette: 'blue', label: 'Valid drop' }
  ],
  minion: [
    { palette: 'green', label: 'Ready' },
    { palette: 'red', label: 'Targeting' },
    { palette: 'white', label: 'Hover' }
  ],
  hero: [
    { palette: 'green', label: 'Ready' },
    { palette: 'red', label: 'Targeting' }
  ],
  'hero-power': [
    { palette: 'green', label: 'Available' },
    { palette: 'white', label: 'Hover' }
  ],
  weapon: [{ palette: 'white', label: 'Hover' }],
  secret: [{ palette: 'white', label: 'Hover' }],
  quest: [{ palette: 'white', label: 'Hover' }],
  'deck-frame': [{ palette: 'blue', label: 'Selection' }],
  'play-button': [{ palette: 'blue', label: 'Available' }],
  'end-turn': [
    { palette: 'green', label: 'No actions left' },
    { palette: 'white', label: 'Hover' }
  ],
  'expansion-toggle': [{ palette: 'blue', label: 'Selection' }],
  ghost: [{ palette: 'purple', label: 'Banner' }]
}
