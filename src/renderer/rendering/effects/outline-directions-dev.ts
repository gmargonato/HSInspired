import {
  OUTLINE_TUNINGS,
  type OutlinePresetName,
  type OutlineTuning
} from './outline-tuning'

export interface ExperimentalDirection {
  readonly id: string
  readonly label: string
  readonly tuning: Record<OutlinePresetName, OutlineTuning>
}

const DIRECTIONS: readonly ExperimentalDirection[] = [
  {
    id: 'direction-05-arcane-filament',
    label: 'Arcane Filament',
    tuning: OUTLINE_TUNINGS
  }
]

const BY_ID = new Map(DIRECTIONS.map((direction) => [direction.id, direction]))

export function resolveExperimentalOutlineTuning(
  directionId: string | undefined,
  preset: OutlinePresetName,
  tuning: OutlineTuning
): OutlineTuning {
  return BY_ID.get(directionId ?? '')?.tuning[preset] ?? tuning
}

export function getExperimentalOutlineDirectionId(): string | undefined {
  if (typeof window !== 'undefined') {
    const queryDirection = new URLSearchParams(window.location.search).get(
      'outlineDirection'
    )
    if (queryDirection) return queryDirection
  }
  return import.meta.env.VITE_OUTLINE_DIRECTION
}

export function listExperimentalOutlineDirections(): readonly ExperimentalDirection[] {
  return DIRECTIONS
}
