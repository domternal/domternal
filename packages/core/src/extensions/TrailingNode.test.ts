import { afterEach, describe, it, expect } from 'vitest';
import { undoDepth, redoDepth } from '@domternal/pm/history';
import { TextSelection } from '@domternal/pm/state';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { Heading } from '../nodes/Heading.js';
import { Bold } from '../marks/Bold.js';
import { History } from './History.js';
import { TrailingNode } from './TrailingNode.js';

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; });
function make(): Editor {
  editor = new Editor({ extensions: [Document, Paragraph, Text, Heading, Bold, History, TrailingNode], content: '<h2>Title</h2>' });
  editor.view.setProps({ handleScrollToSelection: () => true });
  return editor;
}

describe('TrailingNode', () => {
  it('does not change initial content or history for export and UI notifications', () => {
    const ed = make(); const original = ed.state.doc;
    ed.view.dispatch(ed.state.tr.setMeta('exportStateChange', true));
    ed.view.dispatch(ed.state.tr.setMeta('uiRefresh', true));
    ed.view.dispatch(ed.state.tr.setMeta('exportStateChange', false));
    expect(ed.state.doc).toBe(original);
    expect(undoDepth(ed.state)).toBe(0);
    expect(redoDepth(ed.state)).toBe(0);
  });

  it('appends after an actual edit and restores the exact initial document on undo', () => {
    const ed = make(); const original = ed.getJSON();
    ed.view.dispatch(ed.state.tr.insertText('New ', 1));
    const changed = ed.getJSON();
    expect(ed.state.doc.lastChild?.type.name).toBe('paragraph');
    expect(ed.state.doc.childCount).toBe(2);
    expect(undoDepth(ed.state)).toBe(1);
    expect(ed.commands.undo()).toBe(true);
    expect(ed.getJSON()).toEqual(original);
    expect(undoDepth(ed.state)).toBe(0);
    expect(redoDepth(ed.state)).toBe(1);
    ed.view.dispatch(ed.state.tr.setMeta('uiRefresh', true));
    expect(ed.getJSON()).toEqual(original);
    expect(ed.commands.redo()).toBe(true);
    expect(ed.getJSON()).toEqual(changed);
  });

  it('keeps diagnostic navigation read-only but still initializes on an editing selection', () => {
    const ed = make(); const original = ed.state.doc;
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(original, 1, 6)).setMeta('addToHistory', false));
    expect(ed.state.doc).toBe(original);
    expect(undoDepth(ed.state)).toBe(0);
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(original, 2)));
    expect(ed.state.doc.lastChild?.type.name).toBe('paragraph');
    expect(undoDepth(ed.state)).toBe(0);
  });

  it('does not add an undo entry for a nonhistorical document update', () => {
    const ed = make();
    ed.view.dispatch(ed.state.tr.insertText('Loaded ', 1).setMeta('addToHistory', false));
    expect(ed.state.doc.lastChild?.type.name).toBe('paragraph');
    expect(undoDepth(ed.state)).toBe(0);
  });

  it('retains explicit typing marks while appending an unrelated tail', () => {
    const ed = make(); const marks = [ed.schema.marks['bold']!.create()];
    ed.view.dispatch(ed.state.tr.insertText('New ', 1).setStoredMarks(marks));
    expect(ed.state.storedMarks).toEqual(marks);
  });

  it('does not duplicate an existing trailing paragraph on later updates', () => {
    const ed = make();
    ed.view.dispatch(ed.state.tr.insertText('A', 1));
    ed.view.dispatch(ed.state.tr.insertText('B', 1));
    expect(ed.state.doc.childCount).toBe(2);
  });

  describe('configuration', () => {
    it('has correct name', () => {
      expect(TrailingNode.name).toBe('trailingNode');
    });

    it('is an extension type', () => {
      expect(TrailingNode.type).toBe('extension');
    });

    it('has default options', () => {
      const opts = TrailingNode.config.addOptions?.call(TrailingNode);
      expect(opts).toEqual({ node: 'paragraph', notAfter: ['paragraph'] });
    });

    it('can configure node type', () => {
      const custom = TrailingNode.configure({ node: 'heading' });
      expect(custom.options.node).toBe('heading');
    });

    it('can configure notAfter', () => {
      const custom = TrailingNode.configure({
        notAfter: ['paragraph', 'heading'],
      });
      expect(custom.options.notAfter).toEqual(['paragraph', 'heading']);
    });
  });

  describe('addProseMirrorPlugins', () => {
    it('returns trailing node plugin', () => {
      const plugins = TrailingNode.config.addProseMirrorPlugins?.call(
        TrailingNode
      );
      expect(plugins).toHaveLength(1);
    });
  });
});
