import rawCards from './blackrock-mountain.json'

import { validateCardSet } from '../card-validator'

export const BLACKROCK_MOUNTAIN_CARD_SOURCE = validateCardSet(
  rawCards,
  'blackrock-mountain',
  'blackrock-mountain.json'
)
