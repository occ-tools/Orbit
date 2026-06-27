import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  splitting: false,
  banner: {
    js: `import { createRequire as _createRequire } from 'module';
import { fileURLToPath as _fileURLToPath } from 'url';
import { dirname as _dirname } from 'path';
const require = _createRequire(import.meta.url);
const __filename = _fileURLToPath(import.meta.url);
const __dirname = _dirname(__filename);`,
  },
  // Externalize all Node.js builtins so they are imported via ESM imports rather than dynamic require
  external: [
    'child_process',
    'fs',
    'path',
    'os',
    'crypto',
    'events',
    'util',
    'url',
    'stream',
    'http',
    'https',
    'zlib',
    'net',
    'tls',
    'readline',
    'dns',
    'string_decoder'
  ],
});
