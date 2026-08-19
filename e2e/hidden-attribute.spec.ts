/**
 * The `hidden` attribute has to work on everything this theme styles.
 *
 * `[hidden] { display: none }` lives in the user agent stylesheet, and author
 * styles beat the user agent stylesheet whatever their specificity. So a single
 * `display` declaration disables the attribute for that element, silently:
 * `.dm-toolbar` sets `display: flex`, and a consumer who writes
 * `toolbar.hidden = true` was left with an empty strip, background, border and
 * padding intact, with nothing in the console to explain it.
 *
 * The theme declares `display` on roughly ninety selectors, so the fix is one
 * scoped rule rather than a patch per component, and this spec is what holds it
 * down: not only on the toolbar that was reported, but on the editor root, on
 * elements inside it, on a class that is not the first in the attribute, and on
 * the one value that must NOT be forced to `display: none`.
 *
 * Driven by setting the attribute from the page rather than through a demo
 * control, because the behaviour under test belongs to the stylesheet: whoever
 * sets `hidden`, on whichever framework's rendering of the same markup, must
 * get the same answer.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';
import { demoTargets, type DemoTarget } from './targets.js';

async function openDemo(page: Page, target: DemoTarget): Promise<void> {
  await page.goto(target.baseURL + '/');
  await page.waitForSelector('.ProseMirror');
  await page.waitForFunction(
    () => Boolean((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__']),
    { timeout: 5000 }
  );
}

/** Sets or clears `hidden` on the first element matching `selector`. */
async function setHidden(page: Page, selector: string, value: boolean | string): Promise<void> {
  await page.evaluate(
    ([sel, val]) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`no element for ${sel}`);
      if (val === false) el.removeAttribute('hidden');
      else el.setAttribute('hidden', val === true ? '' : val);
    },
    [selector, value] as const
  );
}

/** The computed `display` of the first match, or null when there is no match. */
async function displayOf(page: Page, selector: string): Promise<string | null> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el).display : null;
  }, selector);
}

/**
 * Appends a probe element and returns its selector.
 *
 * Built in the page rather than expected in the demos, because the shapes worth
 * testing (a `dm-` class that is not first, a plain element inside the editor,
 * a class that merely contains the letters) are not shapes any demo happens to
 * render.
 */
async function probe(
  page: Page,
  options: { className: string; parent: string; hidden?: boolean | string }
): Promise<string> {
  const id = `probe-${Math.random().toString(36).slice(2, 9)}`;
  await page.evaluate(
    ([probeId, className, parentSelector, hidden]) => {
      const parent = document.querySelector(parentSelector) ?? document.body;
      const el = document.createElement('div');
      el.id = probeId;
      el.className = className;
      el.textContent = 'probe';
      if (hidden === true) el.setAttribute('hidden', '');
      else if (typeof hidden === 'string') el.setAttribute('hidden', hidden);
      parent.appendChild(el);
    },
    [id, options.className, options.parent, options.hidden ?? false] as const
  );
  return `#${id}`;
}

