// The runtime entry of dist/index.js and dist/index.cjs. dist/index.d.ts is built from
// index.ts, so the clipboard bindings stay in the one main bundle for dist/clipboard.*
// to re-export, without the main entry declaring them.
export * from './index.js';
export * from './clipboard.js';
