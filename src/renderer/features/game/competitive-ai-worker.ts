/// <reference lib="webworker" />

import type { AiSearchWorkerRequest } from '../../../game/match/ai/ai-types'
import { rankWorkerDossiers } from '../../../game/match/ai/worker-ranking'

const scope = self as DedicatedWorkerGlobalScope

scope.onmessage = (event: MessageEvent<AiSearchWorkerRequest>): void => {
  const request = event.data
  if (request?.type !== 'search') return
  scope.postMessage(rankWorkerDossiers(request))
}

export {}
