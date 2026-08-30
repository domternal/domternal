/** Synthetic, resource-free clipboard inputs. These are not native Office captures. */
const targetBytes = 20 * 1024;
const encoder = new TextEncoder();

function item(marker, label, level, instance) {
  return `<p class="MsoListParagraph" style="mso-list:l0 level${String(level)} lfo${String(instance)}">`
    + `<span style="mso-list:Ignore">${marker}<span>&nbsp; </span></span>${label}</p>`;
}

function group(kind, index) {
  const id = String(index).padStart(3, '0');
  if (kind === 'rich') {
    const tokens = ['Title', 'Bold', 'Italic', 'Underline', 'Strike', 'Painted', 'Quote', 'Left cell', 'Right cell'].map(label => `${label} ${id}`);
    return { tokens, html: `<h2>${tokens[0]}</h2><p style="text-align:center;line-height:1.5">`
      + `<strong>${tokens[1]}</strong> <em>${tokens[2]}</em> <u>${tokens[3]}</u> <s>${tokens[4]}</s> `
      + `<span style="font-family:Georgia;font-size:14pt;color:#123456;background-color:#ffff00">${tokens[5]}</span></p>`
      + `<blockquote><p>${tokens[6]}</p></blockquote><table><tr><td><p>${tokens[7]}</p></td><td><p>${tokens[8]}</p></td></tr></table>` };
  }
  if (kind === 'word') {
    const tokens = ['Bold', 'Plain', 'Again', 'Italic', 'Roman'].map(label => `${label} ${id}`);
    return { tokens, html: '<div style="font-family:Calibri;font-size:16px;color:#123456">'
      + '<p class="MsoNormal" style="text-align:center"><span style="mso-font-kerning:0pt">'
      + `<strong>${tokens[0]}<span style="font-weight:400;color:#654321">${tokens[1]}</span>${tokens[2]}</strong>`
      + `<em>${tokens[3]}<span style="font-style:normal">${tokens[4]}</span></em></span></p></div>` };
  }
  if (kind === 'office-lists') {
    const tokens = ['Root A', 'Nested', 'Root B', 'Restart'].map(label => `${label} ${id}`);
    return { tokens, html: item('7.', `<strong>${tokens[0]}</strong>`, 1, index)
      + item('•', `<em>${tokens[1]}</em>`, 2, index)
      + item('8.', `<span style="color:#123456">${tokens[2]}</span>`, 1, index)
      + item('2.', tokens[3], 1, index) };
  }
  throw new Error('Unknown performance fixture');
}

function createFixture(kind) {
  const pieces = [];
  const tokens = [];
  let bytes = 0;
  while (bytes < targetBytes) {
    const next = group(kind, pieces.length + 1);
    pieces.push(next.html);
    tokens.push(...next.tokens);
    bytes += encoder.encode(next.html).byteLength;
  }
  const html = pieces.join('');
  const groups = pieces.length;
  if (bytes > 22 * 1024 || groups > 100) throw new Error('Fixture envelope changed');
  const counts = kind === 'rich'
    ? { heading: groups, paragraph: 4 * groups, blockquote: groups, table: groups, tableRow: groups, tableCell: 2 * groups }
    : kind === 'word' ? { paragraph: groups }
      : { paragraph: 4 * groups, orderedList: 2 * groups, bulletList: groups, listItem: 4 * groups };
  return Object.freeze({ id: `${kind}-20k`, kind, html, utf8Bytes: bytes, utf16Units: html.length, groups,
    tokens: Object.freeze(tokens), expected: Object.freeze({ counts: Object.freeze(counts) }) });
}

export const FIXTURES = Object.freeze(['rich', 'word', 'office-lists'].map(createFixture));
export function fixtureById(id) {
  const fixture = FIXTURES.find(candidate => candidate.id === id);
  if (!fixture) throw new Error('Unknown performance fixture');
  return fixture;
}

/** Authored semantic invariants, evaluated outside the timed paste window. */
export function validateDocument(document, fixture, formatting, route) {
  const counts = {};
  const texts = [];
  const starts = [];
  const pending = [document];
  let nodes = 0;
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== 'object' || ++nodes > 30_000) throw new Error('Invalid document envelope');
    counts[node.type] = (counts[node.type] ?? 0) + 1;
    if (node.type === 'text') texts.push(node);
    if (node.type === 'orderedList') starts.push(node.attrs?.start);
    for (let index = (node.content?.length ?? 0) - 1; index >= 0; index--) pending.push(node.content[index]);
  }
  const content = texts.map(node => node.text).join('');
  let position = 0;
  for (const token of fixture.tokens) {
    const found = content.indexOf(token, position);
    if (found < 0 || content.indexOf(token, found + token.length) >= 0) throw new Error('Missing, duplicated or reordered authored text');
    position = found + token.length;
  }
  const expectedCounts = route === 'off-raw' && fixture.kind === 'office-lists'
    ? { paragraph: 4 * fixture.groups } : fixture.expected.counts;
  for (const [name, count] of Object.entries(expectedCounts)) if (counts[name] !== count) throw new Error(`Unexpected ${name} count`);
  const allowed = new Set(['doc', 'text', ...Object.keys(expectedCounts)]);
  if (Object.keys(counts).some(name => !allowed.has(name))) throw new Error('Unexpected document node type');
  if (route !== 'off-raw') {
    if (fixture.kind === 'office-lists' && JSON.stringify(starts) !== JSON.stringify(Array.from({ length: fixture.groups }, () => [7, 2]).flat())) {
      throw new Error('Office list starts changed');
    }
    for (const token of fixture.tokens) {
      const node = texts.find(value => value.text.includes(token));
      if (!node) throw new Error('An authored run was split unexpectedly');
      const marks = node.marks ?? [];
      const names = marks.map(mark => mark.type);
      const bold = token.startsWith('Bold ') || token.startsWith('Again ') || token.startsWith('Root A ');
      const italic = token.startsWith('Italic ') || token.startsWith('Nested ');
      if (names.includes('bold') !== bold || names.includes('italic') !== italic) throw new Error('Semantic mark or reset changed');
      if (names.includes('underline') !== token.startsWith('Underline ') || names.includes('strike') !== token.startsWith('Strike ')) throw new Error('Decoration mark changed');
      const style = marks.find(mark => mark.type === 'textStyle')?.attrs;
      if (formatting === 'adapt') {
        if (style && ['fontFamily', 'fontSize', 'color', 'backgroundColor'].some(key => style[key] !== null && style[key] !== undefined)) throw new Error('Adapt retained intentional typography');
      } else if (fixture.kind === 'word') {
        const color = token.startsWith('Plain ') ? '#654321' : '#123456';
        if (style?.fontFamily !== 'Calibri' || style.fontSize !== '16px' || style.color !== color) throw new Error('Inherited typography changed');
      } else if (token.startsWith('Painted ')) {
        if (style?.fontFamily !== 'Georgia' || style.fontSize !== '14pt' || style.color !== '#123456' || style.backgroundColor !== '#ffff00') throw new Error('Retained typography changed');
      } else if (token.startsWith('Root B ') && style?.color !== '#123456') throw new Error('List text color changed');
    }
  }
  return Object.freeze({ nodes, textUnits: content.length, counts: Object.freeze(counts), tokenCount: fixture.tokens.length });
}
