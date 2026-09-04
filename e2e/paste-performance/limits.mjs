#!/usr/bin/env node
/**
 * Node limit sweep over the public `/html` build. For each large profile and policy it finds the
 * largest accepted size and the first rejected size by exponential and binary search, verifies
 * every authored token of the accepted output, and attributes the rejection with counts that are
 * computed independently of the normalizer. Limits are measured, never changed here.
 */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { D4_TARGET_WORDS, generateLarge, LARGE_PROFILES, sizeForWords } from './large.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const cleanupRequire = createRequire(join(root, 'packages/extension-paste-cleanup/package.json'));
const TOKEN = /Q[0-9]{6}x/g;
const MAX_SIZE = 200_000;

/** The public build under measurement and its parser, loaded once. */
export function loadNormalizer() {
  const { normalizePasteHTML, DEFAULT_PASTE_HTML_LIMITS } = cleanupRequire('@domternal/extension-paste-cleanup/html');
  const parse5 = cleanupRequire('parse5');
  return { normalizePasteHTML, limits: DEFAULT_PASTE_HTML_LIMITS, parse5 };
}

/**
 * Count what the bounded parser counts, the same way: one allocation per created element or
 * comment and per text insertion call. Text insertions that extend an existing text node are
 * reported separately, together with the stylesheet share and the resulting tree shape.
 */
export function parserCounts(parse5, html) {
  const { defaultTreeAdapter, parseFragment } = parse5;
  const counts = { allocations: 0, elements: 0, comments: 0, textInsertions: 0, textNodes: 0, styleTextInsertions: 0, tableCells: 0, depth: 0 };
  const insert = (parent, text, reference) => {
    counts.allocations++; counts.textInsertions++;
    if (parent.nodeName === 'style') counts.styleTextInsertions++;
    const siblings = parent.childNodes;
    const previous = reference === undefined ? siblings.at(-1) : siblings[siblings.indexOf(reference) - 1];
    if (previous?.nodeName !== '#text') counts.textNodes++;
    if (reference === undefined) defaultTreeAdapter.insertText(parent, text);
    else defaultTreeAdapter.insertTextBefore(parent, text, reference);
  };
  const adapter = {
    ...defaultTreeAdapter,
    createElement(...args) {
      counts.allocations++; counts.elements++;
      if (args[0] === 'td' || args[0] === 'th') counts.tableCells++;
      return defaultTreeAdapter.createElement(...args);
    },
    createCommentNode(...args) { counts.allocations++; counts.comments++; return defaultTreeAdapter.createCommentNode(...args); },
    insertText(parent, text) { insert(parent, text); },
    insertTextBefore(parent, text, reference) { insert(parent, text, reference); },
  };
  const fragment = parseFragment(html, { treeAdapter: adapter });
  const pending = [{ node: fragment, depth: 0 }];
  while (pending.length > 0) {
    const { node, depth } = pending.pop();
    counts.depth = Math.max(counts.depth, depth);
    for (const child of node.childNodes ?? []) pending.push({ node: child, depth: depth + 1 });
  }
  return counts;
}

/** Node count of a parsed HTML fragment, the output tree the normalizer bounds. */
export function outputNodes(parse5, html) {
  let nodes = 1;
  const pending = [parse5.parseFragment(html)];
  while (pending.length > 0) {
    const node = pending.pop();
    for (const child of node.childNodes ?? []) { nodes++; pending.push(child); }
  }
  return nodes;
}

/** True when the output contains exactly the authored tokens, each once and in order. */
export function tokensVerified(output, tokens) {
  const found = output.match(TOKEN) ?? [];
  return found.length === tokens.length && found.every((value, index) => value === tokens[index]);
}

/** The first bound a rejected input exceeds, from counts independent of the normalizer. */
export function attributeBound(counts, utf16Units, limits) {
  if (utf16Units > limits.maxInputLength) return 'input-length';
  if (counts.allocations > limits.maxNodes) return 'parser-allocations';
  if (counts.depth > limits.maxDepth) return 'depth';
  if (counts.tableCells > limits.maxTableCells) return 'table-cells';
  return 'generated-output';
}

