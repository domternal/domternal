/**
 * Which marker a list paints at which nesting level.
 *
 * Both Pro exporters pick theirs from the same three-step cycle, keyed on the
 * list's depth: bullets run disc, circle, square and numbers run 1., a., i.
 * The theme never declared `list-style-type` at all, so inside the editor the
 * browser's own sheet answered instead, and it answers differently: it
 * plateaus at square from the fourth bullet level down and numbers every
 * ordered level `1.`. One document therefore carried three marker schemes at
 * once. A level-4 bullet was a disc in the .docx and the .pdf and a square in
 * the editor and on paper; a level-2 ordered item was `a.` in the files and
 * `1.` on screen.
 *
 * The level travels down by inheritance in `--dm-list-level` rather than being
 * counted by a chain of descendant selectors, because a chain has to stop at
 * some depth and then plateaus one level below wherever it stopped, which is
 * the defect being removed, and because it cannot express the one place the
 * exporters restart the count: a table cell.
 *
 * Everything here is a computed `list-style-type` read. That makes the suite
 * framework-independent and engine-portable, and it measures the cascade
 * itself rather than a screenshot of it. The cycle is not a print rule: it
 * belongs to the editor, so most of these run with no media emulation at all,
 * and the one printed case exists to prove the paper agrees with the screen
 * rather than carrying a second scheme of its own.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';
import { demoTargets, type DemoTarget } from './targets.js';

const EDITOR = '.dm-editor .ProseMirror';

interface DemoEditor {
  setContent: (html: string, emit: boolean) => void;
}

// Deliberately the same two helpers the print spec carries rather than an
// import from it: a spec file is not a module other specs build on, and a
// shared helper that changes for one suite's reasons breaks the other's.
async function openDemo(page: Page, target: DemoTarget): Promise<void> {
  await page.goto(target.baseURL + '/');
  await page.waitForSelector(EDITOR);
  await page.waitForFunction(
    () => Boolean((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__']),
    { timeout: 5000 },
  );
}

async function setContent(page: Page, html: string): Promise<void> {
  await page.evaluate((content) => {
    const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | DemoEditor
      | undefined;
    editor?.setContent(content, false);
  }, html);
  // Node views for tables mount on the next frame.
  await page.waitForTimeout(150);
}

/** The marker of every list in the document, in document order. */
async function markersOf(page: Page): Promise<string[]> {
  return page.evaluate((editor) => {
    return Array.from(document.querySelectorAll(`${editor} ul, ${editor} ol`)).map(
      (list) => getComputedStyle(list).listStyleType,
    );
  }, EDITOR);
}

/**
 * Whether this engine implements style queries at all.
 *
 * The cycle is carried by `@container style(--dm-list-level: N)`, and an
 * engine without them applies none of the rules and falls back to its own
 * list defaults. That is not a bug in the theme and it is not something the
 * theme can work around: a chain of descendant selectors, the only other way
 * to express depth, has to stop somewhere and then plateaus, which is the
 * defect the cycle exists to remove.
 *
 * Measured rather than assumed from a version table. At the time of writing
 * Chromium and WebKit apply them and Firefox 146 does not, and a table in the
 * documentation was already wrong about that once.
 */
async function supportsStyleQueries(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent =
      '.dm-sq-probe { --dm-sq: 1; }' +
      '@container style(--dm-sq: 1) { .dm-sq-probe > i { color: rgb(0, 128, 0); } }';
    const host = document.createElement('div');
    host.className = 'dm-sq-probe';
    const child = document.createElement('i');
    host.appendChild(child);
    document.head.appendChild(style);
    document.body.appendChild(host);
    const applies = getComputedStyle(child).color === 'rgb(0, 128, 0)';
    host.remove();
    style.remove();
    return applies;
  });
}

/** The user agent's own cycle, which is what an engine without them draws. */
const UA_BULLETS = ['disc', 'circle', 'square', 'square', 'square'];
const UA_NUMBERS = ['decimal', 'decimal', 'decimal', 'decimal'];

/** `depth` lists of one item each, nested one inside the other. */
function nested(tag: 'ul' | 'ol', depth: number): string {
  if (depth === 0) return '<p>Leaf</p>';
  return `<${tag}><li><p>Level ${String(depth)}</p>${nested(tag, depth - 1)}</li></${tag}>`;
}

