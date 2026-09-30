/**
 * Small information-set Monte Carlo tree used by the offline match planner.
 * Rewards always use the root player's perspective; selection changes sign at
 * opponent nodes so both seats choose their own best outcomes.
 */
export interface MctsCandidate<Action> {
  readonly key: string
  readonly action: Action
  /** Ordering hint only. Every legal action remains eligible as visits grow. */
  readonly prior: number
}

interface MctsEdge {
  visits: number
  valueSum: number
}

interface MctsNode {
  visits: number
  readonly edges: Map<string, MctsEdge>
}

export interface MctsSelection<Action> {
  readonly candidate: MctsCandidate<Action>
  readonly nodeKey: string
  readonly expanded: boolean
}

export interface MctsRootStat {
  readonly key: string
  readonly visits: number
  readonly meanValue: number
}

/** Shrinks noisy low-visit root values toward a neutral prior before choosing. */
export function mctsRootRecommendationScore(
  stat: Pick<MctsRootStat, 'visits' | 'meanValue'>,
  priorVisits = 4
): number {
  if (!Number.isSafeInteger(stat.visits) || stat.visits < 0)
    throw new RangeError('MCTS root visits must be a non-negative integer.')
  if (!Number.isFinite(stat.meanValue) || stat.meanValue < -1 || stat.meanValue > 1)
    throw new RangeError('MCTS root mean value must be finite and between -1 and 1.')
  if (!Number.isSafeInteger(priorVisits) || priorVisits < 1)
    throw new RangeError('MCTS root prior visits must be a positive integer.')
  return (stat.meanValue * stat.visits) / (stat.visits + priorVisits)
}

export class InformationSetMcts<Action> {
  private readonly nodes = new Map<string, MctsNode>()

  constructor(private readonly exploration = Math.SQRT2) {
    if (!Number.isFinite(exploration) || exploration <= 0)
      throw new RangeError('MCTS exploration must be a positive finite number.')
  }

  select(
    informationKey: string,
    legal: readonly MctsCandidate<Action>[],
    maximizing: boolean,
    minimumWidth = 1
  ): MctsSelection<Action> | null {
    if (!legal.length) return null
    if (!Number.isSafeInteger(minimumWidth) || minimumWidth < 1)
      throw new RangeError('MCTS minimum action width must be a positive integer.')
    let node = this.nodes.get(informationKey)
    if (!node) {
      node = { visits: 0, edges: new Map() }
      this.nodes.set(informationKey, node)
    }

    const ordered = [...legal].sort(
      (left, right) => right.prior - left.prior || left.key.localeCompare(right.key)
    )
    const width = Math.min(
      ordered.length,
      Math.max(minimumWidth, Math.ceil(1.5 * Math.sqrt(node.visits + 1)))
    )
    const eligible = ordered.slice(0, width)
    const unexpanded = eligible.find((candidate) => !node!.edges.has(candidate.key))
    const chosen = unexpanded ?? this.selectVisited(node, eligible, maximizing)
    if (!chosen) return null

    const expanded = !node.edges.has(chosen.key)
    if (expanded) node.edges.set(chosen.key, { visits: 0, valueSum: 0 })
    return { candidate: chosen, nodeKey: informationKey, expanded }
  }

  backup(path: readonly MctsSelection<Action>[], rootValue: number): void {
    if (!Number.isFinite(rootValue) || rootValue < -1 || rootValue > 1)
      throw new RangeError('MCTS root value must be finite and between -1 and 1.')
    for (const selection of path) {
      const node = this.nodes.get(selection.nodeKey)
      const edge = node?.edges.get(selection.candidate.key)
      if (!node || !edge) continue
      node.visits++
      edge.visits++
      edge.valueSum += rootValue
    }
  }

  rootStats(informationKey: string): readonly MctsRootStat[] {
    const node = this.nodes.get(informationKey)
    if (!node) return []
    return [...node.edges.entries()]
      .map(([key, edge]) => ({
        key,
        visits: edge.visits,
        meanValue: edge.visits ? edge.valueSum / edge.visits : 0
      }))
      .sort(
        (left, right) =>
          right.visits - left.visits ||
          right.meanValue - left.meanValue ||
          left.key.localeCompare(right.key)
      )
  }

  get nodeCount(): number {
    return this.nodes.size
  }

  private selectVisited(
    node: MctsNode,
    eligible: readonly MctsCandidate<Action>[],
    maximizing: boolean
  ): MctsCandidate<Action> | null {
    let best: MctsCandidate<Action> | null = null
    let bestScore = Number.NEGATIVE_INFINITY
    const sign = maximizing ? 1 : -1
    const maximumPrior = Math.max(...eligible.map((candidate) => candidate.prior))
    const priorWeights = eligible.map((candidate) =>
      Math.exp(Math.max(-30, (candidate.prior - maximumPrior) / 18))
    )
    const priorTotal = priorWeights.reduce((total, weight) => total + weight, 0)
    for (const candidate of eligible) {
      const edge = node.edges.get(candidate.key)
      if (!edge) continue
      const candidateIndex = eligible.indexOf(candidate)
      const prior = (priorWeights[candidateIndex] ?? 0) / Math.max(1e-9, priorTotal)
      const score =
        sign * (edge.visits ? edge.valueSum / edge.visits : 0) +
        (this.exploration * prior * Math.sqrt(node.visits + 1)) / (1 + edge.visits)
      if (
        score > bestScore ||
        (score === bestScore && candidate.key.localeCompare(best?.key ?? '') < 0)
      ) {
        best = candidate
        bestScore = score
      }
    }
    return best
  }
}
