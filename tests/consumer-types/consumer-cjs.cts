/**
 * The CommonJS half of the consumer type check.
 *
 * Every package here ships two declaration graphs, `.d.ts` for `import` and
 * `.d.cts` for `require`, and until this file existed only the first one was
 * ever type-checked. A CommonJS consumer reads the other one, and the two are
 * emitted separately: a rewritten specifier, a lost `types` condition or a
 * re-export that only resolves under `import` breaks the `.d.cts` graph while
 * the `.d.ts` graph stays perfectly healthy.
 *
 * Its own config, `tsconfig.check-cjs.json`, keeps `skipLibCheck` off so the
 * declaration files this file pulls in are checked rather than trusted.
 *
 * The `require` form is the point. `verbatimModuleSyntax` forbids ESM syntax
 * in a `.cts` file, so writing these as `import ... from` would not compile,
 * and writing them as `import type` would resolve the ESM graph instead: the
 * very thing this file is here to avoid.
 *
 * Command calls below are one per augmenting package, not the exhaustive list
 * `consumer.ts` carries. Exhaustiveness is `coverage-check.mjs`'s job and it
 * reads `consumer.ts` only: what is being proved here is that each package's
 * `declare module '@domternal/core'` block lands in its `.d.cts` and resolves
 * to core's `.d.cts` identity, which one call per package settles.
 */
import core = require('@domternal/core');
import blockControls = require('@domternal/extension-block-controls');
import lowlight = require('@domternal/extension-code-block-lowlight');
import details = require('@domternal/extension-details');
import emoji = require('@domternal/extension-emoji');
import image = require('@domternal/extension-image');
import markdown = require('@domternal/extension-markdown');
import math = require('@domternal/extension-math');
import mention = require('@domternal/extension-mention');
import table = require('@domternal/extension-table');
import toc = require('@domternal/extension-toc');

declare const editor: core.Editor;

/*
 * One command per package that augments `RawCommands`, which is every package
 * above except extension-block-controls: its augmentation carries extension
 * points rather than commands, and is exercised further down.
 */
editor.commands.toggleBold();
editor.commands.toggleDetails();
editor.commands.suggestEmoji();
editor.commands.deleteImage();
editor.commands.insertMarkdown('# hi');
editor.commands.insertMathInline('a^2');
editor.commands.deleteMention();
editor.commands.deleteTable();
editor.commands.scrollToHeading('heading-id');
editor.chain().focus().toggleBold().run();

/*
 * Every package's main export, named so a `.d.cts` that resolves but ships an
 * empty or renamed surface fails here rather than passing quietly.
 */
declare const extensions: core.Extension[];
extensions.push(
  blockControls.BlockHandle,
  details.Details,
  emoji.Emoji,
  image.Image,
  markdown.Markdown,
  math.MathInline,
  mention.Mention,
  table.Table,
  toc.TableOfContents
);

/**
 * Resolves to `never` when `T` has silently become `any`.
 *
 * The two re-exports below cross a package boundary, and a boundary that stops
 * resolving is exactly what turns a re-exported name into `any`. With
 * `skipLibCheck` off, tsc reports that on its own; this pair of assertions
 * keeps the guarantee even if a future dependency ever forces the flag back
 * on, the way it is forced on next door in the Pro repository.
 */
type NotAny<T> = 0 extends 1 & T ? never : T;
/** Compiles only for `true`, so a `false` argument is the failure. */
type Assert<T extends true> = T;

/* Re-exported by extension-block-controls from @domternal/core. */
type _FloatingMenuResolves = Assert<
  [NotAny<blockControls.FloatingMenuOptions>] extends [never] ? false : true
>;
/* Re-exported by extension-table from @domternal/pm/tables. */
type _TableMapResolves = Assert<[NotAny<table.TableMap>] extends [never] ? false : true>;
/* Lowlight augments no commands, so an options type is what there is to touch. */
type _LowlightResolves = Assert<
  [NotAny<lowlight.CodeBlockLowlightOptions>] extends [never] ? false : true
>;

/* The BlockHandle option shape, mirroring the ESM consumer's own check. */
declare const provider: blockControls.DropZoneProvider;
blockControls.BlockHandle.configure({
  dropZoneProviders: [provider],
  nested: { allowedNodes: ['paragraph'], anchorContainers: ['column'] },
});
