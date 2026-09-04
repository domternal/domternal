#!/usr/bin/env node
/**
 * Deterministic semantic HTML for the large Word capture source. The owner opens the output in
 * Word for Mac and saves it as .docx; every capture is copied from that Word-saved file, so Word
 * writes its own clipboard HTML. Every block starts with a unique G00001 style token.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The English word cycle includes explicit Unicode sentinels for text preservation.
const words = Object.freeze([
  'document', 'paragraph', 'list', 'table', 'heading', 'word', 'sentence', 'page', 'chapter', 'content',
  'reading', 'cell', 'pupil', 'forest', 'yellow', 'region', 'valley', 'river', 'čćšžđ', 'ČĆŠŽĐ',
]);
const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const LARGE_SOURCE_SECTIONS = 128;

/** The whole source document, its tokens in order, its visible words and block counts. */
export function largeSourceDocument(sections = LARGE_SOURCE_SECTIONS) {
  if (!Number.isSafeInteger(sections) || sections < 1 || sections > 1000) throw new Error('Invalid section count');
  const tokens = [];
  const counts = { heading: 0, paragraph: 0, listItem: 0, tableCell: 0 };
  let total = 0;
  let cursor = 0;
  const text = count => {
    const token = `G${String(tokens.length + 1).padStart(5, '0')}`;
    tokens.push(token);
    const body = [token];
    for (let index = 1; index < count; index++) body.push(words[cursor++ % words.length]);
    total += count;
    return escape(body.join(' '));
  };
  let body = '';
  for (let section = 0; section < sections; section++) {
    body += `<h${section % 5 === 0 ? 1 : 2}>${text(4)}</h${section % 5 === 0 ? 1 : 2}>\n`; counts.heading++;
    for (let paragraph = 0; paragraph < 3; paragraph++) { body += `<p>${text(16)}</p>\n`; counts.paragraph++; }
    body += `<ul>\n<li>${text(5)}\n<ul>\n<li>${text(5)}</li>\n</ul>\n</li>\n<li>${text(5)}</li>\n</ul>\n`; counts.listItem += 3;
    body += `<ol>\n<li>${text(5)}</li>\n<li>${text(5)}</li>\n</ol>\n`; counts.listItem += 2;
    if (section % 10 === 9) {
      body += '<table border="1">\n';
      for (let row = 0; row < 2; row++) body += `<tr><td>${text(3)}</td><td>${text(3)}</td></tr>\n`;
      body += '</table>\n';
      counts.tableCell += 4;
    }
  }
  const html = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Domternal large paste source v1</title>\n</head>\n'
    + `<body>\n${body}</body>\n</html>\n`;
  return Object.freeze({ html, tokens: Object.freeze(tokens), words: total, counts: Object.freeze(counts) });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(largeSourceDocument().html);
}
