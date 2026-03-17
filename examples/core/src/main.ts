import { Editor, StarterKit } from '@domternal/core';

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [StarterKit],
  content: '<p>Hello <strong>World</strong>!</p>',
});
