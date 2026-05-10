/**
 * TaskItemNodeView
 *
 * NodeView for the TaskItem node. Owns the live `<li>` DOM and translates
 * mouse interaction on the checkbox into ProseMirror transactions.
 *
 * Without a NodeView, clicking the checkbox flips it visually in the
 * browser but PM never learns about it: `node.attrs.checked` stays the
 * same, the next render restores the old state, and theme styling tied
 * to `data-checked="true"` (strikethrough in `_task-list.scss`) never
 * applies. The keyboard shortcut Mod+Enter calls the toggleTask command
 * directly so it already worked; this NodeView fixes the mouse path.
 *
 * DOM contract: identical structure to TaskItem.renderHTML so parseDOM
 * round-trips cleanly and getHTML() output is unchanged.
 *   <li data-type="taskItem" data-checked="true|false" {...HTMLAttributes}>
 *     <label contenteditable="false">
 *       <input type="checkbox" aria-label="Task status">
 *     </label>
 *     <div>{contentDOM}</div>
 *   </li>
 *
 * Event handling:
 *   - `change` on the input dispatches a setNodeMarkup transaction with
 *     the toggled `checked` attribute. PM then calls our `update(node)`
 *     which re-syncs `data-checked`, `input.checked`, and `input.disabled`.
 *   - `stopEvent` returns true for any event whose target is inside the
 *     label subtree, so PM does not turn a checkbox click into a node
 *     selection or otherwise interfere with the native checkbox.
 *   - `ignoreMutation` filters mutations on the label subtree because we
 *     manage that DOM ourselves; PM should not roll back our edits to it.
 */

import type { Node as PMNode, NodeType } from '@domternal/pm/model';
import type { EditorView, NodeView, ViewMutationRecord } from '@domternal/pm/view';
import type { TaskItemOptions } from './TaskItem.js';

interface TaskItemNodeViewArgs {
  options: TaskItemOptions;
  node: PMNode;
  view: EditorView;
  getPos: () => number | undefined;
}

export class TaskItemNodeView implements NodeView {
  readonly dom: HTMLLIElement;
  readonly contentDOM: HTMLDivElement;
  private readonly label: HTMLLabelElement;
  private readonly input: HTMLInputElement;
  private readonly view: EditorView;
  private readonly nodeType: NodeType;
  private readonly getPos: () => number | undefined;
  private node: PMNode;

  constructor({ options, node, view, getPos }: TaskItemNodeViewArgs) {
    this.view = view;
    this.nodeType = node.type;
    this.node = node;
    this.getPos = getPos;

    this.dom = document.createElement('li');
    // Apply consumer-supplied HTMLAttributes first so our identity
    // attributes (data-type, data-checked) take precedence on collision.
    for (const [key, value] of Object.entries(options.HTMLAttributes)) {
      if (value !== null && value !== undefined) {
        this.dom.setAttribute(key, typeof value === 'string' ? value : JSON.stringify(value));
      }
    }
    this.dom.setAttribute('data-type', 'taskItem');
    this.dom.setAttribute('data-checked', node.attrs['checked'] ? 'true' : 'false');

    this.label = document.createElement('label');
    this.label.setAttribute('contenteditable', 'false');

    this.input = document.createElement('input');
    this.input.type = 'checkbox';
    this.input.checked = !!node.attrs['checked'];
    this.input.disabled = !view.editable;
    this.input.setAttribute('aria-label', 'Task status');

    this.label.appendChild(this.input);
    this.dom.appendChild(this.label);

    this.contentDOM = document.createElement('div');
    this.dom.appendChild(this.contentDOM);

    this.input.addEventListener('change', this.handleChange);
  }

  private handleChange = (event: Event): void => {
    event.preventDefault();
    if (!this.view.editable) {
      // Revert the visual flip; PM never sees a transaction.
      this.input.checked = !!this.node.attrs['checked'];
      return;
    }
    const pos = this.getPos();
    if (pos === undefined) return;
    const { state, dispatch } = this.view;
    const tr = state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      checked: this.input.checked,
    });
    dispatch(tr);
  };

  update(node: PMNode): boolean {
    // Type mismatch: tell PM to rebuild the view. Different node type
    // means different schema, so reusing this DOM tree is unsafe.
    if (node.type !== this.nodeType) return false;
    this.node = node;
    const checked = !!node.attrs['checked'];
    this.dom.setAttribute('data-checked', checked ? 'true' : 'false');
    this.input.checked = checked;
    this.input.disabled = !this.view.editable;
    return true;
  }

  stopEvent(event: Event): boolean {
    // Events on the label / input subtree are owned by the checkbox.
    // Returning true keeps PM from treating the click as a selection
    // or otherwise interfering with the native checkbox interaction.
    return event.target instanceof Node && this.label.contains(event.target);
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    // We manage the label / input DOM ourselves (toggling checked,
    // disabled). PM should not interpret those mutations as edits.
    return mutation.target instanceof Node && this.label.contains(mutation.target);
  }

  destroy(): void {
    this.input.removeEventListener('change', this.handleChange);
  }
}
