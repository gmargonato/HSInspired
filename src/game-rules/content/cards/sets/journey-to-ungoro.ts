import records from './journey-to-ungoro.json'

import { validateCardSet } from '../card-validator'

export const JOURNEY_TO_UNGORO_CARD_SOURCE = validateCardSet(
  records,
  'journey-to-ungoro',
  'journey-to-ungoro.json'
)
