import records from './basic.json'
import { validateCardSet } from '../card-validator'

export const BASIC_CARD_SOURCE = validateCardSet(records, 'basic', 'basic.json')
