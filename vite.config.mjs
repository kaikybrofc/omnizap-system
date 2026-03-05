import { defineConfig } from 'vite';
import path from 'node:path';

const projectRoot = path.resolve(__dirname);

export default defineConfig({
  envDir: path.join(projectRoot, '.vite-env'),
  publicDir: false,
  build: {
    emptyOutDir: false,
    copyPublicDir: false,
    outDir: path.join(projectRoot, 'public', 'assets', 'js'),
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      input: path.join(projectRoot, 'public', 'js', 'apps', 'homeReactApp.js'),
      output: {
        format: 'es',
        entryFileNames: 'home-react.bundle.js',
        inlineDynamicImports: true,
      },
    },
  },
});
