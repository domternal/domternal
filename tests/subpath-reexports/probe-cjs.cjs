// CommonJS half of the tests/subpath-reexports behavior probe. check.mjs copies it
// into a temporary consumer whose node_modules link the package under test, so the
// bare specifiers below resolve through the package's real exports map.
'use strict';
const { probe, RESULT_PREFIX } = require('./probe-body.cjs');

const [packageName, subpathSpecifier] = process.argv.slice(2);
probe('cjs', async (specifier) => require(specifier), packageName, subpathSpecifier).then((result) => {
  console.log(`${RESULT_PREFIX}${JSON.stringify(result)}`);
});
