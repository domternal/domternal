// Hooks
export { useEditor, DEFAULT_EXTENSIONS } from './useEditor.js';
export type { UseEditorOptions } from './useEditor.js';
export { useEditorState } from './useEditorState.js';
export type { EditorState } from './useEditorState.js';
export { useCurrentEditor, EditorProvider } from './EditorContext.js';
export type { EditorProviderProps } from './EditorContext.js';

// Components
export { DomternalEditor } from './DomternalEditor.js';
export type { DomternalEditorProps, DomternalEditorRef } from './DomternalEditor.js';
export { EditorContent } from './EditorContent.js';
export type { EditorContentProps } from './EditorContent.js';
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
export { ReactNodeViewRenderer } from './node-views/ReactNodeViewRenderer.js';
export type { ReactNodeViewProps, ReactNodeViewRendererOptions } from './node-views/ReactNodeViewRenderer.js';
export { NodeViewWrapper } from './node-views/NodeViewWrapper.js';
export type { NodeViewWrapperProps } from './node-views/NodeViewWrapper.js';
export { NodeViewContent } from './node-views/NodeViewContent.js';
export type { NodeViewContentProps } from './node-views/NodeViewContent.js';
export { useReactNodeView } from './node-views/ReactNodeViewContext.js';

// Re-export commonly used types from core for convenience
export { Editor } from '@domternal/core';
export type { Content, AnyExtension, FocusPosition, JSONContent } from '@domternal/core';
