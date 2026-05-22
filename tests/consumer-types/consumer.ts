/**
 * Type-checks against the BUILT @domternal/core dist (not source) to
 * verify every RawCommands augmentation reaches an external consumer.
 * coverage-check.mjs guarantees this list stays exhaustive.
 */
import type { Editor } from '@domternal/core';

// Bare imports load each extension's `declare module '@domternal/core'`
// augmentation, without which their commands appear missing.
import '@domternal/extension-details';
import '@domternal/extension-emoji';
import '@domternal/extension-image';
import '@domternal/extension-mention';
import '@domternal/extension-table';
import '@domternal/extension-toc';

declare const editor: Editor;

editor.commands.focus();
editor.commands.focus('end');
editor.commands.blur();
editor.commands.setContent('<p>hi</p>');
editor.commands.clearContent();
editor.commands.insertText('hi');
editor.commands.deleteSelection();
editor.commands.selectAll();
editor.commands.toggleMark('bold');
editor.commands.setMark('bold');
editor.commands.unsetMark('bold');
editor.commands.unsetAllMarks();
editor.commands.setBlockType('paragraph');
editor.commands.toggleBlockType('heading', 'paragraph');
editor.commands.wrapIn('blockquote');
editor.commands.toggleWrap('blockquote');
editor.commands.lift();
editor.commands.toggleList('bulletList', 'listItem');
editor.commands.insertContent('<p>hi</p>');
editor.commands.selectNodeBackward();
editor.commands.updateAttributes('paragraph', { textAlign: 'center' });
editor.commands.resetAttributes('paragraph', 'textAlign');

editor.commands.setBold();
editor.commands.unsetBold();
editor.commands.toggleBold();
editor.commands.setItalic();
editor.commands.unsetItalic();
editor.commands.toggleItalic();
editor.commands.setUnderline();
editor.commands.unsetUnderline();
editor.commands.toggleUnderline();
editor.commands.setStrike();
editor.commands.unsetStrike();
editor.commands.toggleStrike();
editor.commands.setCode();
editor.commands.unsetCode();
editor.commands.toggleCode();
editor.commands.setSubscript();
editor.commands.unsetSubscript();
editor.commands.toggleSubscript();
editor.commands.setSuperscript();
editor.commands.unsetSuperscript();
editor.commands.toggleSuperscript();
editor.commands.setLink({ href: 'https://example.com' });
editor.commands.unsetLink();
editor.commands.toggleLink({ href: 'https://example.com' });
editor.commands.setTextStyle({});
editor.commands.removeTextStyle();
editor.commands.removeEmptyTextStyle();

editor.commands.setHeading({ level: 1 });
editor.commands.toggleHeading({ level: 2 });
editor.commands.setParagraph();
editor.commands.setCodeBlock();
editor.commands.toggleCodeBlock();
editor.commands.setBlockquote();
editor.commands.toggleBlockquote();
editor.commands.unsetBlockquote();
editor.commands.setHorizontalRule();
editor.commands.toggleBulletList();
editor.commands.toggleOrderedList();
editor.commands.toggleTaskList();
editor.commands.toggleTask();
editor.commands.setHardBreak();
editor.commands.insertNbsp();

editor.commands.setBlockBgColor('red');
editor.commands.setBlockTextColor('red');
editor.commands.unsetBlockColors();
editor.commands.setFontFamily('Inter');
editor.commands.unsetFontFamily();
editor.commands.setFontSize('14px');
editor.commands.unsetFontSize();
editor.commands.setHighlight();
editor.commands.unsetHighlight();
editor.commands.toggleHighlight();
editor.commands.setBackgroundColorToken('red');
editor.commands.unsetBackgroundColorToken();
editor.commands.undo();
editor.commands.redo();
editor.commands.toggleInvisibleChars();
editor.commands.showInvisibleChars();
editor.commands.hideInvisibleChars();
editor.commands.setLineHeight('1.5');
editor.commands.unsetLineHeight();
editor.commands.setSelection({} as never);
editor.commands.selectNode({} as never);
editor.commands.selectParentNode();
editor.commands.extendSelection({} as never);
editor.commands.setTextAlign('center');
editor.commands.unsetTextAlign();
editor.commands.setTextColor('red');
editor.commands.unsetTextColor();
editor.commands.setTextColorToken('red');
editor.commands.unsetTextColorToken();

editor.commands.setDetails();
editor.commands.unsetDetails();
editor.commands.toggleDetails();
editor.commands.openDetails();
editor.commands.closeDetails();
editor.commands.setDetailsOpen(true);

editor.commands.insertEmoji({} as never);
editor.commands.suggestEmoji();

editor.commands.setImage({ src: 'x' });
editor.commands.setImageFloat('left');
editor.commands.deleteImage();

editor.commands.insertMention({} as never);
editor.commands.deleteMention();

editor.commands.insertTable({ rows: 2, cols: 2 });
editor.commands.deleteTable();
editor.commands.addRowBefore();
editor.commands.addRowAfter();
editor.commands.deleteRow();
editor.commands.addColumnBefore();
editor.commands.addColumnAfter();
editor.commands.deleteColumn();
editor.commands.toggleHeaderRow();
editor.commands.toggleHeaderColumn();
editor.commands.toggleHeaderCell();
editor.commands.mergeCells();
editor.commands.splitCell();
editor.commands.setCellAttribute('background', 'red');
editor.commands.goToNextCell();
editor.commands.goToPreviousCell();
editor.commands.fixTables();
editor.commands.setCellSelection({} as never);

editor.commands.scrollToHeading('heading-id');

editor.chain().focus().toggleBold().toggleItalic().run();
editor.can().toggleBold();
