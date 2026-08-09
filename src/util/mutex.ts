/**
 * Serialises work per key. Two messages arriving from the same traveler in quick
 * succession must not run their extraction passes concurrently, or the second
 * one computes its state delta against a snapshot the first is about to replace.
 */
export class KeyedMutex {
  #chains = new Map<string, Promise<unknown>>()

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#chains.get(key) ?? Promise.resolve()

    // Run after the previous task settles, whether it resolved or rejected.
    const result = previous.then(task, task)

    // The queued chain must never reject, or the next waiter inherits the failure.
    const guarded = result.catch(() => undefined)
    this.#chains.set(key, guarded)

    try {
      return await result
    } finally {
      // Only the tail clears the entry, so the map doesn't grow without bound.
      if (this.#chains.get(key) === guarded) this.#chains.delete(key)
    }
  }
}
