/**
 * Markdown parse state: token stream in, ProseMirror nodes out. Same shape as
 * prosemirror-markdown's parse state, built on `@domternal/pm` types.
 */
import { Mark } from '@domternal/pm/model';
import type { Attrs, MarkType, Node as PMNode, NodeType, Schema } from '@domternal/pm/model';

interface StackFrame {
  type: NodeType;
  attrs: Attrs | null;
  content: PMNode[];
  /** Discard the frame when it closes empty (paragraph split around a block image). */
  discardWhenEmpty: boolean;
}

function maybeMerge(a: PMNode, b: PMNode): PMNode | null {
  if (a.isText && b.isText && Mark.sameSet(a.marks, b.marks)) {
    return (a as PMNode & { withText: (text: string) => PMNode }).withText(
      (a.text ?? '') + (b.text ?? '')
    );
  }
  return null;
}

export class MarkdownParseState {
  readonly schema: Schema;
  private readonly stack: StackFrame[];
  private marks: readonly Mark[] = Mark.none;

  constructor(schema: Schema) {
    this.schema = schema;
    this.stack = [
      { type: schema.topNodeType, attrs: null, content: [], discardWhenEmpty: false },
    ];
  }

  private top(): StackFrame {
    const frame = this.stack[this.stack.length - 1];
    if (frame === undefined) throw new Error('markdown parse stack underflow');
    return frame;
  }

  /** The node type currently being built (for split decisions). */
  topType(): NodeType {
    return this.top().type;
  }

  push(node: PMNode): void {
    this.top().content.push(node);
  }

  addText(text: string): void {
    if (text === '') return;
    const content = this.top().content;
    const last = content[content.length - 1];
    const node = this.schema.text(text, this.marks);
    const merged = last !== undefined ? maybeMerge(last, node) : null;
    if (merged !== null) {
      content[content.length - 1] = merged;
    } else {
      content.push(node);
    }
  }

  openMark(mark: Mark): void {
    this.marks = mark.addToSet(this.marks);
  }

  closeMark(type: MarkType): void {
    this.marks = type.removeFromSet(this.marks);
  }

  addNode(type: NodeType, attrs: Attrs | null, content?: PMNode[]): PMNode | null {
    const node = type.createAndFill(attrs, content, type.isInline ? this.marks : undefined);
    if (node === null) return null;
    this.push(node);
    return node;
  }

  openNode(type: NodeType, attrs: Attrs | null = null, discardWhenEmpty = false): void {
    this.stack.push({ type, attrs, content: [], discardWhenEmpty });
  }

  closeNode(): PMNode | null {
    if (this.marks.length > 0) this.marks = Mark.none;
    const frame = this.stack.pop();
    if (frame === undefined) throw new Error('markdown parse stack underflow');
    if (frame.discardWhenEmpty && frame.content.length === 0) return null;
    const node = frame.type.createAndFill(frame.attrs, frame.content);
    if (node === null) return null;
    this.push(node);
    return node;
  }

  /**
   * Close the innermost frame and reopen the same type after inserting
   * `node` as a sibling: how a block-level image escapes its paragraph.
   */
  splitAround(node: PMNode): void {
    const frame = this.stack.pop();
    if (frame === undefined) throw new Error('markdown parse stack underflow');
    if (frame.content.length > 0) {
      const closed = frame.type.createAndFill(frame.attrs, frame.content);
      if (closed !== null) this.push(closed);
    }
    this.push(node);
    this.openNode(frame.type, frame.attrs, true);
  }

  /** Build the final document; called once after all tokens are consumed. */
  finish(): PMNode {
    while (this.stack.length > 1) this.closeNode();
    const frame = this.stack.pop();
    if (frame === undefined) throw new Error('markdown parse stack underflow');
    const doc = frame.type.createAndFill(frame.attrs, frame.content);
    if (doc === null) throw new Error('markdown parse produced an invalid document');
    return doc;
  }
}
