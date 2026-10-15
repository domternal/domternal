/** The counter formats supported by the optional list label contract. */
export type ListLabelFormat = 'decimal' | 'lower-alpha' | 'upper-alpha' | 'lower-roman' | 'upper-roman';

/** A dynamic ordered marker. Its number comes from the list, never from this value. */
export interface CounterListLabel {
  readonly kind: 'counter';
  readonly format: ListLabelFormat;
  readonly prefix: string;
  readonly suffix: string;
}

/** A literal unordered marker without HTML, CSS or a font dependency. */
export interface TextListLabel {
  readonly kind: 'text';
  readonly text: string;
}

/** Optional marker presentation, separate from list identity and ordered starts. */
export type ListLabel = Readonly<CounterListLabel> | Readonly<TextListLabel>;
