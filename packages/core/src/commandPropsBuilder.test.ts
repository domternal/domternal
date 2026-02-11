import { describe, it, expect } from 'vitest';
import { buildCommandProps, createAccumulatingDispatch } from './commandPropsBuilder.js';
import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';

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
});
