import druidHunter from './shortlist-druid-hunter.json'
import paladin from './shortlist-paladin.json'
import mageRogue from './shortlist-mage-rogue.json'
import otherClasses from './shortlist-priest-warrior-shaman-warlock.json'
import { validateCardRecord } from '../card-validator'

/** Selected November 2026 card versions, grouped by implementation package. */
export const SHORTLIST_CARD_SOURCE = [
  ...druidHunter,
  ...paladin,
  ...mageRogue,
  ...otherClasses
].map((record, index) =>
  validateCardRecord(record, record.expansionId, `shortlist[${index}]`)
)
