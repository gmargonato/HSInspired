export const WINDOW_ATTENTION_CHANNEL = 'window-attention:set-highlighted'

export interface WindowAttentionApi {
  setHighlighted(highlighted: boolean): Promise<void>
}

export function parseWindowHighlighted(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new Error('Window attention highlight must be a boolean')
  }
  return value
}
