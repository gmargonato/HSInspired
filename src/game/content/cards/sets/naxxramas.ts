import records from './naxxramas.json'
import { validateCardSet } from '../card-validator'

export const NAXXRAMAS_CARD_SOURCE = validateCardSet(
  records,
  'naxxramas',
  'naxxramas.json'
)
