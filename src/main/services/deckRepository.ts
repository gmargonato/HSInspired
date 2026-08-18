import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { CARD_CATALOG } from '../../../card-lab/card-catalog'
import {
  DECK_CLASSES,
  DECK_FILE_VERSION,
  MAX_DECK_CARDS,
  MAX_NON_LEGENDARY_COPIES,
  cloneDeck,
  getCardCopyLimit,
  isCardAllowedInDeck,
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function assertPersistableDeck(deck: Deck, previous?: Deck): void {
  if (!isValidDeck(deck) || !hasValidCatalogCards(deck, previous)) {
    throw new Error('Invalid deck data')
  }
}

function hasValidCatalogCards(deck: Deck, previous?: Deck): boolean {
  return Object.entries(deck.cards).every(([cardId, count]) => {
    const card = CARD_CATALOG.get(cardId)
    const previousCount = previous?.cards[cardId]
    // Keep legacy cards loadable while allowing users to remove them. Any
    // newly added copies still have to pass the current catalog and class rules.
    if (
      previous?.heroClass === deck.heroClass &&
      previousCount !== undefined &&
      count <= previousCount
    ) {
      return true
    }
    return (
      card !== undefined &&
      count <= getCardCopyLimit(card) &&
      isCardAllowedInDeck(deck, card)
    )
  })
}

/** Durable JSON-backed storage for the player's decks. */
export class DeckRepository {
  private loaded = false
  private loadPromise: Promise<void> | null = null
  private decks: Deck[] = []
  private writeQueue: Promise<void> = Promise.resolve()
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async list(): Promise<readonly Deck[]> {
    await this.ensureLoaded()
    return this.decks.map(cloneDeck)
  }

  async create(request?: DeckCreateRequest): Promise<Deck> {
    return this.enqueueMutation(async () => {
      await this.ensureLoaded()

      const requestRecord =
        request === undefined ? undefined : isRecord(request) ? request : null
      const requestedName = requestRecord?.name
      const requestedHeroClass = requestRecord?.heroClass
      const requestedHeroId = requestRecord?.heroId
      if (
        requestRecord === null ||
        (requestedName !== undefined && typeof requestedName !== 'string') ||
        (requestedHeroClass !== undefined && !isDeckClass(requestedHeroClass)) ||
        (requestedHeroId !== undefined &&
          (typeof requestedHeroId !== 'string' || requestedHeroId.trim().length === 0))
      ) {
        throw new Error('Invalid deck creation request')
      }

      const now = new Date().toISOString()
      const deck: Deck = {
        id: randomUUID(),
        name: requestedName?.trim() || this.nextDefaultDeckName(),
        ...(requestedHeroClass ? { heroClass: requestedHeroClass } : {}),
        ...(requestedHeroId ? { heroId: requestedHeroId.trim() } : {}),
        cards: {},
        createdAt: now,
        updatedAt: now
      }

      const nextDecks = [...this.decks, deck]
      await this.persist(nextDecks)
      this.decks = nextDecks
      return cloneDeck(deck)
    })
  }

  async update(deck: Deck): Promise<Deck> {
    return this.enqueueMutation(async () => {
      await this.ensureLoaded()

      if (!isValidDeck(deck)) {
        throw new Error('Invalid deck data')
      }
      const index = this.decks.findIndex((candidate) => candidate.id === deck.id)
      if (index === -1) {
        throw new Error(`Cannot update missing deck: ${deck.id}`)
      }

      const existing = this.decks[index]
      assertPersistableDeck(deck, existing)
      const updated: Deck = {
        ...cloneDeck(deck),
        name: deck.name.trim(),
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString()
      }
      const nextDecks = [...this.decks]
      nextDecks[index] = updated
      await this.persist(nextDecks)
      this.decks = nextDecks
      return cloneDeck(updated)
    })
  }

  async delete(deckId: string): Promise<void> {
    return this.enqueueMutation(async () => {
      await this.ensureLoaded()

      const index = this.decks.findIndex((deck) => deck.id === deckId)
      if (index === -1) {
        throw new Error(`Cannot delete missing deck: ${deckId}`)
      }

      const nextDecks = this.decks.filter(
        (_, candidateIndex) => candidateIndex !== index
      )
      await this.persist(nextDecks)
      this.decks = nextDecks
    })
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return

    if (this.loadPromise) return this.loadPromise

    this.loadPromise = this.readPersistedDecks().finally(() => {
      this.loadPromise = null
    })
    return this.loadPromise
  }

  private async readPersistedDecks(): Promise<void> {
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

  private async persist(decks = this.decks): Promise<void> {
    const payload: PersistedDeckFile = {
      version: DECK_FILE_VERSION,
      decks: decks.map(cloneDeck)
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

  private nextDefaultDeckName(): string {
    const names = new Set(this.decks.map((deck) => deck.name))
    let number = this.decks.length + 1
    while (names.has(`Deck ${number}`)) number += 1
    return `Deck ${number}`
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(operation, operation)
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }
}
