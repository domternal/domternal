/** Historical replay implementation with authored English variants. The retained checks are synthetic replays,
 * and archived native descriptions below refer to the original baseline, not to newly captured English bytes. */
/**
 * Every committed claimed native Office fixture, replayed into the real fixture editor in each engine and
 * policy: one paste event whose DataTransfer holds exactly the captured text flavors, in captured order. The
 * editor result is checked against the fixture's reviewed semantic oracle, which is authored from the content
 * specification: blocks, list structure and markers, marks, the notice and its codes. Pasted text must stay
 * readable against what it lands on, which white automatic color text was not: text without a color of its own
 * reaches 4.5:1 in the light theme and, after a switch, in the dark one; a color the source authored keeps 3:1
 * in the light theme, and where the dark theme takes it below 3:1 the run is annotated (owner question Q1).
 *
 * The event is synthetic, so this is not a native paste: no engine computes styles in the receiving page, and
 * a capture's blob: URLs are dead here. Chromium and Firefox parse Safari's HTML in these runs; that is no
 * evidence for their own rows, which receive the source application's HTML.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { Editor, JSONContent } from '@domternal/core';
import type { PasteOperationResult } from '@domternal/extension-paste-cleanup';
import { test } from './fixtures.js';
import type { EditorOutcome, PolicyOracle, SemanticExpected } from './native-office-capture/offline.mjs';
import type * as Offline from './native-office-capture/offline.mjs';
import type * as Semantics from './native-office-capture/semantics.mjs';

// The evidence modules are ES modules; a dynamic import loads them as such from this spec.
const evidence = async (): Promise<[typeof Semantics, typeof Offline]> =>
  Promise.all([import('./native-office-capture/semantics.mjs'), import('./native-office-capture/offline.mjs')]);

interface ProbeWindow {
  __pasteCleanup: { ready: boolean; editor: Editor; operations: PasteOperationResult[]; clearObservations: () => void };
}
interface Fixture { id: string; directory: string; expected: SemanticExpected | undefined; flavors: [string, string][] }
interface Run { text: string; ratio: number; authored: boolean }
interface Replay {
  operations: PasteOperationResult[];
  doc: JSONContent;
  notice: { visible: boolean; status: string | null };
  /** Each text run's contrast against what it lands on, in the light theme and after a switch to the dark one. */
  contrast: { light: Run[]; dark: Run[] };
  /** What the live editor schema holds: its mark types and the attributes of its textStyle mark. */
  destination: { marks: string[]; textStyle: string[] };
}

const FIXTURES = join(__dirname, 'native-office-capture', 'fixtures');
const policies = ['preserve', 'adapt'] as const;

