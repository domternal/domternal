import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as FloatingUI from '@floating-ui/dom';
import { positionFloatingOnce } from './positionFloating.js';

const layout = vi.hoisted(() => ({
  pending: [] as ((value: { x: number; y: number }) => void)[],
  updates: [] as (() => void)[],
  cleanup: vi.fn(),
}));
vi.mock('@floating-ui/dom', async importOriginal => ({
  ...await importOriginal<typeof FloatingUI>(),
  computePosition: vi.fn(() => new Promise<{ x: number; y: number }>(resolve => { layout.pending.push(resolve); })),
  autoUpdate: vi.fn((_reference: unknown, _floating: unknown, update: () => void) => {
    layout.updates.push(update);
    update();
    return layout.cleanup;
  }),
}));
afterEach(() => {
  layout.pending.length = 0;
  layout.updates.length = 0;
  layout.cleanup.mockClear();
});

describe('positionFloatingOnce pending measurements', () => {
  it('does not write a measurement that completes after cleanup', async () => {
    const floating = document.createElement('div');
    floating.style.transform = 'translateX(7px)';
    const dispose = positionFloatingOnce(document.createElement('div'), floating);
    dispose();
    dispose();
    layout.pending[0]!({ x: 80, y: 90 });
    await Promise.resolve();
    expect(floating.style.transform).toBe('translateX(7px)');
    expect(layout.cleanup).toHaveBeenCalledOnce();
    layout.updates[0]!();
    expect(layout.pending).toHaveLength(1);
  });

  it('keeps the latest measurement when an older calculation completes last', async () => {
    const floating = document.createElement('div');
    const dispose = positionFloatingOnce(document.createElement('div'), floating);
    layout.updates[0]!();
    expect(layout.pending).toHaveLength(2);
    layout.pending[1]!({ x: 20.2, y: 30.7 });
    await Promise.resolve();
    expect(floating.style.transform).toBe('translate3d(20px,31px,0)');
    layout.pending[0]!({ x: 5, y: 6 });
    await Promise.resolve();
    expect(floating.style.transform).toBe('translate3d(20px,31px,0)');
    dispose();
  });
});
