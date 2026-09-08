/** FIFO mutations whose individual failures do not poison later operations. */
export class SerialOperationQueue {
  private tail: Promise<void> = Promise.resolve()

  get settled(): Promise<void> {
    return this.tail
  }

  enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation, operation)
    this.tail = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }
}