for (const target of demoTargets) {
  test(`${target.name}: hidden on the toolbar hides it, strip and all`, async ({ page }) => {
    await openDemo(page, target);
    const toolbar = page.locator('.dm-toolbar').first();
    await expect(toolbar).toBeVisible();

    await setHidden(page, '.dm-toolbar', true);

    /* The reported bug. Before the fix this stayed a full-width strip with the
       toolbar background, border and padding, because `display: flex` beat the
       attribute and nothing said so. */
    await expect(toolbar).toBeHidden();
    expect(await displayOf(page, '.dm-toolbar')).toBe('none');
  });

  test(`${target.name}: removing hidden brings the toolbar back`, async ({ page }) => {
    await openDemo(page, target);
    await setHidden(page, '.dm-toolbar', true);
    await expect(page.locator('.dm-toolbar').first()).toBeHidden();

    await setHidden(page, '.dm-toolbar', false);

    // The rule is `!important`, which is why this matters: it must apply only
    // while the attribute is there, never latch.
    await expect(page.locator('.dm-toolbar').first()).toBeVisible();
    expect(await displayOf(page, '.dm-toolbar')).toBe('flex');
  });

  test(`${target.name}: hidden on the editor root hides the whole editor`, async ({ page }) => {
    await openDemo(page, target);
    // `.dm-editor` sets `display: block`, so it had the same defect as the
    // toolbar and a larger blast radius.
    await setHidden(page, '.dm-editor', true);
    expect(await displayOf(page, '.dm-editor')).toBe('none');
  });

  test(`${target.name}: hidden works on a dm- class that is not the first one`, async ({ page }) => {
    await openDemo(page, target);
    /* A consumer wrapping our class with their own is ordinary, and an
       attribute selector anchored to the start of the class attribute would
       quietly miss it. */
    const selector = await probe(page, {
      className: 'customer-chrome dm-toolbar',
      parent: 'body',
      hidden: true,
    });
    expect(await displayOf(page, selector)).toBe('none');
  });

  test(`${target.name}: hidden works on content the theme styles inside the editor`, async ({
    page,
  }) => {
    await openDemo(page, target);
    /* The descendant half of the rule, on a real selector rather than an
       invented one: `.dm-editor .ProseMirror img` sets `display: block`, so an
       image a consumer or an extension hides stayed on screen. The element
       carries no `dm-` class of its own, which is exactly why the rule needs
       that half.

       The structure is built beside the live content rather than inside it.
       ProseMirror watches its own contentDOM and reverts foreign nodes, so an
       image appended there disappears before anything can be measured, and the
       question here belongs to the stylesheet rather than to the view. */
    await page.evaluate(() => {
      const editor = document.querySelector('.dm-editor');
      const content = document.createElement('div');
      content.className = 'ProseMirror';
      const img = document.createElement('img');
      img.id = 'hidden-img-probe';
      img.alt = '';
      img.hidden = true;
      content.appendChild(img);
      editor?.appendChild(content);
    });
    expect(await displayOf(page, '#hidden-img-probe')).toBe('none');
  });

  test(`${target.name}: hidden works on any element inside the editor`, async ({ page }) => {
    await openDemo(page, target);
    // The general claim, beyond the elements the theme happens to style:
    // anything a consumer hides inside the editor stays hidden.
    const selector = await probe(page, {
      className: 'consumer-content',
      parent: '.dm-editor',
      hidden: true,
    });
    expect(await displayOf(page, selector)).toBe('none');
  });

  test(`${target.name}: an element without the attribute is untouched`, async ({ page }) => {
    await openDemo(page, target);
    // The control. A rule with `!important` that over-matched would be a worse
    // bug than the one it fixes, and would look exactly like a layout problem.
    const selector = await probe(page, { className: 'consumer-content', parent: '.dm-editor' });
    expect(await displayOf(page, selector)).not.toBe('none');
  });

  test(`${target.name}: a class that merely contains the letters is not matched`, async ({
    page,
  }) => {
    await openDemo(page, target);
    /* `[class*='dm-']` would match `admin-panel` and anything else with those
       letters in it. The selector is anchored on a word boundary for this
       reason, and this is what proves it. */
    const selector = await probe(page, { className: 'admin-panel', parent: 'body' });
    expect(await displayOf(page, selector)).not.toBe('none');
  });

  test(`${target.name}: hidden="until-found" is left alone`, async ({ page }) => {
    await openDemo(page, target);
    /* The one value that does NOT mean `display: none`. It means the element is
       skipped for rendering but stays findable, and the browser reveals it when
       find-in-page or a fragment link lands inside. Forcing `display: none`
       would take that away with no way back, since the rule is `!important`. */
    const selector = await probe(page, {
      className: 'consumer-content',
      parent: '.dm-editor',
      hidden: 'until-found',
    });
    expect(await displayOf(page, selector)).not.toBe('none');
  });

  test(`${target.name}: the attribute wins however it was set`, async ({ page }) => {
    await openDemo(page, target);
    /* On the toolbar, so the assertion is about a rule that would otherwise
       win. `.hidden = true` is the property form, the one the packages' own
       code uses; `setAttribute` with a value is what a template renders, and
       both must reach the same place. */
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('.dm-toolbar')!.hidden = true;
    });
    expect(await displayOf(page, '.dm-toolbar')).toBe('none');

    await setHidden(page, '.dm-toolbar', false);
    await page.evaluate(() => {
      document.querySelector('.dm-toolbar')?.setAttribute('hidden', 'hidden');
    });
    expect(await displayOf(page, '.dm-toolbar')).toBe('none');

    // And the empty-string form, which is what `hidden` serialises to.
    await setHidden(page, '.dm-toolbar', false);
    await setHidden(page, '.dm-toolbar', '');
    expect(await displayOf(page, '.dm-toolbar')).toBe('none');
  });

  test(`${target.name}: the image popover's own hidden controls stay hidden`, async ({ page }) => {
    await openDemo(page, target);
    /* The case the theme used to carry a rule for. The popover renders the URL
       field, the alt field and the browse button into one surface and hides
       whichever is not in play, and `.dm-image-popover-btn` sets
       `display: inline-flex`. The classes here are the ones `Image.ts` really
       assigns, so this reproduces the state the popover puts itself in rather
       than an invented one. */
    await page.evaluate(() => {
      const popover = document.createElement('div');
      popover.className = 'dm-image-popover';
      const browse = document.createElement('button');
      browse.id = 'popover-browse-probe';
      browse.className = 'dm-image-popover-btn dm-image-popover-browse';
      browse.hidden = true;
      const alt = document.createElement('input');
      alt.id = 'popover-alt-probe';
      alt.className = 'dm-image-popover-alt-input';
      alt.hidden = true;
      popover.append(browse, alt);
      document.body.appendChild(popover);
    });
    expect(await displayOf(page, '#popover-browse-probe')).toBe('none');
    expect(await displayOf(page, '#popover-alt-probe')).toBe('none');
  });
}
