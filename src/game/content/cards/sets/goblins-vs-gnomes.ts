import records from './goblins-vs-gnomes.json'
import { validateCardSet } from '../card-validator'

export const GOBLINS_VS_GNOMES_CARD_SOURCE = validateCardSet(
  records,
  'goblins-vs-gnomes',
  'goblins-vs-gnomes.json'
)
