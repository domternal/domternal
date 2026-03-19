import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Heading } from '../nodes/Heading.js';
import { Bold } from '../marks/Bold.js';
import { Link } from '../marks/Link.js';

const extensions = [Document, Text, Paragraph, Heading, Bold, Link];

function setSelection(editor: Editor, from: number, to?: number): void {
  const tr = editor.state.tr.setSelection(
    TextSelection.create(editor.state.doc, from, to ?? from)
  );
  editor.view.dispatch(tr);
}

describe('attributeCommands', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.view.dom.remove();
      editor.destroy();
    }
  });

  describe('updateAttributes', () => {
    it('updates heading level attribute', () => {
      editor = new Editor({ extensions, content: '<h1>Title</h1>' });
      setSelection(editor, 2);
      editor.commands.updateAttributes('heading', { level: 3 });
      expect(editor.getHTML()).toBe('<h3>Title</h3>');
    });

    it('returns false for unknown type', () => {
      editor = new Editor({ extensions, content: '<p>Text</p>' });
      setSelection(editor, 2);
      expect(editor.commands.updateAttributes('fake', { x: 1 })).toBe(false);
    });

    it('updates mark attributes (link href)', () => {
      editor = new Editor({
        extensions,
        content: '<p><a href="https://old.com">Link</a></p>',
      });
      setSelection(editor, 1, 5);
      editor.commands.updateAttributes('link', { href: 'https://new.com' });
      expect(editor.getHTML()).toContain('href="https://new.com"');
    });

    it('returns false when no matching nodes in selection', () => {
      editor = new Editor({ extensions, content: '<p>No heading here</p>' });
      setSelection(editor, 2);
      expect(editor.commands.updateAttributes('heading', { level: 2 })).toBe(false);
    });
  });

  describe('resetAttributes', () => {
    it('resets heading level to default', () => {
      editor = new Editor({ extensions, content: '<h3>Title</h3>' });
      setSelection(editor, 2);
      editor.commands.resetAttributes('heading', 'level');
      // Default level is 1
      expect(editor.getHTML()).toBe('<h1>Title</h1>');
    });

    it('returns false for unknown type', () => {
      editor = new Editor({ extensions, content: '<p>Text</p>' });
      setSelection(editor, 2);
      expect(editor.commands.resetAttributes('unknown', 'level')).toBe(false);
    });

    it('returns false when no matching nodes found', () => {
      editor = new Editor({ extensions, content: '<p>No heading</p>' });
      setSelection(editor, 2);
      expect(editor.commands.resetAttributes('heading', 'level')).toBe(false);
    });
  });
});
