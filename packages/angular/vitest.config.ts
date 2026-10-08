import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { angularJitApplicationTransform } from '@angular/compiler-cli';
import { defineConfig, type Plugin } from 'vitest/config';

const packageRoot = fileURLToPath(new URL('.', import.meta.url));
const sourceRoot = fileURLToPath(new URL('./src/', import.meta.url));

/**
 * Compiles the library sources for Angular's JIT compiler, with the transform
 * the Angular CLI applies to unit tests: signal inputs, outputs and queries
 * are invisible to runtime reflection, so it declares them as decorator
 * metadata. The tests load `@angular/compiler` to compile them at runtime.
 */
function angularJit(): Plugin {
  let program: ts.Program | undefined;
  const createProgram = (): ts.Program => {
    const configPath = fileURLToPath(new URL('./tsconfig.lib.json', import.meta.url));
    const { config } = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path)) as { config: unknown };
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, packageRoot);
    return ts.createProgram(parsed.fileNames, {
      ...parsed.options,
      composite: false,
      declaration: false,
      declarationMap: false,
      emitDeclarationOnly: false,
      noEmitOnError: false,
      experimentalDecorators: true,
      sourceMap: true,
      inlineSources: true,
    }, undefined, program);
  };
  return {
    name: 'domternal-angular-jit',
    enforce: 'pre',
    transform(input, id) {
      const file = id.split('?')[0] ?? id;
      if (!file.startsWith(sourceRoot) || !file.endsWith('.ts') || file.endsWith('.test.ts')) return null;
      // Watch mode hands over edited sources, which a program parsed before
      // the edit would compile as they were.
      if (program?.getSourceFile(file)?.text !== input) program = createProgram();
      const source = program.getSourceFile(file);
      if (!source) return null;
      let code = '';
      let map = '';
      program.emit(source, (name, text) => {
        if (name.endsWith('.js.map')) map = text;
        else if (name.endsWith('.js')) code = text.replace(/\n\/\/# sourceMappingURL=.*$/, '');
      }, undefined, false, { before: [angularJitApplicationTransform(program)] });
      return { code, map };
    },
  };
}

export default defineConfig({
  plugins: [angularJit()],
  resolve: { conditions: ['@domternal/source'] },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/public-api.ts'],
    },
  },
});
