import records from './knights-of-the-frozen-throne.json'

import { validateCardSet } from '../card-validator'

export const KNIGHTS_OF_THE_FROZEN_THRONE_CARD_SOURCE = validateCardSet(
  records,
  'knights-of-the-frozen-throne',
  'knights-of-the-frozen-throne.json'
)
