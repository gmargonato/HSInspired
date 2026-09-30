import records from './one-night-in-karazhan.json'

import { validateCardSet } from '../card-validator'

export const ONE_NIGHT_IN_KARAZHAN_CARD_SOURCE = validateCardSet(
  records,
  'one-night-in-karazhan',
  'one-night-in-karazhan.json'
)
