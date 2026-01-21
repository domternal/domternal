import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from './EventEmitter.js';

// Test event types
interface TestEvents {
  update: { value: number };
  change: { oldValue: string; newValue: string };
  destroy: undefined;
}

describe('EventEmitter', () => {
  describe('on()', () => {
    it('registers callback and calls it on emit', () => {
      const emitter = new EventEmitter<TestEvents>();
      const callback = vi.fn();

      emitter.on('update', callback);
      emitter.emit('update', { value: 42 });

      expect(callback).toHaveBeenCalledWith({ value: 42 });
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('supports multiple listeners on same event', () => {
      const emitter = new EventEmitter<TestEvents>();
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      emitter.on('update', callback1);
      emitter.on('update', callback2);
      emitter.emit('update', { value: 10 });

      expect(callback1).toHaveBeenCalledWith({ value: 10 });
      expect(callback2).toHaveBeenCalledWith({ value: 10 });
    });

    it('returns this for chaining', () => {
      const emitter = new EventEmitter<TestEvents>();
      const result = emitter.on('update', vi.fn());

      expect(result).toBe(emitter);
    });
  });

  describe('off()', () => {
    it('removes callback so it is not called on emit', () => {
      const emitter = new EventEmitter<TestEvents>();
      const callback = vi.fn();

      emitter.on('update', callback);
      emitter.off('update', callback);
      emitter.emit('update', { value: 42 });

      expect(callback).not.toHaveBeenCalled();
    });

    it('only removes the specified callback', () => {
      const emitter = new EventEmitter<TestEvents>();
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      emitter.on('update', callback1);
      emitter.on('update', callback2);
      emitter.off('update', callback1);
      emitter.emit('update', { value: 42 });

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledWith({ value: 42 });
    });

    it('returns this for chaining', () => {
      const emitter = new EventEmitter<TestEvents>();
      const result = emitter.off('update', vi.fn());

      expect(result).toBe(emitter);
    });
  });

  describe('emit()', () => {
    it('calls all registered callbacks with correct data', () => {
      const emitter = new EventEmitter<TestEvents>();
      const callback = vi.fn();

      emitter.on('change', callback);
      emitter.emit('change', { oldValue: 'a', newValue: 'b' });

      expect(callback).toHaveBeenCalledWith({ oldValue: 'a', newValue: 'b' });
    });

    it('handles events with undefined payload (no arguments)', () => {
      const emitter = new EventEmitter<TestEvents>();
      const callback = vi.fn();

      emitter.on('destroy', callback);
      emitter.emit('destroy');

      expect(callback).toHaveBeenCalledWith();
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('does nothing if no listeners registered', () => {
      const emitter = new EventEmitter<TestEvents>();

      // Should not throw
      expect(() => emitter.emit('update', { value: 42 })).not.toThrow();
    });

    it('returns this for chaining', () => {
      const emitter = new EventEmitter<TestEvents>();
      const result = emitter.emit('update', { value: 42 });

      expect(result).toBe(emitter);
    });
  });

  describe('once()', () => {
    it('fires callback only once', () => {
      const emitter = new EventEmitter<TestEvents>();
      const callback = vi.fn();

      emitter.once('update', callback);
      emitter.emit('update', { value: 1 });
      emitter.emit('update', { value: 2 });
      emitter.emit('update', { value: 3 });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith({ value: 1 });
    });

    it('works with undefined payload events', () => {
      const emitter = new EventEmitter<TestEvents>();
      const callback = vi.fn();

      emitter.once('destroy', callback);
      emitter.emit('destroy');
      emitter.emit('destroy');

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('returns this for chaining', () => {
      const emitter = new EventEmitter<TestEvents>();
      const result = emitter.once('update', vi.fn());

      expect(result).toBe(emitter);
    });
  });

  describe('removeAllListeners()', () => {
    it('removes all listeners for a specific event', () => {
      const emitter = new EventEmitter<TestEvents>();
      const updateCallback = vi.fn();
      const changeCallback = vi.fn();

      emitter.on('update', updateCallback);
      emitter.on('change', changeCallback);
      emitter.removeAllListeners('update');

      emitter.emit('update', { value: 42 });
      emitter.emit('change', { oldValue: 'a', newValue: 'b' });

      expect(updateCallback).not.toHaveBeenCalled();
      expect(changeCallback).toHaveBeenCalled();
    });

    it('removes all listeners for all events when no argument', () => {
      const emitter = new EventEmitter<TestEvents>();
      const updateCallback = vi.fn();
      const changeCallback = vi.fn();

      emitter.on('update', updateCallback);
      emitter.on('change', changeCallback);
      emitter.removeAllListeners();

      emitter.emit('update', { value: 42 });
      emitter.emit('change', { oldValue: 'a', newValue: 'b' });

      expect(updateCallback).not.toHaveBeenCalled();
      expect(changeCallback).not.toHaveBeenCalled();
    });

    it('returns this for chaining', () => {
      const emitter = new EventEmitter<TestEvents>();
      const result = emitter.removeAllListeners();

      expect(result).toBe(emitter);
    });
  });

  describe('chaining', () => {
    it('supports full method chaining', () => {
      const emitter = new EventEmitter<TestEvents>();
      const callback = vi.fn();

      emitter
        .on('update', callback)
        .on('change', vi.fn())
        .emit('update', { value: 100 })
        .off('change', vi.fn())
        .removeAllListeners('change');

      expect(callback).toHaveBeenCalledWith({ value: 100 });
    });
  });
});
