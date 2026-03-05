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
      input: {
        'home-react': path.join(projectRoot, 'public', 'js', 'apps', 'homeReactApp.js'),
        'user-react': path.join(projectRoot, 'public', 'js', 'apps', 'userReactApp.js'),
        'login-react': path.join(projectRoot, 'public', 'js', 'apps', 'loginReactApp.js'),
      },
      output: {
        format: 'es',
        entryFileNames: '[name].bundle.js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
});
