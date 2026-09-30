import records from './classic.json'
import { validateCardSet, validateHeroPowerRecord } from '../card-validator'

export const CLASSIC_CARD_SOURCE = validateCardSet(records, 'classic', 'classic.json')

export const CLASSIC_HERO_POWER_RECORDS = records
  .map((record, index) =>
    record.type === 'Hero Power'
      ? validateHeroPowerRecord(record, `classic.json[${index}]`)
      : null
  )
  .filter((record): record is NonNullable<typeof record> => record !== null)
