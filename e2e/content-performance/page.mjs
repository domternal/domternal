/**
 * Browser module of the content performance comparison. The runner bundles it once per variant, the
 * published 1.2.0 packages or a build of this checkout, so every variant runs this same code against
 * its own @domternal/core, extension-image and extension-table, and the same ProseMirror.
 */
import * as core from '@domternal/core';
import { Image } from '@domternal/extension-image';
import { Table } from '@domternal/extension-table';

const { Editor, StarterKit, TextStyle, TextColor, Highlight, FontSize, FontFamily, TextAlign, LineHeight, generateHTML } = core;
const extensions = () => [StarterKit, TextStyle, TextColor, Highlight, FontSize, FontFamily, TextAlign, LineHeight, Image, Table];

const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima'];
const sentence = (seed, count) => Array.from({ length: count }, (_, i) => WORDS[(seed * 7 + i * 3) % WORDS.length]).join(' ');
const text = (value, marks) => (marks ? { type: 'text', text: value, marks } : { type: 'text', text: value });
const paragraph = (content, attrs) => ({ type: 'paragraph', ...(attrs && { attrs }), content });
const heading = (level, value) => ({ type: 'heading', attrs: { level }, content: [text(value)] });

/** An article: headings, paragraphs with bold, italic and links, a list every other section, a table and an image every fifth. */
function article(sections) {
  const content = [];
  for (let s = 0; s < sections; s++) {
    content.push(heading(s % 4 === 3 ? 3 : 2, `Section ${String(s)} ${sentence(s, 4)}`));
    for (let p = 0; p < 3; p++) {
      content.push(paragraph([
        text(`${sentence(s + p, 12)} `), text(sentence(s + p + 1, 3), [{ type: 'bold' }]), text(` ${sentence(s + p + 2, 10)} `),
        text('reference', [{ type: 'link', attrs: { href: `https://example.com/docs/${String(s)}/${String(p)}` } }]),
        text(` ${sentence(s + p + 3, 8)} `), text(sentence(s + p + 4, 2), [{ type: 'italic' }]), text('.'),
      ]));
    }
    if (s % 2 === 0) content.push({ type: 'bulletList', content: [0, 1, 2].map(i => ({ type: 'listItem', content: [paragraph([text(sentence(s + i, 6))])] })) });
    if (s % 5 === 4) {
      content.push({ type: 'table', content: [0, 1, 2].map(r => ({ type: 'tableRow', content: [0, 1, 2].map(c => ({
        type: r === 0 ? 'tableHeader' : 'tableCell', content: [paragraph([text(`r${String(r)}c${String(c)} ${sentence(s + r + c, 2)}`)])],
      })) })) });
      content.push({ type: 'image', attrs: { src: `https://example.com/images/${String(s)}.png`, alt: `Figure ${String(s)}` } });
    }
  }
  return { type: 'doc', content };
}

/** An outline: an H2 and an H3 per section with one short paragraph. */
function outline(sections) {
  const content = [];
  for (let s = 0; s < sections; s++) content.push(heading(2, `Chapter ${String(s)}`), heading(3, `Topic ${String(s)} ${sentence(s, 3)}`), paragraph([text(sentence(s, 14))]));
  return { type: 'doc', content };
}

/** The release review's heading shape: an H2 and an H3 per item and nothing else. */
function headingsOnly(items) {
  const content = [];
  for (let i = 0; i < items; i++) content.push(heading(2, `Heading ${String(i)}`), heading(3, `Sub ${String(i)}`));
  return { type: 'doc', content };
}

/** The release review's styled shape: centered paragraphs with a red 18px run and a highlighted run. */
function styled(items) {
  const content = [];
  for (let i = 0; i < items; i++) {
    content.push(paragraph([
      text(`Para ${String(i)} ${sentence(i, 6)} `), text('red', [{ type: 'textStyle', attrs: { color: '#ff0000', fontSize: '18px' } }]),
      text(' '), text('hl', [{ type: 'textStyle', attrs: { backgroundColor: '#ffff00' } }]), text('.'),
    ], { textAlign: 'center' }));
  }
  return { type: 'doc', content };
}