function severities(result) {
  const counts = { info: 0, warning: 0, error: 0 };
  for (const entry of result.diagnostics) counts[entry.severity]++;
  return counts;
}

function describe(tools, profile, formatting, size, timing = false) {
  const fixture = generateLarge(profile, size);
  let start = performance.now();
  const result = tools.normalizePasteHTML(fixture.html, { formatting });
  const times = [performance.now() - start];
  if (timing) {
    for (let repeat = 0; repeat < 4; repeat++) {
      start = performance.now();
      tools.normalizePasteHTML(fixture.html, { formatting });
      times.push(performance.now() - start);
    }
  }
  times.sort((left, right) => left - right);
  const counts = parserCounts(tools.parse5, fixture.html);
  const record = {
    size, words: fixture.words, blocks: size, tokens: fixture.tokens.length, utf16Units: fixture.utf16Units, utf8Bytes: fixture.utf8Bytes,
    parser: counts, status: result.status, diagnostics: severities(result), truncated: result.diagnosticsTruncated,
    normalizeMs: Number(times[Math.floor(times.length / 2)].toFixed(1)),
  };
  if (result.status === 'cleaned') {
    record.tokensVerified = tokensVerified(result.html, fixture.tokens);
    record.outputNodes = outputNodes(tools.parse5, result.html);
    record.outputUtf16Units = result.html.length;
  } else {
    const errors = result.diagnostics.filter(entry => entry.severity === 'error');
    record.code = errors.length === 1 ? errors[0].code : 'invalid-rejection';
    record.bound = attributeBound(counts, fixture.utf16Units, tools.limits);
    record.emptyOutput = result.html === '';
  }
  return record;
}

/** Largest accepted and first rejected size for one profile and policy. Acceptance is monotone in size. */
export function sweepProfile(tools, profile, formatting) {
  const accepts = size => tools.normalizePasteHTML(generateLarge(profile, size).html, { formatting }).status === 'cleaned';
  let accepted = 0;
  let rejected;
  for (let size = 1; size <= MAX_SIZE; size *= 2) {
    if (!accepts(size)) { rejected = size; break; }
    accepted = size;
  }
  if (rejected === undefined) throw new Error(`${profile} was accepted beyond the sweep ceiling`);
  if (accepted === 0) throw new Error(`${profile} is rejected at one block`);
  while (rejected - accepted > 1) {
    const middle = Math.floor((accepted + rejected) / 2);
    if (accepts(middle)) accepted = middle; else rejected = middle;
  }
  const target = sizeForWords(profile, D4_TARGET_WORDS);
  return {
    profile, formatting, unit: generateLarge(profile, 1).unit,
    maxAccepted: describe(tools, profile, formatting, accepted, true),
    firstRejected: describe(tools, profile, formatting, rejected),
    d4Target: target === accepted || target === rejected ? { size: target, sameAs: target === accepted ? 'maxAccepted' : 'firstRejected' }
      : describe(tools, profile, formatting, target),
  };
}

export function sweepAll(tools = loadNormalizer(), onProgress = () => undefined) {
  const results = [];
  for (const profile of LARGE_PROFILES) for (const formatting of ['preserve', 'adapt']) {
    results.push(sweepProfile(tools, profile, formatting));
    onProgress(results.at(-1));
  }
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const results = sweepAll(loadNormalizer(), result => {
    process.stderr.write(`${result.profile} ${result.formatting}: max ${String(result.maxAccepted.size)} (${String(result.maxAccepted.words)} words), `
      + `first rejected ${String(result.firstRejected.size)} ${result.firstRejected.code} ${result.firstRejected.bound}\n`);
  });
  process.stdout.write(`${JSON.stringify({ kind: 'domternal-paste-limit-sweep', d4TargetWords: D4_TARGET_WORDS, results }, null, 2)}\n`);
}
