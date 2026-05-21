import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  sourcemap: true,
  clean: true,
  // Bundle the workspace types package into the output so the built server has
  // no unresolved `@workbench/*` imports at runtime.
  noExternal: [/^@workbench\//],
});
