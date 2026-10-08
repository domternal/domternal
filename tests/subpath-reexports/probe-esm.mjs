// ESM half of the tests/subpath-reexports behavior probe. check.mjs copies it into
// a temporary consumer whose node_modules link the package under test, so the bare
// specifiers below resolve through the package's real exports map.
import { createRequire } from 'node:module';

const [packageName, subpathSpecifier] = process.argv.slice(2);
const { probe, RESULT_PREFIX } = createRequire(import.meta.url)('./probe-body.cjs');
const result = await probe('esm', (specifier) => import(specifier), packageName, subpathSpecifier);
console.log(`${RESULT_PREFIX}${JSON.stringify(result)}`);
