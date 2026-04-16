// Composables
export { useEditor, DEFAULT_EXTENSIONS } from './useEditor.js';
export type { UseEditorOptions } from './useEditor.js';
export { useEditorState } from './useEditorState.js';
export type { EditorState } from './useEditorState.js';
export { useCurrentEditor, provideEditor, EDITOR_KEY } from './EditorContext.js';

// Composable component
export { Domternal } from './Domternal.js';
export type { DomternalProps } from './Domternal.js';

// Components
export { DomternalEditor } from './DomternalEditor.js';
export type { DomternalEditorProps } from './DomternalEditor.js';
export { EditorContent } from './EditorContent.js';
export { DomternalToolbar } from './toolbar/DomternalToolbar.js';
export type { DomternalToolbarProps } from './toolbar/DomternalToolbar.js';
export { DomternalBubbleMenu } from './bubble-menu/DomternalBubbleMenu.js';
export type { DomternalBubbleMenuProps } from './bubble-menu/DomternalBubbleMenu.js';
export { DomternalFloatingMenu } from './DomternalFloatingMenu.js';
export type { DomternalFloatingMenuProps } from './DomternalFloatingMenu.js';
export { DomternalEmojiPicker } from './emoji-picker/DomternalEmojiPicker.js';
export type { DomternalEmojiPickerProps } from './emoji-picker/DomternalEmojiPicker.js';
export type { EmojiPickerItem } from './emoji-picker/useEmojiPicker.js';

// Node Views
export { VueNodeViewRenderer } from './node-views/VueNodeViewRenderer.js';
export type { VueNodeViewProps, VueNodeViewRendererOptions } from './node-views/VueNodeViewRenderer.js';
export { NodeViewWrapper } from './node-views/NodeViewWrapper.js';
export { NodeViewContent } from './node-views/NodeViewContent.js';
export { useVueNodeView } from './node-views/VueNodeViewContext.js';

// Re-export commonly used types and utilities from core for convenience
export { Editor } from '@domternal/core';
export type { Content, AnyExtension, FocusPosition, JSONContent } from '@domternal/core';

// SSR helpers - work without an editor instance (server-safe)
export { generateHTML, generateJSON, generateText } from '@domternal/core';
export type { GenerateHTMLOptions, GenerateJSONOptions, GenerateTextOptions } from '@domternal/core';

// Subcomponent assignments (Toolbar, BubbleMenu, etc.) live in Domternal.ts
// to prevent tree-shaking from dropping them as unused side effects.
