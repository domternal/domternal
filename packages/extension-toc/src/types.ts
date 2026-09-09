/**
 * Public types for `@domternal/extension-toc`.
 */

/**
 * One entry in `editor.storage.toc.content`. The first 4 fields come
 * from the PM doc walk (`headingWalk`). The observer resolves `domNode`
 * after the view is connected and maintains the activity flags.
 */
export interface HeadingEntry {
  /**
   * Stable identifier sourced from the `UniqueID` extension's per-block
   * id (default DOM attribute: `id`). TOC reads this; it does not write
   * its own. The id is a peer-resolved attribute, not owned by TOC.
   */
  id: string;
  /** Heading level (1-6). */
  level: number;
  /** Plain text contents of the heading. */
  textContent: string;
  /** ProseMirror document position. */
  pos: number;
  /** Resolved DOM node, or null while the editor view is detached. */
  domNode: HTMLElement | null;
  /** True for the heading the user is currently "at" per scroll position. */
  isActive: boolean;
  /** True when the heading top has reached the scroll root's activation line. */
  isScrolledOver: boolean;
}

/**
 * Shape of `editor.storage.toc`. `subscribers` is the internal fan-out
 * registry that listeners (NodeViews, floating outline) push themselves
 * onto; the `onUpdate` option is the public consumer-facing callback and
 * is orthogonal to this Set.
 */
export interface TocStorage {
  content: HeadingEntry[];
  activeId: string | null;
  subscribers: Set<() => void>;
}

/**
 * Configuration for the `TableOfContents` extension.
 */
export interface TableOfContentsOptions {
  /**
   * Heading levels to track. Out-of-range levels are ignored by the walk.
   * @default [1, 2, 3]
   */
  levels: number[];

  /**
   * Node names to treat as anchors. Defaults to just the built-in
   * `heading` node; pass extra names to include custom heading-like
   * nodes contributed by other extensions.
   *
   * NOTE: every type listed here MUST also be in `UniqueID.options.types`
   * (UniqueID's defaults already include `'heading'`). TOC reads ids
   * UniqueID assigns; it does not assign them itself.
   * @default ['heading']
   */
  anchorTypes: string[];

  /** Scroll root. Omitted values inherit FloatingTocOutline's legacy option. */
  activeScrollParent?: Element | Document | null;

  /** Observer margin. Omitted values inherit the outline option or the default. */
  activeRootMargin?: string;

  /** Activation line in pixels below the scroll root's inner top. @default 0 */
  activeOffset?: number;

  /** Navigation override duration; inherits the outline option or 500 ms. */
  clickOverrideMs?: number;

  /**
   * Public consumer callback fired whenever the heading list or active
   * state changes. Internal listeners use the `subscribers` Set on
   * storage; this option is the user-facing escape hatch.
   *
   * For custom id format, configure `UniqueID.generateID` instead - TOC
   * reads UniqueID's ids and does not own id generation.
   */
  onUpdate?: (storage: TocStorage) => void;
}
