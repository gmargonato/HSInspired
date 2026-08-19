import { describe, expect, it, vi } from 'vitest'
import { AudioService, SOUND_EFFECT_URLS } from '../src/renderer/src/core/audio'

interface FakeAudioContext {
  context: AudioContext
  sources: Array<AudioBufferSourceNode>
  gain: GainNode
  decodeAudioData: ReturnType<typeof vi.fn>
  resume: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

function createFakeAudioContext(
  initialState: AudioContextState = 'running'
): FakeAudioContext {
  let state = initialState
  const sources: Array<AudioBufferSourceNode> = []
  const gain = {
    gain: { value: 0 },
    connect: vi.fn(),
    disconnect: vi.fn()
  } as unknown as GainNode
  const decodeAudioData = vi.fn(async () => ({ duration: 0.25 }) as AudioBuffer)
  const resume = vi.fn(async () => {
    state = 'running'
  })
  const close = vi.fn(async () => {
    state = 'closed'
  })
  const context = {
    get state() {
      return state
    },
    destination: {} as AudioDestinationNode,
    createGain: vi.fn(() => gain),
    decodeAudioData,
    createBufferSource: vi.fn(() => {
      const source = {
        buffer: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null
      } as unknown as AudioBufferSourceNode
      sources.push(source)
      return source
    }),
    resume,
    close
  } as unknown as AudioContext

  return { context, sources, gain, decodeAudioData, resume, close }
}

function createSuccessfulFetch() {
  return vi.fn(async (_url: string): Promise<Response> => {
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => new ArrayBuffer(4)
    } as Response
  })
}

describe('AudioService', () => {
  it('preloads every effect once and plays from decoded buffers without refetching', async () => {
    const fake = createFakeAudioContext()
    const fetcher = createSuccessfulFetch()
    const audio = new AudioService({
      contextFactory: () => fake.context,
      fetcher
    })

    await Promise.all([audio.preload(), audio.preload()])

    const effectCount = Object.keys(SOUND_EFFECT_URLS).length
    expect(fetcher).toHaveBeenCalledTimes(effectCount)
    expect(fake.decodeAudioData).toHaveBeenCalledTimes(effectCount)
    expect(fake.gain.connect).toHaveBeenCalledWith(fake.context.destination)

    audio.play('hub-click')

    expect(fetcher).toHaveBeenCalledTimes(effectCount)
    expect(fake.decodeAudioData).toHaveBeenCalledTimes(effectCount)
    expect(fake.sources).toHaveLength(1)
    expect(fake.sources[0]?.connect).toHaveBeenCalledWith(fake.gain)
    expect(fake.sources[0]?.start).toHaveBeenCalledOnce()

    await audio.dispose()
  })

  it('clamps master volume and resumes a suspended context before playback', async () => {
    const fake = createFakeAudioContext('suspended')
    const audio = new AudioService({
      contextFactory: () => fake.context,
      fetcher: createSuccessfulFetch()
    })

    audio.setMasterVolume(2)
    await audio.preload()
    expect(audio.getMasterVolume()).toBe(1)
    expect(fake.gain.gain.value).toBe(1)

    audio.setMasterVolume(-0.5)
    expect(audio.getMasterVolume()).toBe(0)
    expect(fake.gain.gain.value).toBe(0)

    audio.play('hub-mouseover')
    await vi.waitFor(() => expect(fake.sources).toHaveLength(1))

    expect(fake.resume).toHaveBeenCalledOnce()

    await audio.dispose()
  })

  it('keeps preload failures non-fatal and leaves the failed effect silent', async () => {
    const fake = createFakeAudioContext()
    const fetcher = createSuccessfulFetch()
    fetcher.mockImplementation(async (url: string) => {
      if (url === SOUND_EFFECT_URLS['back-click']) {
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found',
          arrayBuffer: async () => new ArrayBuffer(0)
        } as Response
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => new ArrayBuffer(4)
      } as Response
    })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const audio = new AudioService({
      contextFactory: () => fake.context,
      fetcher
    })

    await expect(audio.preload()).resolves.toBeUndefined()
    audio.play('back-click')
    audio.play('hub-click')

    expect(warning).toHaveBeenCalledWith(
      'Failed to preload sound effect "back-click":',
      expect.any(Error)
    )
    expect(fake.sources).toHaveLength(1)

    await audio.dispose()
  })
})
