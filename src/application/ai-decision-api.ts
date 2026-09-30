import {
  parseAiDecisionResponse,
  unwrapAiIpcResult,
  type AiDecisionApi,
  type AiDecisionBridge
} from '../desktop/contracts/ipc/ai'

/** Reconstruct errors only after crossing into the renderer's own context. */
export function createAiDecisionApi(bridge: AiDecisionBridge): AiDecisionApi {
  return {
    settings: () => bridge.settings(),
    cancel: (identity) => bridge.cancel(identity),
    ...(bridge.onProgress
      ? { onProgress: (listener) => bridge.onProgress!(listener) }
      : {}),
    decide: async (request) =>
      unwrapAiIpcResult(await bridge.decide(request), parseAiDecisionResponse)
  }
}
