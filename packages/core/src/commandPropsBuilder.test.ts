import { describe, it, expect } from 'vitest';
import { buildCommandProps, createAccumulatingDispatch } from './commandPropsBuilder.js';
import { Schema } from '@domternal/pm/model';
import { EditorState, TextSelection } from '@domternal/pm/state';

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
});

describe('buildCommandProps', () => {
  it('builds props with all required fields', () => {
    const state = EditorState.create({ schema });
    const tr = state.tr;
    const mockEditor = { view: { state } } as never;

    const props = buildCommandProps({
      editor: mockEditor,
      tr,
      dispatch: undefined,
      chain: () => ({} as never),
      can: () => ({} as never),
      commands: () => ({} as never),
    });

    expect(props).toHaveProperty('editor');
    expect(props).toHaveProperty('state');
    expect(props).toHaveProperty('tr');
    expect(props).toHaveProperty('dispatch');
    expect(props).toHaveProperty('chain');
    expect(props).toHaveProperty('can');
    expect(props).toHaveProperty('commands');
  });

  it('uses the provided transaction', () => {
    const state = EditorState.create({ schema });
    const tr = state.tr;
    const mockEditor = { view: { state } } as never;

    const props = buildCommandProps({
      editor: mockEditor,
      tr,
      dispatch: undefined,
      chain: () => ({} as never),
      can: () => ({} as never),
      commands: () => ({} as never),
    });

    expect(props.tr).toBe(tr);
  });

  it('passes undefined dispatch for dry-run mode', () => {
    const state = EditorState.create({ schema });
    const mockEditor = { view: { state } } as never;

    const props = buildCommandProps({
      editor: mockEditor,
      tr: state.tr,
      dispatch: undefined,
      chain: () => ({} as never),
      can: () => ({} as never),
      commands: () => ({} as never),
    });

    expect(props.dispatch).toBeUndefined();
  });

  it('passes dispatch function when provided', () => {
    const state = EditorState.create({ schema });
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const dispatchFn = (): void => {};
    const mockEditor = { view: { state } } as never;

    const props = buildCommandProps({
      editor: mockEditor,
      tr: state.tr,
      dispatch: dispatchFn,
      chain: () => ({} as never),
      can: () => ({} as never),
      commands: () => ({} as never),
    });

    expect(props.dispatch).toBe(dispatchFn);
  });
});

describe('createAccumulatingDispatch', () => {
  it('returns a function', () => {
    const state = EditorState.create({ schema });
    const dispatch = createAccumulatingDispatch(state.tr);
    expect(typeof dispatch).toBe('function');
  });

  it('does nothing when dispatching the same transaction', () => {
    const state = EditorState.create({ schema });
    const sharedTr = state.tr;
    const dispatch = createAccumulatingDispatch(sharedTr);

    const stepsBefore = sharedTr.steps.length;
    dispatch(sharedTr);
    expect(sharedTr.steps.length).toBe(stepsBefore);
  });

  it('copies steps from different transaction to shared transaction', () => {
    const state = EditorState.create({
      schema,
      doc: schema.node('doc', null, [
        schema.node('paragraph', null, [schema.text('Hello')]),
      ]),
    });
    const sharedTr = state.tr;
    const otherTr = state.tr.insertText(' World', 6);

    const dispatch = createAccumulatingDispatch(sharedTr);
    dispatch(otherTr);

    expect(sharedTr.steps.length).toBeGreaterThan(0);
  });

  it('copies metadata from accumulated transaction to shared transaction', () => {
    const state = EditorState.create({
      schema,
      doc: schema.node('doc', null, [
        schema.node('paragraph', null, [schema.text('Hello')]),
      ]),
    });
    const sharedTr = state.tr;
    const otherTr = state.tr;
    otherTr.setMeta('addToHistory', false);
    otherTr.setMeta('testKey', 'testValue');

    const dispatch = createAccumulatingDispatch(sharedTr);
    dispatch(otherTr);

    expect(sharedTr.getMeta('addToHistory')).toBe(false);
    expect(sharedTr.getMeta('testKey')).toBe('testValue');
  });

  it('copies selection when selectionSet is true', () => {
    const state = EditorState.create({
      schema,
      doc: schema.node('doc', null, [
        schema.node('paragraph', null, [schema.text('Hello World')]),
      ]),
    });
    const sharedTr = state.tr;
    const otherTr = state.tr;

    otherTr.setSelection(TextSelection.create(otherTr.doc, 3, 8));

    const dispatch = createAccumulatingDispatch(sharedTr);
    dispatch(otherTr);

    expect(sharedTr.selectionSet).toBe(true);
    expect(sharedTr.selection.from).toBe(3);
    expect(sharedTr.selection.to).toBe(8);
  });

  it('does not copy selection when selectionSet is false', () => {
    const state = EditorState.create({
      schema,
      doc: schema.node('doc', null, [
        schema.node('paragraph', null, [schema.text('Hello')]),
      ]),
    });
    const sharedTr = state.tr;
    const otherTr = state.tr;

    const dispatch = createAccumulatingDispatch(sharedTr);
    dispatch(otherTr);

    expect(sharedTr.selectionSet).toBe(false);
  });

  it('handles invalid selection positions gracefully', () => {
    const state = EditorState.create({
      schema,
      doc: schema.node('doc', null, [
        schema.node('paragraph', null, [schema.text('Hello')]),
      ]),
    });
    const sharedTr = state.tr;

    // Create a different state with a longer doc
    const state2 = EditorState.create({
      schema,
      doc: schema.node('doc', null, [
        schema.node('paragraph', null, [schema.text('Hello World extended text')]),
      ]),
    });
    const otherTr = state2.tr;
    // Set selection at position valid for state2 but invalid for sharedTr
    otherTr.setSelection(TextSelection.create(otherTr.doc, 1, 20));

    const dispatch = createAccumulatingDispatch(sharedTr);

    // Should not throw - invalid positions are caught
    expect(() => { dispatch(otherTr); }).not.toThrow();
  });

  it('copies steps and metadata together', () => {
    const state = EditorState.create({
      schema,
      doc: schema.node('doc', null, [
        schema.node('paragraph', null, [schema.text('Hello')]),
      ]),
    });
    const sharedTr = state.tr;
    const otherTr = state.tr;
    otherTr.insertText(' World', 6);
    otherTr.setMeta('addToHistory', false);

    const dispatch = createAccumulatingDispatch(sharedTr);
    dispatch(otherTr);

    expect(sharedTr.steps.length).toBeGreaterThan(0);
    expect(sharedTr.getMeta('addToHistory')).toBe(false);
    expect(sharedTr.doc.textContent).toBe('Hello World');
  });
});
