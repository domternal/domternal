# Deferred compatibility changes

Status: design backlog, not an approved implementation or release plan.

Created September 8, 2026 after reviewing the tutorial findings in videos 21 to 28.

## Current delivery policy

Repair incorrect behavior and examples while preserving existing public defaults, saved document schemas, and creation-time lifecycle events. Additive APIs can ship in a compatible minor release. Keep deliberately incompatible redesigns separate until their migration benefit justifies the cost.

A long backlog is not by itself a reason to release a major version. Review each proposal, document the old and new contracts, provide a migration example, and validate consumers before scheduling it. Version 2.0.0 is appropriate for an accepted incompatible public API change to a package currently on 1.x. The Free and Pro release groups are independent; neither automatically forces every repository to version 2.

## Candidates requiring a compatibility decision

| Area | Compatible work now | Deferred decision | Migration evidence needed |
| --- | --- | --- | --- |
| Editor lifecycle | Add explicit DOM adoption while preserving mount/create timing, existing EditorView, history and plugin state. | Delay editor construction by default or redefine mount/create as connected-host events. | React/Vue immediate rendering, SSR, extension setup and Pro collaboration lifecycle comparisons. |
| Link boundaries | Insert recognized URL delimiters outside Link, preserving other marks and existing explicit exit behavior. | Make every link non-inclusive by default, including manually named links, and redesign typed URL growth. | Keyboard, composition, selection, existing link editing, stored marks and migration examples. |
| Shared menu filtering | Honor slash exclusions for non-list ancestors while preserving existing list nesting rules. | Apply hideWhenInside to the floating menu by default or remove special list policies. | Existing item configurations, custom containers, child paragraphs and nearest-list conversions. |
| Children placement | Document the current React sibling layout. | Move existing children inside the editor wrapper or change their default order. | Existing CSS/layout consumers and framework DOM ownership. Explicit new slots can be additive instead. |
| String insertion | Document insertText for literal snippets and retain insertContent's HTML parsing. | Infer plain text from insertContent strings or change the default parsing mode. | HTML snippets, bare strings, whitespace, inline marks and stored integration behavior. An explicit format option can be additive. |
| Theme tokens | Document overrides on the roots that declare the tokens. | Move defaults to ancestors or redesign inherited component and semantic tokens. | Computed styles under nested themes, sibling toolbars, external outlines, Angular encapsulation and print. |
| Storage typing | Use exported storage types and runtime extension names in strict examples. | Replace the storage contract or require a generic extension tuple on Editor. | Existing custom extensions, module augmentation, optional storage and consumers of Editor's public declarations. Additive typing helpers do not inherently require v2. |
| Icon ownership | Add a scoped SlashCommand icon option without changing other registries. | Introduce a shared registry that changes existing toolbar/menu override precedence. | Per-surface overrides, custom renderers, missing keys, multiple editors and reactive replacement. A new opt-in registry can be additive. |
| Shortcut syntax | Document executable case-sensitive keys separately from display hints. | Normalize existing shortcut strings automatically. | Shift semantics, keyboard layouts, aliases and conflicting bindings. |
| Export warning callbacks | Document accepted-run panel reset and preserve non-empty onWarnings callbacks. | Call existing onWarnings with empty lists or change its delivery timing. | Duplicate clicks, failed exports, default downloads and custom delivery. A separate status subscription can be additive. |
| Export image resolution | Use an explicit resolver with a known content base URL. | Resolve relative URLs implicitly from browser globals by default. | Node behavior, persisted asset bases, protocol policy and remote-image restrictions. An explicit base option can be additive. |

## Behavior to retain

- Keep the saved TOC node name `tableOfContents`; fix examples that use the wrong name.
- Keep UniqueID defaults and existing block IDs. Heading-only IDs belong to the minimal TOC example.
- Keep unresolved author IDs as the export fallback and require schemas to know their saved marks.
- Do not treat HTML attribute order as a serialized document contract.
- Preserve TrailingNode, input-rule undo semantics and scroll clamping at the document end.

## Release preparation for the current compatible fixes

No versions, package publication or deployment are authorized by this implementation record.

The working packages started at Free 1.0.3 and Pro 1.0.2. New public APIs include `Editor.adoptDom`, the `adopt` event, `createAdoptablePluginView`, SlashCommand's `icons` option, and TOC activity options/types. A compatible Free minor release such as 1.1.0 is the intended SemVer category when preparing a release; patch-only subsets can be released separately if their dependencies permit it.

Before publishing packages that call the new core adoption API, raise their minimum core dependency/peer version to the first release that contains it. In particular, check React, Vue, block-controls and TOC. The current development tree still carries its previous version numbers and peer ranges; do not publish it by only changing one package version. Rebuild and run consumer and Pro compatibility checks after the coordinated release manifests are prepared.

For an eventual major release, list accepted proposals here with their owning packages, replacement APIs, deprecation period, migration examples and tests. Remove a legacy API only in that explicitly planned release.
