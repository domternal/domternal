import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nService } from '../i18n/index.js';
import { observeI18nPresentation } from './observeI18nPresentation.js';
const cleanup: (() => void)[] = [];
let root: HTMLDivElement;
let input: HTMLInputElement;
let button: HTMLButtonElement;
beforeEach(() => {
  vi.useFakeTimers();
  root = document.createElement('div');
  input = document.createElement('input');
  button = document.createElement('button');
  root.append(input, button);
  document.body.append(root);
});
afterEach(() => {
  cleanup.splice(0).forEach((dispose) => {
    dispose();
  });
  root.remove();
  vi.useRealTimers();
});
function observe(update: () => void, getRoot = (): HTMLElement | null => root): I18nService {
  const i18n = new I18nService();
  cleanup.push(observeI18nPresentation(i18n, getRoot, update));
  return i18n;
}
function event(target: HTMLElement, name: string): void {
  target.dispatchEvent(new Event(name, { bubbles: true }));
}
describe('locale presentation interaction boundaries', () => {
  it('does not finish one root composition when another root dispatches compositionend', () => {
    const update = vi.fn();
    const i18n = observe(update);
    event(input, 'compositionstart');
    i18n.refresh();
    event(document.body, 'compositionend');
    vi.runAllTimers();
    expect(update).not.toHaveBeenCalled();
    event(input, 'compositionend');
    vi.runAllTimers();
    expect(update).toHaveBeenCalledOnce();
  });

  it('defers a locale change triggered by keyboard click activation', () => {
    const sequence: string[] = [];
    const i18n = observe(() => {
      sequence.push('locale');
    });
    button.addEventListener('click', () => {
      i18n.refresh();
      sequence.push('click');
    });
    button.click();
    expect(sequence).toEqual(['click']);
    vi.runAllTimers();
    expect(sequence).toEqual(['click', 'locale']);
  });

  it('updates immediately with no active interaction, including a root not yet mounted', () => {
    const update = vi.fn();
    const i18n = observe(update, () => null);
    i18n.set({ locale: 'hr' });
    expect(update).toHaveBeenCalledOnce();
  });
  it('coalesces composition changes and flushes after compositionend', () => {
    const update = vi.fn();
    const i18n = observe(update);
    event(input, 'compositionstart');
    i18n.set({ locale: 'hr' });
    i18n.set({ locale: 'de' });
    expect(update).not.toHaveBeenCalled();
    event(input, 'compositionend');
    expect(update).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(update).toHaveBeenCalledOnce();
  });
  it('retains the activation target until all click handlers finish', () => {
    const sequence: string[] = [];
    const i18n = observe(() => {
      sequence.push('locale');
    });
    button.addEventListener('click', () => {
      sequence.push('click');
    });
    event(button, 'pointerdown');
    i18n.set({ locale: 'hr' });
    event(button, 'pointerup');
    expect(sequence).toEqual([]);
    event(button, 'click');
    expect(sequence).toEqual(['click']);
    vi.runAllTimers();
    expect(sequence).toEqual(['click', 'locale']);
  });
  it.each(['pointerup', 'pointercancel'])(
    'flushes after %s outside the root even without a click',
    (end) => {
      const update = vi.fn();
      const i18n = observe(update);
      event(button, 'pointerdown');
      i18n.set({ locale: 'hr' });
      event(document.body, end);
      vi.runAllTimers();
      expect(update).toHaveBeenCalledOnce();
    }
  );
  it('waits for composition even if a pointer action ends first', () => {
    const update = vi.fn();
    const i18n = observe(update);
    event(input, 'compositionstart');
    event(button, 'pointerdown');
    i18n.refresh();
    event(button, 'pointerup');
    vi.runAllTimers();
    expect(update).not.toHaveBeenCalled();
    event(input, 'compositionend');
    vi.runAllTimers();
    expect(update).toHaveBeenCalledOnce();
  });
  it('isolates other roots and cancels subscriptions and queued callbacks on disposal', () => {
    const update = vi.fn();
    const otherUpdate = vi.fn();
    const i18n = observe(update);
    const other = observe(otherUpdate, () => null);
    event(button, 'pointerdown');
    i18n.refresh();
    other.refresh();
    expect(otherUpdate).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
    event(button, 'pointerup');
    cleanup.splice(0).forEach((dispose) => {
      dispose();
    });
    vi.runAllTimers();
    i18n.refresh();
    other.refresh();
    expect(update).not.toHaveBeenCalled();
    expect(otherUpdate).toHaveBeenCalledOnce();
  });
});
