import { defineConfig } from 'tsup';

export default defineConfig({
  // One entry per framework subpath — tsup builds them independently so
  // importing `/react` doesn't pull in vue/angular bundles. When a new
  // framework is added, register its entry here; everything tree-shakes
  // per subpath.
  entry: {
    'react/index': 'src/react/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['react', 'react-dom', 'agentfootprint'],
});
