import type {
  OutlinePaletteName,
  OutlinePresetName
} from '../../../rendering/effects/outline-tuning'

/** Only colors used by the effect's production states are offered in the lab. */
export const OUTLINE_LAB_PALETTES: Record<
  OutlinePresetName,
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
  board: [
    { palette: 'green', label: 'Ready' },
    { palette: 'red', label: 'Targeting' },
    { palette: 'white', label: 'Hover' }
  ],
  button: [
    { palette: 'blue', label: 'Selection' },
    { palette: 'green', label: 'End turn' },
    { palette: 'white', label: 'Hover' }
  ],
  ghost: [{ palette: 'purple', label: 'Banner' }]
}