for (const target of demoTargets) {
  test(`${target.name}: bullets cycle disc, circle, square and start again`, async ({ page }) => {
    // Five levels rather than three, because the interesting half of the claim
    // is what happens after the cycle runs out. The browser's own sheet
    // plateaus at square here; the exporters start over at disc, and so does
    // this.
    await openDemo(page, target);
    await setContent(page, nested('ul', 5));
    const cycles = await supportsStyleQueries(page);
    expect(await markersOf(page)).toEqual(
      cycles ? ['disc', 'circle', 'square', 'disc', 'circle'] : UA_BULLETS,
    );
  });

  test(`${target.name}: numbers cycle 1., a., i. and start again`, async ({ page }) => {
    // The half a browser gets most wrong on its own: every ordered level is
    // `decimal` with no rule in play, so a nested outline reads as four lists
    // that all start at one.
    await openDemo(page, target);
    await setContent(page, nested('ol', 4));
    const cycles = await supportsStyleQueries(page);
    expect(await markersOf(page)).toEqual(
      cycles ? ['decimal', 'lower-alpha', 'lower-roman', 'decimal'] : UA_NUMBERS,
    );
  });

  test(`${target.name}: the level follows the nesting, not the list type`, async ({ page }) => {
    // A bullet list three levels down is a square whether the lists above it
    // were bullets or numbers, which is what "keyed on depth" means and what a
    // per-type counter could not express. The middle list is ordered on
    // purpose: if it did not spend a level, the innermost list would come out
    // a circle.
    await openDemo(page, target);
    await setContent(
      page,
      '<ul><li><p>One</p><ol><li><p>Two</p><ul><li><p>Three</p></li></ul></li></ol></li></ul>',
    );
    const cycles = await supportsStyleQueries(page);
    expect(await markersOf(page)).toEqual(
      cycles ? ['disc', 'lower-alpha', 'square'] : ['disc', 'decimal', 'square'],
    );
  });

  test(`${target.name}: a task list spends a level without painting a marker of its own`, async ({
    page,
  }) => {
    // The exporters count a task list as a level even though it draws a
    // checkbox rather than a marker, so a bullet list nested under a task item
    // is a circle rather than a disc. Only the elements that PAINT a marker
    // are excluded from the cycle, never the ancestors that count.
    await openDemo(page, target);
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task</p>' +
        '<ul><li><p>Under it</p></li></ul></li></ul>',
    );
    // The task list paints no marker either way: that is `list-style: none` in
    // `_task-list.scss`, not a style query, so it is the one assertion here
    // that does not move with engine support.
    expect(await markersOf(page)).toEqual(['none', 'circle']);
  });

  test(`${target.name}: a table cell restarts the cycle`, async ({ page }) => {
    // The one place the exporters restart their count, because the DOCX
    // serialiser builds a cell's context from scratch by design. The cell's
    // own content edge restarts the indentation too, so a list inside one
    // reads as a top-level list in every output instead of carrying a marker
    // down from a list it no longer sits under.
    await openDemo(page, target);
    await setContent(
      page,
      '<ul><li><p>Outer</p><table><tbody><tr><td><p>Cell</p>' +
        '<ul><li><p>Inner</p></li></ul></td></tr></tbody></table></li></ul>',
    );
    const markers = await markersOf(page);
    // The precondition: the table really did survive inside the list item, so
    // there really are two lists to compare.
    expect(markers.length).toBe(2);
    // The inner list is one level further in and still starts the cycle over.
    // The cell restart is this cycle's own rule, not something a browser does
    // by itself: measured, Firefox draws the inner list a circle because its
    // own sheet counts `ul ul` through the table and never restarts. So this
    // is one of the places where an engine without style queries does not
    // merely fall back to a plateau, it disagrees outright.
    const cycles = await supportsStyleQueries(page);
    expect(markers).toEqual(cycles ? ['disc', 'disc'] : ['disc', 'circle']);
  });

  test(`${target.name}: the table of contents block keeps its own list chrome`, async ({
    page,
  }) => {
    // The block's list is chrome the extension draws, not a list the writer
    // typed, and its own rule sits at a single class of specificity: without
    // the exclusion the cycle outweighs it and the table of contents grows
    // bullets. A stand-in carries the production markup, since the extension
    // is registered in the Notion preset rather than the default one, and it
    // is read and removed in one synchronous pass so ProseMirror's observer
    // never sees it.
    await openDemo(page, target);
    await setContent(page, '<p>A document with an outline.</p>');

    const markers = await page.evaluate((editor) => {
      const host = document.querySelector(editor);
      if (!host) return null;
      const block = document.createElement('div');
      block.className = 'dm-toc-block';
      block.innerHTML =
        '<ul class="dm-toc-block-list"><li><button class="dm-toc-block-link">A heading</button>' +
        '</li></ul>';
      const plain = document.createElement('ul');
      plain.innerHTML = '<li>An ordinary list at the same level</li>';
      host.appendChild(block);
      host.appendChild(plain);
      const read = {
        outline: getComputedStyle(block.querySelector('ul') as Element).listStyleType,
        ordinary: getComputedStyle(plain).listStyleType,
      };
      block.remove();
      plain.remove();
      return read;
    }, EDITOR);

    expect(markers?.outline).toBe('none');
    // The control: an ordinary list in the same position does take a marker,
    // so the reading above is the exclusion rather than a selector that missed.
    expect(markers?.ordinary).toBe('disc');
  });

  test(`${target.name}: a printed list uses the same markers as the screen`, async ({ page }) => {
    // The cycle is the editor's, not the paper's. The print layer declares no
    // marker of its own, so a document printed straight from the browser
    // carries the markers the writer was looking at, which is the same set the
    // .docx and the .pdf carry.
    await openDemo(page, target);
    await setContent(
      page,
      nested('ul', 4) +
        nested('ol', 3) +
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task</p>' +
        '<ul><li><p>Under it</p></li></ul></li></ul>',
    );

    const onScreen = await markersOf(page);
    await page.emulateMedia({ media: 'print' });
    const onPaper = await markersOf(page);
    await page.emulateMedia({ media: null });

    // The precondition: a document with enough lists in it for the comparison
    // to mean anything, and a cycle really running inside it.
    const cycles = await supportsStyleQueries(page);
    expect(onScreen).toEqual(
      cycles
        ? ['disc', 'circle', 'square', 'disc', 'decimal', 'lower-alpha', 'lower-roman', 'none', 'circle']
        : ['disc', 'circle', 'square', 'square', 'decimal', 'decimal', 'decimal', 'none', 'circle'],
    );
    expect(onPaper).toEqual(onScreen);
  });

  test(`${target.name}: a host override replaces both halves of the cycle together`, async ({
    page,
  }) => {
    // An application that pins its own markers has to be able to pin both
    // halves the same way. The two exclusions the bullet rule carries sit
    // inside `:where()` for exactly this reason: unwrapped, the bullet
    // selector weighs two classes more than the ordered one, so a host writing
    // the documented selector for each would win the numbers and lose the
    // bullets, and the document would end up carrying a fourth marker scheme
    // rather than the one they asked for.
    await openDemo(page, target);
    await setContent(page, nested('ul', 4) + nested('ol', 4));
    // The precondition: without the override, both halves cycle. On an engine
    // without style queries there is no cycle to lose, so the override cannot
    // be tested there and the assertion below is about the fallback instead.
    const cycles = await supportsStyleQueries(page);
    expect(await markersOf(page)).toEqual(
      cycles
        ? ['disc', 'circle', 'square', 'disc', 'decimal', 'lower-alpha', 'lower-roman', 'decimal']
        : [...UA_BULLETS.slice(0, 4), ...UA_NUMBERS],
    );

    await page.addStyleTag({
      content:
        '.dm-editor .ProseMirror ul { list-style: disc; } ' +
        '.dm-editor .ProseMirror ol { list-style: decimal; }',
    });

    expect(await markersOf(page)).toEqual([
      'disc', 'disc', 'disc', 'disc',
      'decimal', 'decimal', 'decimal', 'decimal',
    ]);
  });
}