export const DOCUMENTS = Object.freeze({
  'article-s': () => article(4), 'article-m': () => article(40), 'article-l': () => article(160),
  'outline-m': () => outline(100), 'outline-l': () => outline(400), 'headings-only': () => headingsOnly(1000),
  'styled-m': () => styled(200), 'styled-l': () => styled(1000),
});

const host = () => document.getElementById('editor');
const nextTask = () => new Promise(resolve => { setTimeout(resolve, 0); });
const spread = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: sorted[Math.floor((sorted.length - 1) / 2)], min: sorted[0], max: sorted[sorted.length - 1] };
};

/** The time per call of `run`: batches calibrated to at least `minBatchMs`, the median of `batches` of them. */
async function time(run, batches, minBatchMs) {
  run(); run();
  let repeat = 1;
  for (;;) {
    const start = performance.now();
    for (let i = 0; i < repeat; i++) run();
    const elapsed = performance.now() - start;
    if (elapsed >= minBatchMs || repeat >= 4096) break;
    repeat = Math.min(4096, Math.max(repeat * 2, Math.ceil(repeat * minBatchMs / Math.max(elapsed, 0.5))));
  }
  const values = [];
  for (let b = 0; b < batches; b++) {
    await nextTask();
    const start = performance.now();
    for (let i = 0; i < repeat; i++) run();
    values.push((performance.now() - start) / repeat);
  }
  return { ...spread(values), repeat };
}

/** A 32-bit FNV-1a with the length, to compare outputs across variants without returning them. */
function digest(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 0x01000193) >>> 0;
  return `${hash.toString(16)}:${String(value.length)}`;
}

/** A document full of edge values: heading levels, list markers, hrefs and CSS values valid and not. */
function edgeDocument(random) {
  const pick = list => list[Math.floor(random() * list.length)];
  const maybe = (value, key) => (value === undefined ? {} : { [key]: value });
  const levels = [1, 2, 3, 4, 5, 6, 0, 7, '3', ' 5 ', 2.5, -1, null, 'abc', {}, [2], true, undefined];
  const markers = ['decimal', 'lower-alpha', 'upper-roman', 'disc', 'circle', 'square', 'bogus', null, 5, '', undefined];
  const hrefs = ['https://example.com/a', 'http://example.com/b?x=1&y=2', 'mailto:a@b.example', 'tel:+123', 'javascript:alert(1)',
    'ftp://example.com/f', '#top', '/relative/path', 'page.html', 'example.com', '', null, 123, undefined, 'https://user:pw@example.com',
    'HTTPS://EXAMPLE.COM/UPPER', 'data:text/html,x', ' https://example.com/space ', 'https://exämple.com/'];
  const colors = ['#ff0000', '#FFF', 'rgb(1, 2, 3)', 'red', 'red;position:fixed', 'url(https://x)', 'hsl(1 2% 3%)', '', null, 7, 'var(--x)', 'rgba(1,2,3,0.5)'];
  const sizes = ['18px', '1.5em', 'calc(1rem + 2px)', 'x}y', null, ''];
  const aligns = ['left', 'center', 'right', 'justify', 'bogus;x', null, '-webkit-center', 3];
  const words = ['one', 'two', 'Tom & Jerry', '<tag>', 'rgb(1, 2, 3)', 'style="color: rgb(1, 2, 3)"', ' nbsp', 'a"quote'];
  const mark = () => [
    { type: 'bold' }, { type: 'italic' }, { type: 'link' },
    { type: 'link', attrs: { ...maybe(pick(hrefs), 'href'), ...(random() < 0.2 ? { title: 'T & "q"' } : {}) } },
    { type: 'textStyle', attrs: { ...maybe(pick(colors), 'color'), ...maybe(pick(sizes), 'fontSize') } },
    { type: 'textStyle', attrs: { ...maybe(pick(colors), 'backgroundColor') } },
  ][Math.floor(random() * 6)];
  const run = () => Array.from({ length: 1 + Math.floor(random() * 5) }, () => (random() < 0.6
    ? { type: 'text', text: pick(words), marks: Array.from({ length: 1 + Math.floor(random() * 2) }, mark) }
    : { type: 'text', text: pick(words) }));
  const para = () => ({ type: 'paragraph', ...(random() < 0.4 ? { attrs: maybe(pick(aligns), 'textAlign') } : {}), content: run() });
  const block = depth => {
    switch (Math.floor(random() * (depth > 2 ? 3 : 6))) {
      case 0: return para();
      case 1: return { type: 'heading', attrs: { ...maybe(pick(levels), 'level'), ...maybe(pick(aligns), 'textAlign') }, content: run() };
      case 2: return { type: 'image', attrs: { ...maybe(pick(hrefs), 'src'), alt: 'a & b' } };
      case 3: return { type: random() < 0.5 ? 'orderedList' : 'bulletList', attrs: maybe(pick(markers), 'listStyleType'),
        content: Array.from({ length: 1 + Math.floor(random() * 3) }, () => ({ type: 'listItem', content: [para(), ...(random() < 0.3 ? [block(depth + 1)] : [])] })) };
      case 4: return { type: 'blockquote', content: [para(), block(depth + 1)] };
      default: return { type: 'table', content: [0, 1].map(() => ({ type: 'tableRow', content: [0, 1].map(() => ({ type: 'tableCell', content: [para()] })) })) };
    }
  };
  return { type: 'doc', content: Array.from({ length: 1 + Math.floor(random() * 8) }, () => block(0)) };
}

