import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { D4_TARGET_WORDS, generateLarge, LARGE_PROFILES, sizeForWords, token } from './large.mjs';
import { attributeBound, loadNormalizer, outputNodes, parserCounts, sweepProfile, tokensVerified } from './limits.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');

test('large profiles are deterministic, resource free and carry unique ordered tokens', () => {
  assert.deepEqual(LARGE_PROFILES, ['word-short-paragraphs', 'word-fragmented-runs', 'word-default-lists', 'word-table',
    'word-mixed-document', 'gdocs-document', 'heavily-formatted-runs']);
  for (const profile of LARGE_PROFILES) {
    const first = generateLarge(profile, 13);
    const second = generateLarge(profile, 13);
    assert.equal(first.html, second.html);
    assert.ok(Object.isFrozen(first) && Object.isFrozen(first.tokens) && Object.isFrozen(first.counts));
    assert.doesNotMatch(first.html, /<script|<img|<iframe|<link|\b(?:src|href)=|url\(|file:/iu);
    assert.equal(new Set(first.tokens).size, first.tokens.length);
    assert.ok(tokensVerified(first.html, first.tokens), profile);
    assert.equal(first.plain, first.tokens.join('\r\n'));
    assert.equal(first.utf16Units, first.html.length);
    assert.equal(first.utf8Bytes, Buffer.byteLength(first.html));
    assert.equal(first.words, 13 * generateLarge(profile, 1).words);
  }
});

test('large profiles keep their authored shapes and word counts', () => {
  const expected = {
    'word-short-paragraphs': [4, { paragraph: 1 }], 'word-fragmented-runs': [15, { paragraph: 1 }],
    'word-default-lists': [4, { listItem: 1 }], 'word-table': [9, { tableRow: 1, tableCell: 3, table: 1 }],
    'word-mixed-document': [79, { heading: 1, listItem: 3, table: 1, tableCell: 3 }],
    'gdocs-document': [15, { paragraph: 1 }], 'heavily-formatted-runs': [10, { paragraph: 1 }],
  };
  for (const [profile, [words, counts]] of Object.entries(expected)) {
    const fixture = generateLarge(profile, 1);
    assert.equal(fixture.words, words, profile);
    assert.deepEqual(fixture.counts, counts, profile);
    assert.equal(sizeForWords(profile), Math.ceil(D4_TARGET_WORDS / words));
  }
  assert.equal(generateLarge('word-default-lists', 12).html.match(/mso-list:l[01] level[1-3]/g)?.length, 12);
  assert.match(generateLarge('word-short-paragraphs', 1).html, /@list l0:level9/u);
  assert.match(generateLarge('gdocs-document', 1).html, /id="docs-internal-guid-/u);
});

test('large profile sources are pinned so recorded measurements stay reproducible', () => {
  const pinned = Object.fromEntries(LARGE_PROFILES.map(profile => [profile, sha256(generateLarge(profile, 100).html)]));
  assert.deepEqual(pinned, PINNED);
});

test('large profiles reject unknown names and invalid sizes', () => {
  assert.throws(() => generateLarge('unknown', 1));
  assert.throws(() => generateLarge('constructor', 1));
  for (const size of [0, -1, 1.5, 200_001, Number.NaN]) assert.throws(() => generateLarge('gdocs-document', size));
  assert.equal(token(7), 'Q000007x');
});

test('token verification refuses missing, duplicated and reordered tokens', () => {
  const tokens = [token(1), token(2), token(3)];
  assert.ok(tokensVerified(`<p>${tokens.join(' ')}</p>`, tokens));
  assert.equal(tokensVerified(`<p>${tokens[0]} ${tokens[2]}</p>`, tokens), false);
  assert.equal(tokensVerified(`<p>${tokens.join(' ')} ${tokens[1]}</p>`, tokens), false);
  assert.equal(tokensVerified(`<p>${tokens[1]} ${tokens[0]} ${tokens[2]}</p>`, tokens), false);
});

test('bound attribution follows the order the normalizer checks', () => {
  const limits = { maxInputLength: 100, maxNodes: 10, maxDepth: 5, maxTableCells: 3 };
  const counts = { allocations: 1, depth: 1, tableCells: 0 };
  assert.equal(attributeBound(counts, 101, limits), 'input-length');
  assert.equal(attributeBound({ ...counts, allocations: 11 }, 50, limits), 'parser-allocations');
  assert.equal(attributeBound({ ...counts, depth: 6 }, 50, limits), 'depth');
  assert.equal(attributeBound({ ...counts, tableCells: 4 }, 50, limits), 'table-cells');
  assert.equal(attributeBound(counts, 50, limits), 'generated-output');
});

// These checks read the built public /html entry, like the sweep itself.
test('independent parser counts match the bounded parser at its exact allocation limit', () => {
  const tools = loadNormalizer();
  for (const profile of LARGE_PROFILES) {
    const html = generateLarge(profile, 4).html;
    const counts = parserCounts(tools.parse5, html);
    assert.ok(counts.textNodes <= counts.textInsertions && counts.styleTextInsertions < counts.textInsertions);
    const below = tools.normalizePasteHTML(html, { limits: { maxNodes: counts.allocations - 1 } });
    assert.equal(below.status, 'rejected', profile);
    assert.deepEqual(below.diagnostics.map(entry => entry.code), ['structure-limit']);
    const at = tools.normalizePasteHTML(html, { limits: { maxNodes: counts.allocations } });
    // Wrapping every word in generated marks and typography makes the output tree the first bound there.
    if (profile === 'heavily-formatted-runs') {
      assert.equal(at.status, 'rejected');
      const output = tools.normalizePasteHTML(html);
      assert.ok(outputNodes(tools.parse5, output.html) > counts.allocations);
    } else {
      assert.equal(at.status, 'cleaned', profile);
      assert.ok(outputNodes(tools.parse5, at.html) > 1);
    }
  }
});

test('the sweep finds an accepted maximum next to an explicit rejection with verified tokens', () => {
  const tools = loadNormalizer();
  const bounded = { ...tools, normalizePasteHTML: (html, options) => tools.normalizePasteHTML(html, { ...options, limits: { maxNodes: 2_000 } }),
    limits: { ...tools.limits, maxNodes: 2_000 } };
  const result = sweepProfile(bounded, 'gdocs-document', 'preserve');
  assert.equal(result.firstRejected.size, result.maxAccepted.size + 1);
  assert.equal(result.maxAccepted.status, 'cleaned');
  assert.equal(result.maxAccepted.tokensVerified, true);
  assert.equal(result.firstRejected.status, 'rejected');
  assert.equal(result.firstRejected.code, 'structure-limit');
  assert.equal(result.firstRejected.bound, 'parser-allocations');
  assert.equal(result.firstRejected.emptyOutput, true);
  assert.ok(result.maxAccepted.parser.allocations <= 2_000 && result.firstRejected.parser.allocations > 2_000);
});

const PINNED = {
  'word-short-paragraphs': 'ced2dfb441509f02973b549dbd9bb5d090821eaad512f3c9ca6785af5464d553',
  'word-fragmented-runs': '417473512e24b6cf2d50e428333d750310ecf6467887cc0070704c26152580ca',
  'word-default-lists': '6f05dfc88c43964f5098c1ad4bbba97914394654d06e6627b9312cba6ddc0534',
  'word-table': 'd913dbf6c747d860ab4b7542f2bc8be10b0cb6f19aabdc7426e691435186406f',
  'word-mixed-document': '1fa6e0bb3e8534ce7d70034a60dad94e7affde7b0be9d4023e32ff4982e4d9dd',
  'gdocs-document': '252ec580adef47c7cb8ad86194448e79583c39f7610afb920fce841b66c52e23',
  'heavily-formatted-runs': 'dfea3013075a08b1cbb5a1672a91e8bc32d80c74fb74064ab34e32ec8022d93d',
};