/** The claimed native fixtures: version 2 manifests, whose oracles are authored from a content specification. */
function nativeFixtures(): Fixture[] {
  const fixtures: Fixture[] = [];
  for (const entry of readdirSync(FIXTURES, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(FIXTURES, entry.name);
    const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as { schemaVersion: number; id: string; origin: string; capture: { path: string }; expected: unknown };
    if (manifest.schemaVersion !== 2) continue;
    if (manifest.origin !== 'claimed-native' && manifest.origin !== 'synthetic') throw new Error(`${manifest.id}: unsupported semantic fixture provenance`);
    const bundle = JSON.parse(readFileSync(join(directory, manifest.capture.path), 'utf8')) as { payload: { availableFormats: string[]; text: Record<string, string> } };
    const flavors = bundle.payload.availableFormats.flatMap((format): [string, string][] => {
      const value = bundle.payload.text[format];
      return typeof value === 'string' ? [[format, value]] : [];
    });
    // A fixture whose outcomes are not authored yet fails its tests below instead of stopping the whole file;
    // the offline verifier checks the oracle's full shape.
    const expected = manifest.expected as Partial<SemanticExpected> | null;
    const authored = expected?.preserve?.editor !== undefined && expected.adapt?.editor !== undefined ? expected as SemanticExpected : undefined;
    fixtures.push({ id: manifest.id, directory, expected: authored, flavors });
  }
  return fixtures.sort((left, right) => left.id.localeCompare(right.id));
}

async function replay(page: Page, formatting: 'preserve' | 'adapt', schema: 'default' | 'capability-full', flavors: [string, string][], assets = false): Promise<Replay> {
  const query = new URLSearchParams({ framework: 'vanilla', formatting, 'list-markers': '1', ...(schema === 'default' ? {} : { schema }),
    ...(assets ? { assets: 'embedded' } : {}) });
  await page.goto(`http://127.0.0.1:5895/?${query.toString()}`);
  await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
  await page.evaluate(() => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    probe.editor.setContent('<p></p>', false);
    probe.editor.commands.focus('end');
    probe.clearObservations();
  });
  await page.evaluate(entries => {
    const data = new DataTransfer();
    for (const [format, value] of entries) data.setData(format, value);
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
    (window as unknown as ProbeWindow).__pasteCleanup.editor.view.dom.dispatchEvent(event);
  }, flavors);
  await page.waitForFunction(() => (window as unknown as ProbeWindow).__pasteCleanup.operations.length > 0);
  await page.evaluate(() => new Promise(resolve => { requestAnimationFrame(() => { requestAnimationFrame(resolve); }); }));
  const measure = (): Promise<Run[]> => page.evaluate(() => {
    const root = (window as unknown as ProbeWindow).__pasteCleanup.editor.view.dom;
    // WCAG relative luminance and contrast of each text run against the first painted background behind it.
    const channels = (value: string): number[] => (value.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = (value: string): number => {
      const [red = 0, green = 0, blue = 0] = channels(value).map(channel => {
        const part = channel / 255;
        return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const background = (element: Element | null): string => {
      for (let node = element; node !== null; node = node.parentElement) {
        const color = getComputedStyle(node).backgroundColor;
        if ((channels(color)[3] ?? 1) > 0) return color;
      }
      return 'rgb(255, 255, 255)';
    };
    // A run whose color the source authored: an inline color or a color token on it or an element around it in the document.
    const authored = (element: Element): boolean => {
      for (let node: Element | null = element; node !== null && node !== root; node = node.parentElement) {
        if (node instanceof HTMLElement && node.style.color !== '') return true;
        if (node.hasAttribute('data-text-color')) return true;
      }
      return false;
    };
    const runs: Run[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (!/\S/u.test(node.textContent ?? '') || node.parentElement === null) continue;
      const [lighter, darker] = [luminance(getComputedStyle(node.parentElement).color), luminance(background(node.parentElement))].sort((left, right) => right - left);
      runs.push({ text: (node.textContent ?? '').slice(0, 24), ratio: ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05), authored: authored(node.parentElement) });
    }
    return runs;
  });
  const light = await measure();
  // The same document after a runtime switch to the dark theme, as an application toggles it.
  await page.evaluate(() => new Promise(resolve => { document.body.classList.add('dm-theme-dark'); requestAnimationFrame(() => { requestAnimationFrame(resolve); }); }));
  const dark = await measure();
  await page.evaluate(() => { document.body.classList.remove('dm-theme-dark'); });
  return page.evaluate(({ light, dark }) => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    const notice = document.querySelector<HTMLElement>('.dm-paste-feedback');
    const textStyle = probe.editor.schema.marks['textStyle'];
    return {
      operations: probe.operations, doc: probe.editor.getJSON(), contrast: { light, dark },
      destination: { marks: Object.keys(probe.editor.schema.marks), textStyle: Object.keys(textStyle?.spec.attrs ?? {}) },
      notice: { visible: notice !== null && !notice.hidden && notice.getBoundingClientRect().height > 0,
        status: notice?.querySelector('.dm-paste-feedback__status')?.textContent ?? null },
    };
  }, { light, dark });
}

/** Text without a color of its own reaches 4.5:1 in both themes; an authored color keeps 3:1 in the light theme and is annotated below 3:1 in the dark one. */
function checkContrast(contrast: Replay['contrast']): void {
  const failing = (runs: Run[], floor: number): string[] => runs.filter(run => run.ratio < floor).map(run => `${run.text}: ${run.ratio.toFixed(2)}`);
  expect(failing(contrast.light.filter(run => !run.authored), 4.5)).toEqual([]);
  expect(failing(contrast.dark.filter(run => !run.authored), 4.5)).toEqual([]);
  expect(failing(contrast.light.filter(run => run.authored), 3)).toEqual([]);
  for (const finding of failing(contrast.dark.filter(run => run.authored), 3)) {
    test.info().annotations.push({ type: 'authored color below 3:1 in the dark theme', description: finding });
  }
}

const fixtures = nativeFixtures();

/** A policy oracle's editor outcomes, one per schema, as offline.mjs editorOutcomes reads them; synchronous for test titles. */
function editorOutcomesOf(oracle: PolicyOracle): readonly EditorOutcome[] {
  return Array.isArray(oracle.editor) ? oracle.editor as readonly EditorOutcome[] : [oracle.editor as EditorOutcome];
}

test('the native fixture directory holds claimed native fixtures to replay', () => {
  expect(fixtures.length).toBeGreaterThan(0);
});

for (const fixture of fixtures) {
  test.describe(fixture.id, () => {
    test('passes the offline evidence verifier', async ({ browserName }) => {
      test.skip(browserName !== 'chromium', 'The offline verifier runs in Node; one engine runs it.');
      const [, { verifyCaptureFixture }] = await evidence();
      const report = await verifyCaptureFixture(fixture.directory);
      expect(report.integrity.qualification).toBe(false);
      expect(report.replay.kind).toBe('offline-semantic-replay');
    });

    for (const formatting of policies) {
      // One test per destination schema the oracle pins the fixture in; a single schema keeps the plain title.
      const outcomes = fixture.expected === undefined ? [undefined] : editorOutcomesOf(fixture.expected[formatting]);
      for (const outcome of outcomes) {
        const schemaTitle = outcomes.length > 1 && outcome !== undefined ? ` in the ${outcome.schema} schema` : '';
        test(`${formatting}${schemaTitle}: pastes the reviewed blocks, notice and codes, readable`, async ({ page }) => {
          const expected = fixture.expected;
          if (expected === undefined || outcome === undefined) throw new Error(`${fixture.id} has no reviewed outcomes: author expected.preserve and expected.adapt`);
          const oracle = expected[formatting];
          const [{ blocksFromEditorJSON, compareBlocks }, { noticeCodes, semanticSpecification }] = await evidence();
          const result = await replay(page, formatting, outcome.schema, fixture.flavors);
          const operation = result.operations.at(-1);
          expect(operation?.status).toBe(oracle.status === 'cleaned' ? 'applied' : 'rejected');
          expect(operation?.source).toBe(oracle.source);
          expect(noticeCodes(operation?.diagnostics ?? [])).toEqual(outcome.warnings);
          expect(result.notice.visible).toBe(outcome.notice === 'visible');
          if (outcome.notice === 'visible') expect(result.notice.status).toBe('Review the pasted content.');
          // The oracle reads what the destination holds from the live schema: a mark it lacks is expected absent.
          expect(compareBlocks(semanticSpecification(expected), expected.scenario, blocksFromEditorJSON(result.doc),
            { formatting, destination: result.destination })).toEqual([]);
          // Text without a color of its own needs 4.5:1 (WCAG 1.4.3) against what it lands on, in either theme.
          checkContrast(result.contrast);
        });
      }

      // Image preparation refuses a paste whose image it cannot bind, so an image the capture holds must not be one it is offered.
      if (fixture.flavors.some(([format, value]) => format === 'text/html' && /<img\b/iu.test(value))) {
        test(`${formatting}: pastes the same with image preparation, which no marker picture reaches`, async ({ page }) => {
          const expected = fixture.expected;
          if (expected === undefined) throw new Error(`${fixture.id} has no reviewed outcomes`);
          const [outcome] = editorOutcomesOf(expected[formatting]);
          if (outcome === undefined) throw new Error(`${fixture.id} has no editor outcome`);
          const [{ blocksFromEditorJSON, compareBlocks }, { noticeCodes, semanticSpecification }] = await evidence();
          const result = await replay(page, formatting, outcome.schema, fixture.flavors, true);
          expect(result.operations.at(-1)?.status).toBe('applied');
          expect(noticeCodes(result.operations.at(-1)?.diagnostics ?? [])).toEqual(outcome.warnings);
          expect(compareBlocks(semanticSpecification(expected), expected.scenario, blocksFromEditorJSON(result.doc),
            { formatting, destination: result.destination })).toEqual([]);
        });
      }
    }
  });
}
