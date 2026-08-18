# @domternal/extension-block-menu

> ⚠️ **Deprecated - renamed to [`@domternal/extension-block-controls`](https://www.npmjs.com/package/@domternal/extension-block-controls).**
>
> This package is now a thin compatibility shim that re-exports
> `@domternal/extension-block-controls` unchanged, so existing imports keep
> working. Update your imports:
>
> ```diff
> - import { BlockHandle, SlashCommand } from '@domternal/extension-block-menu';
> + import { BlockHandle, SlashCommand } from '@domternal/extension-block-controls';
> ```
>
> The shim keeps working through the 0.x line and is removed in v1.0.0.

[![Version](https://img.shields.io/npm/v/@domternal/extension-block-menu.svg)](https://www.npmjs.com/package/@domternal/extension-block-menu)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

## Links

<u>[Website](https://domternal.dev)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Documentation](https://domternal.dev/v1/extensions/block-controls)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Live examples](https://domternal.dev/examples)</u>

## Migrate

There is nothing to install here. Replace this package with the one it was
renamed to:

```bash
pnpm remove @domternal/extension-block-menu
pnpm add @domternal/extension-block-controls
```

`@domternal/core` and `@domternal/pm` remain peer dependencies of the new
package. The floating menu plugin itself now lives in `@domternal/core`, so the
Angular, React, Vue, and Vanilla wrappers need only `@domternal/core` and
`@domternal/theme`; add `@domternal/extension-block-controls` when you want the
block handle, slash menu, or drag-and-drop.

See [`@domternal/extension-block-controls`](https://www.npmjs.com/package/@domternal/extension-block-controls) for the full documentation and API.
