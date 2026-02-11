import { describe, it, expect } from 'vitest';
import { callOrReturn } from './callOrReturn.js';

describe('callOrReturn', () => {
  it('returns the value when not a function', () => {
    expect(callOrReturn('hello', null)).toBe('hello');
  });

  it('returns number values directly', () => {
    expect(callOrReturn(42, null)).toBe(42);
  });

  it('returns object values directly', () => {
    const obj = { key: 'value' };
    expect(callOrReturn(obj, null)).toBe(obj);
  });

  it('returns array values directly', () => {
    const arr = [1, 2, 3];
    expect(callOrReturn(arr, null)).toBe(arr);
  });

  it('returns null directly', () => {
    expect(callOrReturn(null, null)).toBeNull();
  });

  it('returns undefined directly', () => {
    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
    const result = callOrReturn(undefined, null);
    expect(result).toBeUndefined();
  });

  it('calls function and returns result', () => {
    const fn = (): string => 'result';
    expect(callOrReturn(fn, null)).toBe('result');
  });

  it('calls function with correct this context', () => {
    const context = { name: 'test' };
    const fn = function (this: { name: string }): string {
      return this.name;
    };
    expect(callOrReturn(fn, context)).toBe('test');
  });

  it('passes additional arguments to function', () => {
    const fn = (_a: unknown, _b: unknown): string => `${String(_a)}-${String(_b)}`;
    expect(callOrReturn(fn, null, 'x', 'y')).toBe('x-y');
  });

  it('works with this context and arguments together', () => {
    const context = { prefix: 'Hello' };
    const fn = function (this: { prefix: string }, name: unknown): string {
      return `${this.prefix} ${String(name)}`;
    };
    expect(callOrReturn(fn, context, 'World')).toBe('Hello World');
  });

  it('returns boolean values directly', () => {
    expect(callOrReturn(true, null)).toBe(true);
    expect(callOrReturn(false, null)).toBe(false);
  });
});
