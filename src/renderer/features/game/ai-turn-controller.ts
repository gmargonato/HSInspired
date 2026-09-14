import { describeAiEvents } from '../../../game/match/ai/event-narrative'
import { enumerateLegalCommands, canonicalCommandKey } from '../../../game/match/ai'
import type { TurnMatchCommand, TurnMatchResult } from '../../../game/match'
import {
  AiRequestError,
  AI_REQUEST_LIMITS,
  AI_LOG_SCHEMA_VERSION,
  type AiDecisionApi,
  type AiDecisionIdentity,
  type AiDecisionResponse,
  type AiDecisionRequest,
  type AiMessage,
  type JsonObject
} from '../../../shared/ipc/ai'
import {
  AI_DELIBERATION_LIMITS,
  sameAiIntent,
  validateAiChoicePhase,
  type AiPlanNote
} from '../../../shared/ipc/ai-deliberation'
import { aiActionIntent } from './ai-action-intent'
import { answerAiChecks, aiDecisionFacts } from './ai-fact-checks'
import { observedAiCorrections } from './ai-feedback'
import {
  AI_PLAN_INSTRUCTION,
  AI_VERIFY_INSTRUCTION,
  AI_NEXT_INSTRUCTION,
  AI_COMMIT_INSTRUCTION,
  AI_INSPECT_INSTRUCTION
} from './ai-prompts'
import type { RendererLogger } from '../../ui/logger'
import type { GameBoardSession } from './game-board-session'
import type { MatchRecorder } from './match-recorder'
import {
  aiActions,
  aiActionFacts,
  aiJson,
  aiModelState,
  aiSystemContext
} from './ai-context'

// Byte limits bound payload size; they are not model token-window guarantees.
export const AI_CONVERSATION_LIMITS = {
  maxExchanges: 16,
  maxMessageBytes: AI_REQUEST_LIMITS.maxContextBytes
} as const
export interface AiActionDecision extends AiDecisionIdentity {
  readonly actionId: string
  readonly command: TurnMatchCommand
  readonly source: 'model' | 'forced' | 'random-timeout'
  readonly reason?: string
  readonly expectedResult?: string
}
export interface AiTurnControllerOptions {
  readonly recorder?: MatchRecorder
  readonly api?: AiDecisionApi
  readonly session: GameBoardSession
  readonly logger: RendererLogger
  readonly onFailure?: (message: string, retry?: () => void) => void
  readonly online?: () => boolean
}
export class AiTurnController {
  private readonly matchId = crypto.randomUUID()
  private readonly system: AiMessage
  private readonly unsubscribe: () => void
  private readonly unsubscribeProgress?: () => void
  private readonly exchanges: [AiMessage, AiMessage][] = []
  private sequence = 0
  private eventCursor = 0
  private disposed = false
  private failed = false
  private resumeWaiter?: (resumed: boolean) => void
  private pauseGeneration = 0
  private turnPlan?: { turn: number; note: AiPlanNote }
  private plannedTurn?: number
  private inspectionBudget = { turn: -1, used: 0, revisions: new Set<number>() }
  private maxMessageBytes: number = AI_REQUEST_LIMITS.maxContextBytes
  private trimmed = false
  private active: { identity: AiDecisionIdentity; cancel: () => void } | null = null
  private pending: Promise<AiActionDecision | null> | null = null
  private readonly actualResults: unknown[] = []
  private readonly outcomeReviews: JsonObject[] = []
  private endTurnReviewRevision?: number
  private readonly corrections: ReturnType<typeof observedAiCorrections> = {}

  private resetConversation(): void {
    this.exchanges.length = 0
    this.turnPlan = undefined
    this.plannedTurn = undefined
  }

