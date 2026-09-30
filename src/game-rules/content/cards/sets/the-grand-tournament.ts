import records from './the-grand-tournament.json'

import { validateCardSet } from '../card-validator'

export const THE_GRAND_TOURNAMENT_CARD_SOURCE = validateCardSet(
  records,
  'the-grand-tournament',
  'the-grand-tournament.json'
)
