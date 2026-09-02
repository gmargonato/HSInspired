import records from './league-of-explorers.json'

import { validateCardSet } from '../card-validator'

export const LEAGUE_OF_EXPLORERS_CARD_SOURCE = validateCardSet(
  records,
  'league-of-explorers',
  'league-of-explorers.json'
)
