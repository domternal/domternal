/**
 * Tests for textInputRule helper
 *
 * Same handler-direct approach as markInputRule.test.ts: full input rule
 * integration needs DOM input events, so these tests call the handler with
 * a hand-built state and assert on the returned transaction.
 */
import { describe, it, expect } from 'vitest';
import { Schema } from '@domternal/pm/model';
import type { Transaction } from '@domternal/pm/state';
import { EditorState } from '@domternal/pm/state';
import { textInputRule } from './textInputRule.js';

describe('textInputRule', () => {
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: {
        group: 'block',
        content: 'inline*',
        toDOM: () => ['p', 0],
        parseDOM: [{ tag: 'p' }],
      },
      text: { group: 'inline' },
    },
    marks: {
      bold: {
        parseDOM: [{ tag: 'strong' }],
        toDOM: () => ['strong', 0],
      },
      italic: {
        parseDOM: [{ tag: 'em' }],
        toDOM: () => ['em', 0],
      },
      note: {
        attrs: { ids: { default: [] } },
        inclusive: false,
        parseDOM: [{ tag: 'span' }],
        toDOM: () => ['span', 0],
      },
    },
  });

  type InputRuleHandler = (
    state: EditorState,
    match: RegExpMatchArray,
    start: number,
    end: number
  ) => Transaction | null;

  function getHandler(rule: ReturnType<typeof textInputRule>): InputRuleHandler {

    return (rule as any).handler as InputRuleHandler;
  }

  function stateWith(children: Parameters<typeof schema.node>[2]): EditorState {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, children)]);
    return EditorState.create({ schema, doc });
  }

  const match = ['--'] as unknown as RegExpMatchArray;

  it('creates a valid InputRule with a handler', () => {
    const rule = textInputRule({ find: /--$/, replace: '—' });
    expect(rule).toHaveProperty('match');
    expect(typeof getHandler(rule)).toBe('function');
  });

  it('replaces the matched text', () => {
    const rule = textInputRule({ find: /--$/, replace: '—' });
    const state = stateWith([schema.text('--')]);

    const result = getHandler(rule)(state, match, 1, 3);
    expect(result?.docChanged).toBe(true);
    expect(result?.doc.textContent).toBe('—');
  });

  it('passes undoable through to the rule', () => {
    const rule = textInputRule({ find: /--$/, replace: '—', undoable: false });

    expect((rule as any).undoable).toBe(false);
  });

  it('keeps the marks of the replaced text', () => {
    const rule = textInputRule({ find: /--$/, replace: '—' });
    const bold = schema.marks.bold.create();
    const state = stateWith([schema.text('--', [bold])]);

    const result = getHandler(rule)(state, match, 1, 3);
    const textNode = result?.doc.firstChild?.firstChild;
    expect(textNode?.text).toBe('—');
    expect(textNode?.marks.map((mark) => mark.type.name)).toEqual(['bold']);
  });

  it('keeps multiple marks of the replaced text', () => {
    const rule = textInputRule({ find: /--$/, replace: '—' });
    const bold = schema.marks.bold.create();
    const italic = schema.marks.italic.create();
    const state = stateWith([schema.text('--', [bold, italic])]);

    const result = getHandler(rule)(state, match, 1, 3);
    const names = result?.doc.firstChild?.firstChild?.marks.map((mark) => mark.type.name).sort();
    expect(names).toEqual(['bold', 'italic']);
  });

  it('keeps a non-inclusive mark strictly inside its range', () => {
    const rule = textInputRule({ find: /--$/, replace: '—' });
    const note = schema.marks.note.create({ ids: ['t1'] });
    const state = stateWith([schema.text('x--', [note]), schema.text('y', [note])]);

    const result = getHandler(rule)(state, match, 2, 4);
    // Identically marked neighbors merge into one node: the replacement
    // inherited the note mark, so no hole splits the marked run.
    const textNode = result?.doc.firstChild?.firstChild;
    expect(result?.doc.firstChild?.childCount).toBe(1);
    expect(textNode?.text).toBe('x—y');
    expect(textNode?.marks.map((mark) => mark.type.name)).toEqual(['note']);
  });

  it('drops a non-inclusive mark at the exact end of its range', () => {
    const rule = textInputRule({ find: /--$/, replace: '—' });
    const note = schema.marks.note.create({ ids: ['t1'] });
    const state = stateWith([schema.text('x--', [note])]);

    const result = getHandler(rule)(state, match, 2, 4);
    const paragraph = result?.doc.firstChild;
    expect(paragraph?.childCount).toBe(2);
    expect(paragraph?.child(1).text).toBe('—');
    expect(paragraph?.child(1).marks).toHaveLength(0);
  });
});
