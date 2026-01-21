/**
 * Callback type for event handlers
 * - Events with payload: (data: T) => void
 * - Events without payload (void/undefined): () => void
 */
type EventCallback<T> = T extends void | undefined ? () => void : (data: T) => void;

/**
 * Generic, type-safe event emitter
 *
 * @example
 * ```typescript
 * interface MyEvents {
 *   update: { value: number };
 *   destroy: undefined;
 * }
 *
 * const emitter = new EventEmitter<MyEvents>();
 * emitter.on('update', ({ value }) => console.log(value));
 * emitter.on('destroy', () => console.log('destroyed'));
 * ```
 */
export class EventEmitter<Events extends Record<string, unknown>> {
  private callbacks: Map<keyof Events, Set<EventCallback<unknown>>> = new Map();

  /**
   * Register an event listener
   */
  on<E extends keyof Events>(event: E, callback: EventCallback<Events[E]>): this {
    const listeners = this.callbacks.get(event);

    if (listeners) {
      listeners.add(callback as EventCallback<unknown>);
    } else {
      this.callbacks.set(event, new Set([callback as EventCallback<unknown>]));
    }

    return this;
  }

  /**
   * Remove an event listener
   */
  off<E extends keyof Events>(event: E, callback: EventCallback<Events[E]>): this {
    const listeners = this.callbacks.get(event);

    if (listeners) {
      listeners.delete(callback as EventCallback<unknown>);

      // Clean up empty sets
      if (listeners.size === 0) {
        this.callbacks.delete(event);
      }
    }

    return this;
  }

  /**
   * Emit an event to all registered listeners
   */
  emit<E extends keyof Events>(
    event: E,
    ...args: Events[E] extends void | undefined ? [] : [Events[E]]
  ): this {
    // TODO: Implement in step 1.2.3
    return this;
  }

  /**
   * Register an event listener that fires only once
   */
  once<E extends keyof Events>(event: E, callback: EventCallback<Events[E]>): this {
    // TODO: Implement in step 1.2.4
    return this;
  }

  /**
   * Remove all listeners for a specific event, or all events if no event specified
   */
  removeAllListeners(event?: keyof Events): this {
    // TODO: Implement in step 1.2.4
    return this;
  }
}
