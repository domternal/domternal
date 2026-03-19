import {
  Editor, Document, Text, Paragraph,
  Bold, Italic, Underline,
} from '@domternal/core';

new Editor({
  element: document.getElementById('editor')!,
  extensions: [Document, Text, Paragraph, Bold, Italic, Underline],
  content: '<p>Hello <strong>Bold</strong>, <em>Italic</em> and <u>Underline</u>!</p>',
});