import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { HERO_CATALOG, asHeroId } from '../../game/content'
import {
  DECK_FILE_VERSION,
  DECK_RULES,
  MAX_DECKS,
  cloneDeck,
  countDeckCards,
  parseDeck,
  parsePersistedDeckFile,
  type Deck,
  type DeckCreateRequest,
  type PersistedDeckFile
} from '../../game/decks'
import type { DeckRepository as DeckRepositoryPort } from '../../game/decks'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function validateDeckForPersistence(deck: Deck): void {
  const errors = DECK_RULES.validate(deck)
  if (errors.length > 0) throw new Error(`Invalid deck data: ${errors.join(' ')}`)
}

function findHero(value: unknown, property: 'id' | 'classId') {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return HERO_CATALOG.all.find((hero) => hero[property].toLowerCase() === normalized)
}

function migrateLegacyDeckFile(value: unknown): Deck[] | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.decks)) {
    return null
  }

  const decks = value.decks.map((legacyDeck, index) => {
    if (!isRecord(legacyDeck)) {
      throw new Error(`Legacy decks[${index}] must be an object`)
    }

    const hero =
      findHero(legacyDeck.heroId, 'id') ??
      findHero(legacyDeck.heroClass, 'classId') ??
      HERO_CATALOG.require('guldan')
    const deck = parseDeck({ ...legacyDeck, heroId: hero.id })
    validateDeckForPersistence(deck)
    return deck
  })

  if (decks.length > MAX_DECKS) {
    throw new Error(`Too many legacy decks: ${decks.length}`)
  }

  return decks
}

function validateCreateRequest(value: unknown): DeckCreateRequest {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new Error('Invalid deck creation request')
  if (value.name !== undefined && typeof value.name !== 'string') {
    throw new Error('Invalid deck creation request name')
  }
  if (
    value.heroId !== undefined &&
    (typeof value.heroId !== 'string' || value.heroId.trim() === '')
  ) {
    throw new Error('Invalid deck creation request heroId')
  }
  return {
    ...(value.name === undefined ? {} : { name: value.name }),
    ...(value.heroId === undefined ? {} : { heroId: asHeroId(value.heroId) })
  }
}

/** JSON filesystem adapter for the platform-neutral DeckRepository port. */
export class DeckRepository implements DeckRepositoryPort {
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
      if (this.decks.length >= MAX_DECKS)
        throw new Error(`You can have at most ${MAX_DECKS} decks.`)

      const validatedRequest = validateCreateRequest(request)
      const heroId = validatedRequest.heroId ?? HERO_CATALOG.require('guldan').id
      HERO_CATALOG.require(heroId)
      const now = new Date().toISOString()
      const deck: Deck = {
        id: randomUUID(),
        name: validatedRequest.name?.trim() || this.nextDefaultDeckName(),
        heroId,
        cards: {},
        createdAt: now,
        updatedAt: now
      }
      await this.persist([...this.decks, deck])
      this.decks.push(deck)
      return cloneDeck(deck)
    })
  }

  async update(deck: Deck): Promise<Deck> {
    return this.enqueueMutation(async () => {
      await this.ensureLoaded()
      const validatedDeck = parseDeck(deck)
      HERO_CATALOG.require(validatedDeck.heroId)
      validateDeckForPersistence(validatedDeck)
      const index = this.decks.findIndex(
        (candidate) => candidate.id === validatedDeck.id
      )
      if (index === -1)
        throw new Error(`Cannot update missing deck: ${validatedDeck.id}`)

      const existing = this.decks[index]
      const updated: Deck = {
        ...cloneDeck(validatedDeck),
        name: validatedDeck.name.trim(),
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString()
      }
      await this.persist(
        this.decks.map((candidate, candidateIndex) =>
          candidateIndex === index ? updated : candidate
        )
      )
      this.decks[index] = updated
      return cloneDeck(updated)
    })
  }

  async delete(deckId: string): Promise<void> {
    return this.enqueueMutation(async () => {
      await this.ensureLoaded()
      if (typeof deckId !== 'string' || deckId.trim() === '')
        throw new Error('Invalid deck id')
      const nextDecks = this.decks.filter((deck) => deck.id !== deckId)
      if (nextDecks.length === this.decks.length) {
        throw new Error(`Cannot delete missing deck: ${deckId}`)
      }
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
      let migrated: Deck[] | null = null
      try {
        migrated = migrateLegacyDeckFile(parsed)
      } catch (error) {
        console.warn('Could not migrate the unsupported deck file.', error)
      }

      await this.replaceUnsupportedFile(migrated ?? [])
      this.decks = migrated ?? []
      this.loaded = true
      return
    }

    const file = parsePersistedDeckFile(parsed)
    for (const deck of file.decks) {
      HERO_CATALOG.require(deck.heroId)
      validateDeckForPersistence(deck)
    }
    if (file.decks.length > MAX_DECKS)
      throw new Error(`Too many decks in ${this.filePath}`)
    if (file.decks.some((deck) => countDeckCards(deck) > 30)) {
      throw new Error('Invalid deck card count')
    }

    let decks = file.decks
    if (decks.length === 0) {
      const recovered = await this.recoverUnsupportedBackup()
      if (recovered !== null) decks = recovered
    }

    this.decks = decks.map(cloneDeck)
    this.loaded = true
  }

  private async recoverUnsupportedBackup(): Promise<readonly Deck[] | null> {
    const backupPath = await this.findUnsupportedBackup()
    if (!backupPath) return null

    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(backupPath, 'utf8')) as unknown
    } catch (error) {
      console.warn(`Could not read the deck backup at ${backupPath}.`, error)
      return null
    }

    let migrated: Deck[] | null = null
    try {
      migrated = migrateLegacyDeckFile(parsed)
    } catch (error) {
      console.warn(`Could not migrate the deck backup at ${backupPath}.`, error)
    }
    if (migrated === null) return null

    await this.persist(migrated)
    console.warn(
      `Recovered ${migrated.length} deck(s) from ${backupPath} into the version ${DECK_FILE_VERSION} deck file.`
    )
    return migrated
  }

  private async findUnsupportedBackup(): Promise<string | null> {
    let names: string[]
    try {
      names = await readdir(dirname(this.filePath))
    } catch {
      return null
    }

    const prefix = `${basename(this.filePath)}.unsupported-`
    const backupName = names
      .filter((name) => name.startsWith(prefix) && name.endsWith('.bak'))
      .sort()
      .at(-1)
    return backupName ? join(dirname(this.filePath), backupName) : null
  }

  /** Keep an unsupported file recoverable while replacing it with version 2. */
  private async replaceUnsupportedFile(decks: readonly Deck[]): Promise<void> {
    const backupPath = `${this.filePath}.unsupported-${Date.now()}-${randomUUID()}.bak`

    await rename(this.filePath, backupPath)
    try {
      await this.persist(decks)
    } catch (error) {
      await rename(backupPath, this.filePath).catch(() => undefined)
      throw new Error(`Failed to replace unsupported deck data in ${this.filePath}`, {
        cause: error
      })
    }

    if (decks.length > 0) {
      console.warn(
        `Migrated ${decks.length} legacy deck(s); the original deck data was kept at ${backupPath}.`
      )
    } else {
      console.warn(
        `Unsupported deck data was moved to ${backupPath}; initialized a version ${DECK_FILE_VERSION} deck file.`
      )
    }
  }

  private async persist(decks: readonly Deck[]): Promise<void> {
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
