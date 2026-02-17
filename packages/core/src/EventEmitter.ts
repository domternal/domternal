/**
 * Callback type for event handlers
 * - Events with payload: (data: T) => void
 * - Events without payload (undefined): () => void
 */
type EventCallback<T> = T extends undefined ? () => void : (data: T) => void;

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
export class EventEmitter<Events extends { [K in keyof Events]: unknown } = Record<string, never>> {
  // Protected so Editor subclass can access if needed
  protected callbacks = new Map<keyof Events, Set<EventCallback<unknown>>>();

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
   * Remove an event listener, or all listeners for an event if no callback specified
   */
  off<E extends keyof Events>(event: E, callback?: EventCallback<Events[E]>): this {
    const listeners = this.callbacks.get(event);

    if (listeners) {
      if (callback) {
        // Remove specific callback
        listeners.delete(callback as EventCallback<unknown>);

        // Clean up empty sets
        if (listeners.size === 0) {
          this.callbacks.delete(event);
        }
      } else {
        // Remove all listeners for this event
        this.callbacks.delete(event);
      }
    }

    return this;
  }

  /**
   * Emit an event to all registered listeners
   * Uses .call(this) to preserve context for callbacks
   */
  emit<E extends keyof Events>(
    event: E,
    ...args: Events[E] extends undefined ? [] : [Events[E]]
  ): this {
    const listeners = this.callbacks.get(event);

    if (listeners) {
      listeners.forEach((callback) => {
        if (args.length > 0) {
          (callback as (data: unknown) => void).call(this, args[0]);
        } else {
          (callback as () => void).call(this);
        }
      });
    }

    return this;
  }

  /**
   * Register an event listener that fires only once
   */
  once<E extends keyof Events>(event: E, callback: EventCallback<Events[E]>): this {
    const onceWrapper = ((...args: unknown[]) => {
      this.off(event, onceWrapper);

      if (args.length > 0) {
        (callback as (data: unknown) => void).call(this, args[0]);
      } else {
        (callback as () => void).call(this);
      }
    }) as EventCallback<Events[E]>;

    return this.on(event, onceWrapper);
  }

  /**
   * Remove all listeners for a specific event, or all events if no event specified
   */
  removeAllListeners(event?: keyof Events): this {
    if (event !== undefined) {
      this.callbacks.delete(event);
    } else {
      this.callbacks.clear();
    }

    return this;
  }

  /**
   * Get the number of listeners for a specific event
   */
  listenerCount(event: keyof Events): number {
    return this.callbacks.get(event)?.size ?? 0;
  }

  /**
   * Get all event names that have listeners
   */
  eventNames(): (keyof Events)[] {
    return Array.from(this.callbacks.keys());
  }
}
