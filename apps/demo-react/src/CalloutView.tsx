import { NodeViewWrapper, NodeViewContent, type ReactNodeViewProps } from '@domternal/react';

/**
 * React NodeView for the Callout demo extension.
 *
 * Exercises the full ReactNodeViewRenderer contract:
 * - props (node, selected) re-render the component when ProseMirror updates
 * - updateAttributes() changes node.attrs and persists to the document
 * - deleteNode() removes the node
 * - NodeViewWrapper / NodeViewContent provide the wrapper + editable content
 * - the editor instance is available directly via props (React idiom; no inject)
 */

export type CalloutVariant = 'info' | 'warning' | 'success' | 'danger';

const VARIANTS: { value: CalloutVariant; icon: string; label: string }[] = [
  { value: 'info', icon: 'ℹ️', label: 'Info' },
  { value: 'warning', icon: '⚠️', label: 'Warning' },
  { value: 'success', icon: '✅', label: 'Success' },
  { value: 'danger', icon: '\u{1F6A8}', label: 'Danger' },
];

export function CalloutView({ node, selected, updateAttributes, deleteNode, editor }: ReactNodeViewProps) {
  const variant = (node.attrs['variant'] as CalloutVariant) ?? 'info';
  const current = VARIANTS.find((v) => v.value === variant) ?? VARIANTS[0];

  return (
    <NodeViewWrapper
      className={`callout callout--${variant}${selected ? ' callout--selected' : ''}`}
      data-variant={variant}
      data-testid="callout-wrapper"
    >
      <div className="callout-header" contentEditable={false}>
        <span className="callout-icon" data-testid="callout-icon">{current.icon}</span>
        <select
          className="callout-variant"
          data-testid="callout-variant-select"
          value={variant}
          onChange={(e) => updateAttributes({ variant: e.target.value })}
        >
          {VARIANTS.map((v) => (
            <option key={v.value} value={v.value}>{v.label}</option>
          ))}
        </select>
        <span data-testid="callout-editor-ok">{editor ? 'editor' : 'no-editor'}</span>
        <button
          type="button"
          className="callout-focus-btn"
          data-testid="callout-focus-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.view.focus()}
        >
          Focus editor
        </button>
        <button
          type="button"
          className="callout-delete-btn"
          data-testid="callout-delete-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => deleteNode()}
        >
          ×
        </button>
      </div>
      <NodeViewContent className="callout-content" />
    </NodeViewWrapper>
  );
}
