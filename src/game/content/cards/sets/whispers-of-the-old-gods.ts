import records from './whispers-of-the-old-gods.json'

import { validateCardSet } from '../card-validator'

export const WHISPERS_OF_THE_OLD_GODS_CARD_SOURCE = validateCardSet(
  records,
  'whispers-of-the-old-gods',
  'whispers-of-the-old-gods.json'
)
