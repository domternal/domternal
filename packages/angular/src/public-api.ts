export { DomternalEditorComponent, DEFAULT_EXTENSIONS } from './lib/editor.component';
export { DomternalToolbarComponent } from './lib/toolbar.component';
export { DomternalBubbleMenuComponent } from './lib/bubble-menu.component';
export { DomternalFloatingMenuComponent } from './lib/floating-menu.component';
export { DomternalEmojiPickerComponent } from './lib/emoji-picker.component';
export type { EmojiPickerItem } from './lib/emoji-picker.component';

// Re-export commonly used types from core for convenience
export { Editor } from '@domternal/core';
export type { Content, AnyExtension, FocusPosition, JSONContent } from '@domternal/core';
