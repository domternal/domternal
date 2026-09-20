/** Official catalogs stay complete, exact and readonly through published declarations. */
import type { CompleteMessages, I18nFormattingContext, Messages, SearchAliases } from '@domternal/core';
import type { coreMessages } from '@domternal/core';
import * as coreDe from '@domternal/core/locales/de';
import type { blockControlsMessages } from '@domternal/extension-block-controls';
import * as blockControlsDe from '@domternal/extension-block-controls/locales/de';
import type { tableMessages } from '@domternal/extension-table';
import * as tableDe from '@domternal/extension-table/locales/de';
import type { imageMessages } from '@domternal/extension-image';
import * as imageDe from '@domternal/extension-image/locales/de';
import type { detailsMessages } from '@domternal/extension-details';
import * as detailsDe from '@domternal/extension-details/locales/de';
import type { emojiMessages } from '@domternal/extension-emoji';
import * as emojiDe from '@domternal/extension-emoji/locales/de';
import type { mathMessages } from '@domternal/extension-math';
import * as mathDe from '@domternal/extension-math/locales/de';
import type { mentionMessages } from '@domternal/extension-mention';
import * as mentionDe from '@domternal/extension-mention/locales/de';
import type { tocMessages } from '@domternal/extension-toc';
import * as tocDe from '@domternal/extension-toc/locales/de';

type ExpectedCatalogs = {
  core: Readonly<CompleteMessages<typeof coreMessages>>;
  blockControls: Readonly<CompleteMessages<typeof blockControlsMessages>>;
  table: Readonly<CompleteMessages<typeof tableMessages>>;
  image: Readonly<CompleteMessages<typeof imageMessages>>;
  details: Readonly<CompleteMessages<typeof detailsMessages>>;
  emoji: Readonly<CompleteMessages<typeof emojiMessages>>;
  math: Readonly<CompleteMessages<typeof mathMessages>>;
  mention: Readonly<CompleteMessages<typeof mentionMessages>>;
  toc: Readonly<CompleteMessages<typeof tocMessages>>;
};

const catalogs = {
  core: coreDe.deMessages,
  blockControls: blockControlsDe.deMessages,
  table: tableDe.deMessages,
  image: imageDe.deMessages,
  details: detailsDe.deMessages,
  emoji: emojiDe.deMessages,
  math: mathDe.deMessages,
  mention: mentionDe.deMessages,
  toc: tocDe.deMessages,
} satisfies ExpectedCatalogs;

// A widened string index or any would otherwise conceal missing and unknown keys.
type ExactKeys<Actual, Expected> = 0 extends (1 & Actual) ? false
  : [keyof Actual] extends [keyof Expected]
    ? [keyof Expected] extends [keyof Actual] ? true : false
    : false;
const exactKeys: {
  [Package in keyof ExpectedCatalogs]: ExactKeys<typeof catalogs[Package], ExpectedCatalogs[Package]>;
} = {
  core: true,
  blockControls: true,
  table: true,
  image: true,
  details: true,
  emoji: true,
  math: true,
  mention: true,
  toc: true,
};

const messages: Messages = {
  ...coreDe.deMessages,
  ...blockControlsDe.deMessages,
  ...tableDe.deMessages,
  ...imageDe.deMessages,
  ...detailsDe.deMessages,
  ...emojiDe.deMessages,
  ...mathDe.deMessages,
  ...mentionDe.deMessages,
  ...tocDe.deMessages,
  'core.toolbar.bold': 'Custom bold',
};
const searchAliases: SearchAliases = {
  ...coreDe.deSearchAliases,
  ...blockControlsDe.deSearchAliases,
  ...tableDe.deSearchAliases,
  ...imageDe.deSearchAliases,
  ...detailsDe.deSearchAliases,
  ...emojiDe.deSearchAliases,
  ...mathDe.deSearchAliases,
  ...mentionDe.deSearchAliases,
  ...tocDe.deSearchAliases,
};

// Application-owned overrides are partial; the official catalog remains readonly.
// @ts-expect-error Official messages cannot be mutated.
coreDe.deMessages['core.bubbleMenu.blockActionsSelectionHint'] = 'Changed';
// @ts-expect-error Official messages cannot be mutated.
blockControlsDe.deMessages['blockControls.color.background'] = 'Changed';
// @ts-expect-error Official messages cannot be mutated.
tableDe.deMessages['table.cell.alignBottom'] = 'Changed';
// @ts-expect-error Official messages cannot be mutated.
imageDe.deMessages['image.action.delete'] = 'Changed';
// @ts-expect-error Official messages cannot be mutated.
detailsDe.deMessages['details.insert.description'] = 'Changed';
// @ts-expect-error Official messages cannot be mutated.
emojiDe.deMessages['emoji.insert'] = 'Changed';
// @ts-expect-error Official messages cannot be mutated.
mathDe.deMessages['math.block.description'] = 'Changed';
// @ts-expect-error Official messages cannot be mutated.
mentionDe.deMessages['mention.suggestions.empty'] = 'Changed';
// @ts-expect-error Official messages cannot be mutated.
tocDe.deMessages['toc.block.empty'] = 'Changed';

declare const context: I18nFormattingContext;
const heading = coreDe.deMessages['core.heading.level'];
if (typeof heading === 'function') {
  heading({ level: 2 }, context);
  // @ts-expect-error Locale declarations retain dynamic message parameters.
  heading({ level: 'two' }, context);
}
const cellColor = tableDe.deMessages['table.cell.color'];
if (typeof cellColor === 'function') {
  cellColor({ color: 'blue' }, context);
  // @ts-expect-error Extension parameters survive both declaration graphs.
  cellColor({ color: 2 }, context);
}

// @ts-expect-error Alias keys are restricted to searchable messages.
const invalidAliases: SearchAliases = { 'core.group.insert': ['Insertion'] };
