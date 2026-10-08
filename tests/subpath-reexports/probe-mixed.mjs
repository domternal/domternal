// Mixed format guard for tests/subpath-reexports. An ESM Editor and the CommonJS
// subpath are separate module copies, so they must not share registries: that is
// the documented limit, and a registration crossing it would mean some global
// join between copies, which could also join incompatible Core versions.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { installDom, pasteEvent, RESULT_PREFIX } = require('./probe-body.cjs');
const [packageName, subpathSpecifier] = process.argv.slice(2);

const window = installDom();
const core = await import(packageName);
const commonjsSubpath = require(subpathSpecifier);
const editor = new core.Editor({
  element: document.body.appendChild(document.createElement('div')),
  content: '<p>Keep</p>',
  extensions: [core.Document, core.Paragraph, core.Text],
});
let gateCalls = 0;
const dispose = commonjsSubpath.registerClipboardHTMLPreparation(editor.view, () => { gateCalls += 1; return undefined; });
editor.view.pasteHTML('<p>Probe</p>', pasteEvent(window, '<p>Probe</p>'));
dispose();
editor.destroy();
const checks = [{
  name: 'an ESM Editor does not see a preparation registered through the CommonJS subpath',
  ok: gateCalls === 0,
  detail: `gate calls ${String(gateCalls)}`,
}];
console.log(`${RESULT_PREFIX}${JSON.stringify({ kind: 'mixed', checks })}`);
