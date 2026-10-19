import records from './future-past.json'

import { validateCardSet } from '../card-validator'

export const FUTURE_PAST_CARD_SOURCE = validateCardSet(
  records,
  'future-past',
  'future-past.json'
)
