export const PROTOCOL = Object.freeze({
  id: 'domternal-paste-overhead-v1', browsers: Object.freeze(['chromium', 'firefox', 'webkit']),
  formatting: Object.freeze(['preserve', 'adapt']), rounds: 3, warmupBlocks: 20, measuredBlocks: 100,
  viewport: Object.freeze({ width: 1280, height: 800 }), deviceScaleFactor: 1,
  blockTimeoutMs: 60_000, runTimeoutMs: 45 * 60_000,
});
export const SMOKE = Object.freeze({ rounds: 1, warmupBlocks: 1, measuredBlocks: 2 });
const raw = Object.freeze(['on-raw', 'off-raw', 'off-raw', 'on-raw']);
const normalized = Object.freeze(['on-raw', 'off-normalized', 'off-normalized', 'on-raw']);

export function blockPlan(index) {
  if (!Number.isSafeInteger(index) || index < 0 || index > 100) throw new Error('Invalid block index');
  const groups = [{ comparison: 'raw', routes: raw }, { comparison: 'normalized', routes: normalized }];
  return index % 2 === 0 ? groups : groups.reverse();
}

function durations(values) {
  if (!Array.isArray(values) || values.length !== 4 || values.some(value => !Number.isFinite(value) || value < 0 || value > PROTOCOL.blockTimeoutMs)) throw new Error('Invalid ABBA durations');
}

export function pairedDifferences(values) {
  durations(values);
  // Both individual tails remain visible; block averaging is secondary only.
  return Object.freeze([values[0] - values[1], values[3] - values[2]]);
}

export function statistics(values) {
  if (!Array.isArray(values) || values.length === 0 || values.length > 100_000 || values.some(value => !Number.isFinite(value))) throw new Error('Invalid sample set');
  const sorted = [...values].sort((left, right) => left - right);
  return Object.freeze({ count: values.length, min: sorted[0], p50: sorted[Math.ceil(0.5 * sorted.length) - 1],
    p95: sorted[Math.ceil(0.95 * sorted.length) - 1], max: sorted.at(-1) });
}

export function summarize(blocks) {
  if (!Array.isArray(blocks) || !blocks.length || blocks.length > 300) throw new Error('Invalid block count');
  for (const block of blocks) {
    if (!Array.isArray(block.groups) || block.groups.length !== 2) throw new Error('Incomplete comparison');
    const planned = blockPlan(block.index);
    for (let groupIndex = 0; groupIndex < planned.length; groupIndex++) {
      const group = block.groups[groupIndex];
      if (group.comparison !== planned[groupIndex].comparison || !Array.isArray(group.operations) || group.operations.length !== 4) throw new Error('Invalid comparison order');
      if (group.operations.some((operation, index) => operation.route !== planned[groupIndex].routes[index])) throw new Error('Invalid route order');
      if (group.operations.some(operation => operation.settledMs < operation.syncMs)) throw new Error('Invalid endpoint order');
    }
  }
  const result = {};
  for (const comparison of ['raw', 'normalized']) {
    const endpoints = {};
    for (const endpoint of ['syncMs', 'settledMs']) {
      const pairs = [];
      const means = [];
      const on = [];
      const off = [];
      for (const block of blocks) {
        const group = block.groups.find(group => group.comparison === comparison);
        const values = group.operations.map(operation => operation[endpoint]);
        const differences = pairedDifferences(values);
        pairs.push(...differences); means.push((differences[0] + differences[1]) / 2);
        on.push(values[0], values[3]); off.push(values[1], values[2]);
      }
      endpoints[endpoint] = Object.freeze({ pairedOverheadMs: statistics(pairs), blockMeanOverheadMs: statistics(means), onMs: statistics(on), offMs: statistics(off) });
    }
    result[comparison] = Object.freeze(endpoints);
  }
  return Object.freeze({ ...result, standaloneNormalizeMs: statistics(blocks.map(block => block.normalization.ms)) });
}
