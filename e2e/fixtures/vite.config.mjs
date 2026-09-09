import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureRoot = fileURLToPath(new URL('.', import.meta.url));
const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));
const reactRequire = createRequire(join(workspaceRoot, 'apps/demo-react/package.json'));
const vueRequire = createRequire(join(workspaceRoot, 'apps/demo-vue/package.json'));
const pmRequire = createRequire(join(workspaceRoot, 'packages/pm/package.json'));
const coreRequire = createRequire(join(workspaceRoot, 'packages/core/package.json'));
const lowlightRequire = createRequire(join(workspaceRoot, 'packages/extension-code-block-lowlight/package.json'));
const aliases = [];

// Exercise the public ESM builds consumed by applications. Resolve all
// ProseMirror imports through one installation so selections share identity.
for (const directory of readdirSync(join(workspaceRoot, 'packages'))) {
  const packageRoot = join(workspaceRoot, 'packages', directory);
  const manifestPath = join(packageRoot, 'package.json');
  if (!existsSync(manifestPath)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const [subpath, entry] of Object.entries(manifest.exports ?? {})) {
    const target = typeof entry === 'string' ? entry : entry.import?.default ?? entry.default;
    if (typeof target !== 'string' || subpath.includes('*')) continue;
    aliases.push({
      find: manifest.name + (subpath === '.' ? '' : subpath.slice(1)),
      replacement: join(packageRoot, target),
    });
  }
}
const pmPackages = Object.keys(JSON.parse(readFileSync(
  join(workspaceRoot, 'packages/pm/package.json'), 'utf8',
)).dependencies);
for (const name of pmPackages) {
  aliases.push({ find: name, replacement: join(dirname(pmRequire.resolve(name)), 'index.js') });
}
aliases.push(
  { find: 'react', replacement: dirname(reactRequire.resolve('react/package.json')) },
  { find: 'react-dom', replacement: dirname(reactRequire.resolve('react-dom/package.json')) },
  { find: 'vue', replacement: join(dirname(vueRequire.resolve('vue/package.json')), 'dist/vue.runtime.esm-bundler.js') },
  { find: 'lowlight', replacement: reactRequire.resolve('lowlight') },
  { find: '@floating-ui/dom', replacement: coreRequire.resolve('@floating-ui/dom') },
  { find: 'linkifyjs', replacement: coreRequire.resolve('linkifyjs') },
  { find: 'hast-util-to-html', replacement: lowlightRequire.resolve('hast-util-to-html') },
);
aliases.sort((left, right) => right.find.length - left.find.length);

export default {
  root: fixtureRoot,
  cacheDir: join(workspaceRoot, 'node_modules/.vite/tutorial-fixtures'),
  resolve: { alias: aliases, dedupe: ['react', 'react-dom', 'vue', ...pmPackages] },
  optimizeDeps: {
    entries: ['**/index.html'],
    exclude: aliases.filter(({ find }) => find.startsWith('@domternal/')).map(({ find }) => find),
    include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'vue', 'lowlight',
      '@floating-ui/dom', 'linkifyjs', 'hast-util-to-html', ...pmPackages],
  },
  server: { host: '127.0.0.1', port: 5793, strictPort: true, fs: { allow: [workspaceRoot] } },
};
