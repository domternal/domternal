import {
  Bold, Italic, Underline, Strike, Code, Link,
  Heading, Blockquote, HardBreak, HorizontalRule,
  BulletList, OrderedList, TaskList, ListIndent,
  SelectionDecoration, ClearFormatting, Dropcursor,
  type AnyExtension,
} from '@domternal/core';

/**
 * ONE shared extensions array, intentionally reused for every editor in the
 * "Multiple editors" demo (the page-builder pattern and regression surface for
 * the shared-extension-instance bug). Lives in a module so all panel instances
 * import the SAME array reference.
 */
export const sharedExtensions: AnyExtension[] = [
  Bold, Italic, Underline, Strike, Code, Link,
  Heading, Blockquote, HardBreak, HorizontalRule,
  BulletList, OrderedList, TaskList, ListIndent,
  SelectionDecoration, ClearFormatting, Dropcursor,
];

export function sampleContent(n: number): string {
  return (
    `<h2>Editor ${String(n)}</h2>` +
    `<p>Independent editor built from the shared config. Put the caret at the end of a list item and press Enter.</p>` +
    `<ul><li><p>Bullet one</p></li><li><p>Bullet two</p></li></ul>` +
    `<ol><li><p>Ordered one</p></li></ol>` +
    `<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task one</p></li></ul>`
  );
}