  constructor(private readonly options: AiTurnControllerOptions) {
    this.system = aiSystemContext(options.session)
    this.unsubscribeProgress = options.api?.onProgress?.((progress) => {
      const identity = this.active?.identity
      if (
        identity &&
        progress.matchId === identity.matchId &&
        progress.requestId === identity.requestId &&
        progress.expectedRevision === identity.expectedRevision &&
        this.current(identity)
      )
        this.log('request-progress', progress)
    })
    this.unsubscribe = options.session.subscribe((result) => {
      if (
        this.active &&
        result.state.revision !== this.active.identity.expectedRevision
      )
        this.cancel('state changed')
    })
  }
  dispose(): void {
    this.disposed = true
    this.resumeWaiter?.(false)
    this.resumeWaiter = undefined
    this.cancel('match exited')
    this.unsubscribe()
    this.unsubscribeProgress?.()
    this.exchanges.length = 0
    this.actualResults.length = 0
    this.outcomeReviews.length = 0
  }
  private cancel(reason: string): void {
    const active = this.active
    if (!active) return
    this.active = null
    active.cancel()
    void this.options.api?.cancel(active.identity).catch(() => undefined)
    this.log(reason === 'state changed' ? 'request-superseded' : 'cancelled', {
      ...active.identity,
      reason
    })
  }
  private log(kind: string, data: unknown, failure = false): void {
    const snapshot = aiJson({
      schemaVersion: AI_LOG_SCHEMA_VERSION,
      matchId: this.matchId,
      turn: this.options.session.getState().turnNumber,
      ...aiJson(data)
    })
    this.options.logger[failure ? 'warn' : 'info']('[Game AI] ' + kind, snapshot)
    this.options.recorder?.record(
      'decisions',
      kind,
      snapshot,
      String(snapshot.requestId ?? '')
    )
  }
  private legalCommands(): readonly TurnMatchCommand[] {
    const match = this.options.session.match
    if (!match.getPlayInput || !match.getLegality)
      throw new Error('AI requires engine legality queries.')
    return enumerateLegalCommands(
      {
        getState: () => match.getState(),
        getPlayInput: match.getPlayInput,
        getLegality: match.getLegality
      },
      this.options.session.remoteParticipantId
    )
  }
  hasLegalActions(): boolean {
    return !this.disposed && !this.failed && this.legalCommands().length > 0
  }
  get isPaused(): boolean {
    return this.failed && !this.disposed
  }
  waitForResume(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false)
    if (!this.failed) return Promise.resolve(true)
    return new Promise((resolve) => {
      this.resumeWaiter = resolve
    })
  }
  chooseMulligan(): Promise<AiActionDecision | null> {
    return this.chooseTurnAction()
  }
  chooseTurnAction(): Promise<AiActionDecision | null> {
    if (this.pending) return this.pending
    this.pending = this.choose().finally(() => {
      this.pending = null
    })
    return this.pending
  }
  private current(identity: AiDecisionIdentity): boolean {
    return (
      !this.disposed &&
      !this.failed &&
      this.options.session.getState().revision === identity.expectedRevision
    )
  }
  /** All terminal failures stop automatic retries and produce one visible notice. */
  pause(error: unknown, identity?: AiDecisionIdentity): void {
    if (this.disposed || this.failed) return
    this.failed = true
    const generation = ++this.pauseGeneration
    this.cancel('AI paused')
    this.log(
      'failure',
      {
        ...(identity ?? {
          matchId: this.matchId,
          expectedRevision: this.options.session.getState().revision
        }),
        reason: error instanceof Error ? error.message : String(error),
        source: 'paused',
        ...(error instanceof AiRequestError ? { diagnostics: error.details } : {})
      },
      true
    )
    this.options.onFailure?.(
      'The AI couldn’t finish its turn. The match is paused.\nRetry AI to continue, or leave through the game menu.\nRetrying may incur another provider charge.',
      () => {
        if (this.disposed || !this.failed || generation !== this.pauseGeneration) return
        this.failed = false
        this.resetConversation()
        this.log('manual-retry', {
          reason: 'User requested a new decision from the current board.'
        })
        this.resumeWaiter?.(true)
        this.resumeWaiter = undefined
      }
    )
  }
  private messages(
    current: AiMessage,
    decision: readonly AiMessage[] = []
  ): AiMessage[] {
    const assemble = (): AiMessage[] => [
      this.system,
      ...this.exchanges.flat(),
      ...decision,
      current
    ]
    const bytes = (): number =>
      new TextEncoder().encode(JSON.stringify(assemble())).length
    let dropped = 0
    while (
      this.exchanges.length &&
      (this.exchanges.length > AI_CONVERSATION_LIMITS.maxExchanges ||
        bytes() > this.maxMessageBytes)
    ) {
      this.exchanges.shift()
      dropped++
    }
    if (dropped && !this.trimmed) {
      this.trimmed = true
      this.log('history-trim', { dropped, retained: this.exchanges.length })
    }
    // Never truncate current mechanics or legal actions to make a request fit.
    if (bytes() > this.maxMessageBytes)
      throw new Error('Current AI facts exceed the configured context allowance.')
    return assemble()
  }
  private async choose(freshContext = false): Promise<AiActionDecision | null> {
    if (this.disposed || this.failed) return null
    const session = this.options.session
    const identity = {
      matchId: this.matchId,
      requestId: this.matchId + ':' + this.sequence++,
      expectedRevision: session.getState().revision
    }
    const commands = this.legalCommands()
    if (!commands.length) {
      const state = session.getState()
      if (
        state.phase === 'turns' &&
        state.activePlayerId === session.remoteParticipantId &&
        !state.pendingResolution &&
        !state.pendingDiscover &&
        !state.pendingCardChoice
      )
        this.pause(new Error('Active AI has no legal inputs.'), identity)
      return null
    }
    const cursor = session.getAiEventCursor()
    Object.assign(
      this.corrections,
      observedAiCorrections(session.getAiEventsSince(this.eventCursor))
    )
    const events = describeAiEvents(
      session.getAiEventsSince(this.eventCursor),
      session.remoteParticipantId
    )
    let selected = commands[0]!
    let actionId = 'a0'
    let source: AiActionDecision['source'] = 'forced'
    let reason: string | undefined
    let expectedResult: string | undefined
    if (commands.length > 1) {
      let cancelled!: () => void
      const cancellation = new Promise<null>((resolve) => {
        cancelled = () => resolve(null)
      })
      this.active = { identity, cancel: cancelled }
      try {
        if (!this.options.api) throw new Error('AI API bridge unavailable.')
        if (!(
          this.options.online?.() ??
          (typeof navigator === 'undefined' || navigator.onLine !== false)
        ))
          throw new Error('Network is known offline.')
        const settings = await Promise.race([this.options.api.settings(), cancellation])
        if (!settings || !this.current(identity)) return null
        if (!settings.enabled) throw new Error('External game AI is disabled.')
        this.maxMessageBytes =
          settings.maxContextBytes ?? AI_REQUEST_LIMITS.maxContextBytes
        const actions = aiActions(session, commands)
        const history = session.getAiPublicHistory().recentEvents
        const retainedEvents = Array.isArray(history)
          ? history.filter((event): event is string => typeof event === 'string')
          : []
        const facts = {
          state: aiModelState(session, commands),
          eventsSincePreviousDecision: events,
          actualActionResults: [...this.actualResults],
          outcomeReviews: this.outcomeReviews,
          observedCorrections: Object.values(this.corrections),
          ...(this.exchanges.length === 0
            ? { recentPublicEvents: retainedEvents }
            : {}),
          actions: aiActionFacts(actions)
        }
        const decisionConversation: AiMessage[] = []
        const currentDecision = aiDecisionFacts(facts.state)
        const turn = session.getState().turnNumber
        if (this.turnPlan?.turn !== turn) this.turnPlan = undefined
        if (this.inspectionBudget.turn !== turn)
          this.inspectionBudget = { turn, used: 0, revisions: new Set() }
        let planning =
          this.plannedTurn !== turn &&
          session.getState().phase === 'turns' &&
          session.getState().activePlayerId === session.remoteParticipantId &&
          !session.getState().pendingDiscover &&
          !session.getState().pendingCardChoice
        let followup: JsonObject | undefined
        let repairCount = 0
        for (;;) {
          const allowInspection =
            !followup?.endTurnReview &&
            !freshContext &&
            !planning &&
            session.getState().phase === 'turns' &&
            !session.getState().pendingDiscover &&
            !session.getState().pendingCardChoice &&
            this.inspectionBudget.used < AI_DELIBERATION_LIMITS.extraExchangesPerTurn &&
            !this.inspectionBudget.revisions.has(identity.expectedRevision)
          const instruction = planning
            ? AI_PLAN_INSTRUCTION
            : (followup?.challenge ? AI_VERIFY_INSTRUCTION : AI_NEXT_INSTRUCTION) +
              '\n' +
              (allowInspection ? AI_INSPECT_INSTRUCTION : AI_COMMIT_INSTRUCTION)
          const user: AiMessage = {
            role: 'user',
            content: JSON.stringify({
              ...(followup ?? facts),
              currentDecision,
              actions: facts.actions,
              revision: identity.expectedRevision,
              ...(this.turnPlan ? { turnPlan: this.turnPlan.note } : {}),
              instruction
            })
          }
          const request: AiDecisionRequest & { messages: AiMessage[] } = {
            ...identity,
            phase: planning ? 'plan' : 'action',
            allowInspection,
            messages: this.messages(user, decisionConversation),
            actionIds: actions.map((action) => action.id)
          }
          if (
            new TextEncoder().encode(JSON.stringify(request.messages)).length >
            this.maxMessageBytes
          )
            throw new Error('AI request exceeds the configured context allowance.')
          this.log('request-started', {
            ...identity,
            ...settings,
            phase: request.phase,
            freshContext,
            allowInspection,
            extraExchangesUsed: this.inspectionBudget.used,
            actionCount: actions.length,
            actions,
            contextBytes: new TextEncoder().encode(JSON.stringify(request.messages))
              .length,
            retainedExchanges: this.exchanges.length,
            request
          })
          let response: AiDecisionResponse | null
          for (;;) {
            try {
              response = await Promise.race([
                this.options.api.decide(request),
                cancellation
              ])
              if (
                response &&
                this.current(identity) &&
                response.matchId === identity.matchId &&
                response.requestId === identity.requestId &&
                response.expectedRevision === identity.expectedRevision
              ) {
                try {
                  validateAiChoicePhase(response.choice, request)
                  if ('actionId' in response.choice) {
                    const selectedId = response.choice.actionId
                    const action = actions.find((a) => a.id === selectedId)
                    if (
                      !action ||
                      !sameAiIntent(
                        response.choice.intent,
                        aiActionIntent(action.command, session.localParticipantId)
                      )
                    )
                      throw new Error(
                        'Action ID and intent disagree. Selected ' +
                          selectedId +
                          ' resolves to ' +
                          JSON.stringify(
                            action
                              ? aiActionIntent(
                                  action.command,
                                  session.localParticipantId
                                )
                              : null
                          ) +
                          '; you returned ' +
                          JSON.stringify(response.choice.intent) +
                          '. Choose the intended current action ID and copy its exact intent, including its selected position.'
                      )
                  }
                } catch (error) {
                  throw new AiRequestError(
                    error instanceof Error ? error.message : String(error),
                    {
                      repairable: true,
                      failureKind: 'invalid-choice',
                      rejectedContent: JSON.stringify({
                        reason: response.reason,
                        choice: response.choice
                      }),
                      ...(response.usage ? { usage: response.usage } : {})
                    }
                  )
                }
              }
              break
            } catch (error) {
              if (!this.current(identity) || this.active?.identity !== identity)
                return null
              if (
                !(error instanceof AiRequestError) ||
                error.details?.repairable !== true
              )
                throw error
              this.log('response-rejected', {
                ...identity,
                repairCount,
                phase: request.phase,
                reason: error.message,
                diagnostics: error.details
              })
              if (repairCount >= 1 || freshContext) throw error
              repairCount++
              const instruction =
                'Your response failed validation: ' +
                error.message +
                '. Correct the format and reconsider any premise contradicted by current facts. Keep your intended choice only if it still makes sense. ' +
                'Return reason and exactly one choice matching the current response schema. Each text field is at most 600 characters; the choice is at most 8000 characters. ' +
                (planning
                  ? 'Return choice.plan with 1–2 candidates, at most 6 steps each, and 0–3 checks. '
                  : 'For a commit include actionId, matching intent, expectedResult and planUpdate (null if unchanged). ' +
                    (allowInspection
                      ? 'Inspection may contain 1–3 supported checks. '
                      : 'Inspection is unavailable. Commit now. ')) +
                'No extra fields or markdown. The board and available actions have not changed.'
              request.messages = [
                ...request.messages,
                {
                  role: 'assistant',
                  content: String(error.details.rejectedContent ?? '') || 'null'
                },
                {
                  role: 'user',
                  content: JSON.stringify({
                    instruction,
                    currentDecision,
                    actions: facts.actions,
                    revision: identity.expectedRevision
                  })
                }
              ]
              if (
                new TextEncoder().encode(JSON.stringify(request.messages)).length >
                this.maxMessageBytes
              )
                throw new AiRequestError(
                  'AI format correction exceeds the configured context allowance.',
                  { repairable: true, failureKind: 'invalid-choice' }
                )
              this.log('format-repair', {
                ...identity,
                repairCount,
                phase: request.phase,
                instruction,
                contextBytes: new TextEncoder().encode(JSON.stringify(request.messages))
                  .length
              })
            }
          }
          if (!response || !this.current(identity)) return null
          if (
            response.matchId !== identity.matchId ||
            response.requestId !== identity.requestId ||
            response.expectedRevision !== identity.expectedRevision
          ) {
            this.log('cancelled', { ...identity, reason: 'response identity mismatch' })
            return null
          }
          const reply = { choice: response.choice, reason: response.reason }
          if (planning) {
            if (!('plan' in response.choice))
              throw new Error('AI planning returned an executable choice.')
            const plan = response.choice.plan
            this.plannedTurn = turn
            const preferred = plan.candidates[plan.preferred]!
            this.turnPlan = {
              turn,
              note: {
                objective: plan.objective,
                continuation: preferred.sequence.join(' -> '),
                reconsiderIf: plan.lossRisk
              }
            }
            this.log('turn-plan', {
              ...response,
              phase: 'plan',
              repairCount
            })
            decisionConversation.push(user, {
              role: 'assistant',
              content: JSON.stringify(reply)
            })
            const proposed = actions.find((a) => a.id === plan.firstActionId)!
            const intent = aiActionIntent(proposed.command, session.localParticipantId)
            const relevantRefs = [
              ...new Set(
                [intent.source, ...intent.targets].filter(
                  (r): r is string => r !== null
                )
              )
            ]
            const information = answerAiChecks(
              plan.checks,
              facts.state,
              actions,
              retainedEvents,
              identity.expectedRevision
            )
            followup = aiJson({
              challenge: true,
              proposedAction: { id: proposed.id, move: proposed.description, intent },
              information,
              relevantFacts: answerAiChecks(
                relevantRefs.map((ref) => ({
                  topic: 'entity',
                  ref,
                  question: 'Which current facts govern this proposed action?',
                  decisionImpact:
                    'Recheck prerequisites and expected result before committing.'
                })),
                facts.state,
                actions,
                retainedEvents,
                identity.expectedRevision
              )
            })
            this.log('plan-challenge', { ...identity, ...followup })
            planning = false
            // Planning repairs must not consume the action phase's recovery budget.
            repairCount = 0
            continue
          }
          if ('plan' in response.choice)
            throw new Error('AI returned a plan instead of an action.')
          if ('inspect' in response.choice) {
            this.inspectionBudget.used++
            this.inspectionBudget.revisions.add(identity.expectedRevision)
            const information = answerAiChecks(
              response.choice.inspect,
              facts.state,
              actions,
              retainedEvents,
              identity.expectedRevision
            )
            this.log('fact-inspection', {
              ...response,
              information,
              extraExchangesUsed: this.inspectionBudget.used
            })
            decisionConversation.push(user, {
              role: 'assistant',
              content: JSON.stringify(reply)
            })
            followup = { challenge: true, information }
            continue
          }
          const action = actions.find(
            (action) =>
              action.id ===
              ('actionId' in response.choice ? response.choice.actionId : '')
          )
          if (!action) throw new Error('AI returned unknown action ID.')
          if (
            action.command.type === 'end-turn' &&
            currentDecision.self &&
            !freshContext &&
            this.endTurnReviewRevision !== identity.expectedRevision &&
            session.getState().phase === 'turns' &&
            actions.some((a) => a.command.type !== 'end-turn')
          ) {
            this.endTurnReviewRevision = identity.expectedRevision
            this.log('end-turn-review', { ...response, currentDecision })
            decisionConversation.push(user, {
              role: 'assistant',
              content: JSON.stringify(reply)
            })
            followup = {
              challenge: true,
              endTurnReview: true,
              instructionNote:
                'End Turn has not executed. Other current legal inputs exist and their costs are affordable now. Read self.mana (not opponent mana), and check any promised follow-up. Choose a useful current input, or confirm End Turn with a strategic reason for leaving those inputs unused. Spending mana is not mandatory. Do not assume an ID is stale: these IDs belong to this revision.'
            }
            continue
          }
          if (response.choice.planUpdate) {
            this.turnPlan = { turn, note: response.choice.planUpdate }
            this.log('plan-updated', { ...identity, turnPlan: this.turnPlan.note })
          }
          this.log('response-received', {
            ...response,
            repairCount,
            selectedAction: action,
            phase: 'action'
          })
          this.exchanges.push([
            {
              role: 'user',
              content: JSON.stringify({
                turn: session.getState().turnNumber,
                events,
                actualActionResults: facts.actualActionResults
              })
            },
            {
              role: 'assistant',
              content: JSON.stringify({
                move: action.description,
                status: 'Selected; actual outcomes follow in the public event feed.'
              })
            }
          ])
          this.messages({ role: 'user', content: '{}' })
          this.eventCursor = cursor
          session.acknowledgeAiEvents(cursor)
          this.actualResults.length = 0
          selected = action.command
          actionId = action.id
          source = 'model'
          reason = response.reason
          expectedResult = response.choice.expectedResult
          break
        }
      } catch (error) {
        if (!this.current(identity) || this.active?.identity !== identity) return null
        if (
          !freshContext &&
          error instanceof AiRequestError &&
          error.details?.repairable === true
        ) {
          this.log('fresh-context-retry', { ...identity, reason: error.message })
          this.resetConversation()
          this.active = null
          return this.choose(true)
        }
        if (
          error instanceof AiRequestError &&
          error.details?.failureKind === 'timeout'
        ) {
          const legal = this.legalCommands()
          if (!legal.length) return null
          const index = Math.floor(Math.random() * legal.length)
          selected = legal[index]!
          actionId = 'a' + index
          source = 'random-timeout'
          reason = 'Provider timed out; selected a current legal input at random.'
          this.turnPlan = undefined
          this.plannedTurn = undefined
          this.log('timeout-fallback', {
            ...identity,
            actionId,
            command: selected,
            source,
            reason,
            diagnostics: error.details
          })
        } else {
          this.pause(error, identity)
          return null
        }
      } finally {
        if (this.active?.identity === identity) this.active = null
      }
    }
    if (!this.current(identity)) return null
    if (this.options.recorder) this.options.recorder.decisionId = identity.requestId
    return {
      ...identity,
      actionId,
      command: selected,
      source,
      ...(reason ? { reason } : {}),
      ...(expectedResult ? { expectedResult } : {})
    }
  }
  /** Called immediately after the normal engine dispatch, before presentation. */
  recordExecution(decision: AiActionDecision, result: TurnMatchResult): void {
    const events =
      this.options.session.match.getPublicEvents?.(
        this.options.session.remoteParticipantId,
        result.events
      ) ?? []
    Object.assign(this.corrections, observedAiCorrections(events))
    if (decision.expectedResult && decision.command.type !== 'end-turn') {
      const observed = describeAiEvents(
        events,
        this.options.session.remoteParticipantId
      )
      this.outcomeReviews.push(
        aiJson({
          expectedRevision: decision.expectedRevision,
          predictionToCheck: decision.expectedResult,
          accepted: result.accepted,
          observed: observed
            .slice(-12)
            .map((event) =>
              event.length > 1000 ? event.slice(0, 1000) + ' [truncated]' : event
            ),
          omittedEarlierEvents: Math.max(0, observed.length - 12),
          interpretation:
            'Prediction is untrusted. Observations are what happened; do not repeat a contradicted forecast or infer a universal rule from one outcome.'
        })
      )
      if (this.outcomeReviews.length > 4) this.outcomeReviews.shift()
    }
    const actualResult = aiJson({
      ...decision,
      accepted: result.accepted,
      // Full public outcomes remain in the chronological event feed and disk log.
      ...(result.accepted ? {} : { code: result.code, message: result.message })
    })
    this.actualResults.push({
      source: decision.source,
      accepted: result.accepted,
      // Model moves already appear in the preceding assistant message.
      ...(decision.source === 'model' ? {} : { command: decision.command }),
      ...(result.accepted ? {} : { code: result.code, message: result.message })
    })
    if (this.actualResults.length > AI_CONVERSATION_LIMITS.maxExchanges) {
      this.actualResults.shift()
      if (!this.trimmed) {
        this.trimmed = true
        this.log('history-trim', {
          reason:
            'Older action results retained on disk; recent results and current facts remain in context.'
        })
      }
    }
    this.log(
      'action-executed',
      { ...actualResult, rawEvents: events },
      !result.accepted
    )
  }
  isCurrent(decision: AiActionDecision): boolean {
    return (
      this.current(decision) &&
      decision.matchId === this.matchId &&
      this.legalCommands().some(
        (command) =>
          canonicalCommandKey(command) === canonicalCommandKey(decision.command)
      )
    )
  }
}
