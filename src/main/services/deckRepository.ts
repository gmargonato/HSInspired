import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  DECK_CLASSES,
  DECK_FILE_VERSION,
  MAX_DECK_CARDS,
  MAX_NON_LEGENDARY_COPIES,
  countDeckCards,
  type Deck,
  type DeckClass,
  type DeckCreateRequest,
  type PersistedDeckFile
} from '../../shared/decks'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isDeckClass(value: unknown): value is DeckClass {
  return typeof value === 'string' && DECK_CLASSES.includes(value as DeckClass)
}

function isValidCards(value: unknown): value is Readonly<Record<string, number>> {
  if (!isRecord(value)) return false

  return Object.entries(value).every(
    ([cardId, count]) =>
      cardId.trim().length > 0 &&
      typeof count === 'number' &&
      Number.isInteger(count) &&
      count >= 1 &&
      count <= MAX_NON_LEGENDARY_COPIES
  )
}

function isValidDeck(value: unknown): value is Deck {
  if (!isRecord(value)) return false

  return (
    typeof value.id === 'string' &&
    value.id.trim().length > 0 &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    (value.heroClass === undefined || isDeckClass(value.heroClass)) &&
    (value.heroId === undefined ||
      (typeof value.heroId === 'string' && value.heroId.trim().length > 0)) &&
    isValidCards(value.cards) &&
    countDeckCards({ cards: value.cards }) <= MAX_DECK_CARDS &&
    isIsoDate(value.createdAt) &&
    isIsoDate(value.updatedAt)
  )
}

function cloneDeck(deck: Deck): Deck {
  return {
    ...deck,
    cards: { ...deck.cards }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function assertPersistableDeck(deck: Deck): void {
  if (!isValidDeck(deck)) {
    throw new Error('Invalid deck data')
  }
}

/** Durable JSON-backed storage for the player's decks. */
export class DeckRepository {
  private loaded = false
  private decks: Deck[] = []
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async list(): Promise<readonly Deck[]> {
    await this.ensureLoaded()
    return this.decks.map(cloneDeck)
  }

  async create(request?: DeckCreateRequest): Promise<Deck> {
    await this.ensureLoaded()

    const requestedName = request?.name
    const requestedHeroClass = request?.heroClass
    const requestedHeroId = request?.heroId
    if (
      (requestedName !== undefined && typeof requestedName !== 'string') ||
      (requestedHeroClass !== undefined && !isDeckClass(requestedHeroClass)) ||
      (requestedHeroId !== undefined && typeof requestedHeroId !== 'string')
    ) {
      throw new Error('Invalid deck creation request')
    }

    const now = new Date().toISOString()
    const deck: Deck = {
      id: randomUUID(),
      name: requestedName?.trim() || `Deck ${this.decks.length + 1}`,
      ...(requestedHeroClass ? { heroClass: requestedHeroClass } : {}),
      ...(requestedHeroId ? { heroId: requestedHeroId } : {}),
      cards: {},
      createdAt: now,
      updatedAt: now
    }

    this.decks.push(deck)
    await this.persist()
    return cloneDeck(deck)
  }

  async update(deck: Deck): Promise<Deck> {
    await this.ensureLoaded()
    assertPersistableDeck(deck)

    const index = this.decks.findIndex((candidate) => candidate.id === deck.id)
    if (index === -1) {
      throw new Error(`Cannot update missing deck: ${deck.id}`)
    }

    const existing = this.decks[index]
    const updated: Deck = {
      ...cloneDeck(deck),
      name: deck.name.trim(),
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString()
    }
    this.decks[index] = updated
    await this.persist()
    return cloneDeck(updated)
  }

  async delete(deckId: string): Promise<void> {
    await this.ensureLoaded()

    const index = this.decks.findIndex((deck) => deck.id === deckId)
    if (index === -1) {
      throw new Error(`Cannot delete missing deck: ${deckId}`)
    }

    this.decks.splice(index, 1)
    await this.persist()
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return

    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as unknown
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        this.decks = []
        this.loaded = true
        return
      }
      throw new Error(`Failed to read decks from ${this.filePath}`, { cause: error })
    }

    if (!isRecord(parsed) || parsed.version !== DECK_FILE_VERSION) {
      throw new Error(`Unsupported deck data format in ${this.filePath}`)
    }

    const file = parsed as unknown as PersistedDeckFile
    if (!Array.isArray(file.decks) || !file.decks.every(isValidDeck)) {
      throw new Error(`Invalid deck data in ${this.filePath}`)
    }

    this.decks = file.decks.map(cloneDeck)
    this.loaded = true
  }

  private async persist(): Promise<void> {
    const payload: PersistedDeckFile = {
      version: DECK_FILE_VERSION,
      decks: this.decks.map(cloneDeck)
    }
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`

    const write = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.filePath), { recursive: true })
        try {
          await writeFile(
            temporaryPath,
            `${JSON.stringify(payload, null, 2)}\n`,
            'utf8'
          )
          await rename(temporaryPath, this.filePath)
        } finally {
          await unlink(temporaryPath).catch(() => undefined)
        }
      })

    this.writeQueue = write
    await write
  }
}
