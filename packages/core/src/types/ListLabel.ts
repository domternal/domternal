/** The counter formats supported by the optional list label contract. */
export type ListLabelFormat = 'decimal' | 'lower-alpha' | 'upper-alpha' | 'lower-roman' | 'upper-roman';

/** A dynamic ordered marker. Its number comes from the list, never from this value. */
export type CounterListLabel = Readonly<{
  readonly kind: 'counter';
  readonly format: ListLabelFormat;
  readonly prefix: string;
  readonly suffix: string;
}>;

/** A literal unordered marker without HTML, CSS or a font dependency. */
export type TextListLabel = Readonly<{
  readonly kind: 'text';
  readonly text: string;
}>;

/** A reference to this item (0) or an enclosing list item (1 through 8). */
export type CompoundListLabelCounter = Readonly<{
  readonly ancestor: number;
  readonly format: ListLabelFormat | 'inherit';
}>;

/** A bounded template whose counter references follow the actual list ancestry. */
export type CompoundListLabel = Readonly<{
  readonly kind: 'compound';
  readonly parts: (string | CompoundListLabelCounter)[];
  readonly fallback: ListLabelFormat;
}>;

/** Resolved enclosing counter, nearest parent first; null denotes an unordered parent. */
export type ListLabelAncestor = Readonly<{ readonly ordinal: number; readonly format: ListLabelFormat }> | null;

/** Optional marker presentation, separate from list identity and ordered starts. */
export type ListLabel = CounterListLabel | TextListLabel | CompoundListLabel;
