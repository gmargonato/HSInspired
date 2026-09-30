/**
 * Serializes visual work without delaying authoritative game commands.
 *
 * A rejected/failed presentation must not strand later visual work, so the
 * internal tail always absorbs failures while callers still receive them.
 */
export class PresentationQueue {
  private tail: Promise<void> = Promise.resolve()
  private count = 0

  get busy(): boolean {
    return this.count > 0
  }

  enqueue<T>(work: () => Promise<T>): Promise<T> {
    this.count += 1
    const job = this.tail.then(work)
    this.tail = job.then(
      () => undefined,
      () => undefined
    )
    return job.finally(() => {
      this.count -= 1
    })
  }
}
