import records from './mean-streets-of-gadgetzan.json'

import { validateCardSet } from '../card-validator'
import { assembleGadgetzanCards } from './gadgetzan-generated-content'

export const MEAN_STREETS_OF_GADGETZAN_CARD_SOURCE = validateCardSet(
  assembleGadgetzanCards(records),
  'mean-streets-of-gadgetzan',
  'mean-streets-of-gadgetzan.json'
)
