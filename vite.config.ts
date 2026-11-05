import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// GitHub Pages は /<リポジトリ名>/ の下で配信されるので、相対パスで出力する
export default defineConfig({
  root: 'client',
  base: './',
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022' },
  server: { host: true, fs: { allow: [root] } },
});