function seeded(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

window.contentPerformance = Object.freeze({
  /** Times each operation on each document; the outputs are digests for comparing variants. */
  async measure({ documents, batches, minBatchMs }) {
    const results = {};
    for (const name of documents) {
      const json = DOCUMENTS[name]();
      const html = generateHTML(json, extensions());
      const row = { htmlLength: html.length, outputs: { generateHTML: digest(html) } };
      const loads = [];
      let editor;
      for (let i = 0; i < 2 + batches; i++) {
        await nextTask();
        editor?.destroy();
        host().replaceChildren();
        const start = performance.now();
        editor = new Editor({ element: host(), extensions: extensions(), content: json });
        if (i >= 2) loads.push(performance.now() - start);
      }
      row.initialLoadJSON = { ...spread(loads), repeat: 1 };
      row.outputs.getHTML = digest(editor.getHTML());
      row.outputs.getJSON = digest(JSON.stringify(editor.getJSON()));
      row.getHTML = await time(() => editor.getHTML(), batches, minBatchMs);
      row.setContentJSON = await time(() => editor.commands.setContent(json), batches, minBatchMs);
      row.outputs.setContentJSON = digest(JSON.stringify(editor.getJSON()));
      editor.destroy();
      row.generateHTML = await time(() => generateHTML(json, extensions()), batches, minBatchMs);
      results[name] = row;
    }
    return results;
  },
  /** Every output and diagnostic of the JSON entry points for `count` seeded edge documents, one string each. */
  equivalence({ seed, count }) {
    const random = seeded(seed);
    const settle = run => { try { return run(); } catch (error) { return `threw ${String(error?.message ?? error)}`; } };
    const rows = [];
    for (let index = 0; index < count; index++) {
      const json = edgeDocument(random);
      const before = JSON.stringify(json);
      const parts = [];
      const probe = new Editor({ extensions: extensions() });
      const normalized = [];
      parts.push(settle(() => JSON.stringify(core.normalizeContent(json, probe.schema, { onDiagnostic: d => normalized.push(d) }))), JSON.stringify(normalized));
      probe.destroy();
      const generated = [];
      parts.push(settle(() => generateHTML(json, extensions(), { onDiagnostic: d => generated.push(d) })), JSON.stringify(generated));
      const events = [];
      parts.push(settle(() => {
        host().replaceChildren();
        const editor = new Editor({ element: host(), extensions: extensions(), content: json,
          onContentDiagnostic: ({ source, diagnostics, total }) => events.push({ source, diagnostics, total }) });
        const out = [editor.getHTML(), editor.getHTML({ styled: true }), JSON.stringify(editor.getJSON())];
        editor.commands.setContent('<p>x</p>');
        out.push(String(editor.commands.setContent(json)), editor.getHTML(), JSON.stringify(editor.getJSON()));
        editor.destroy();
        return out.join('\u0000');
      }), JSON.stringify(events), String(JSON.stringify(json) === before));
      rows.push(parts.join('\u0001'));
    }
    return rows;
  },
});
