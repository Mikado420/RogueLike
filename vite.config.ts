import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// GitHub Pages は /<リポジトリ名>/ の下で配信されるので、相対パスで出力する
// ビルドごとの版。クライアントは version.json と見比べて、新しい版なら読み込み直す（client/src/update.ts）
const buildId = (process.env.GITHUB_SHA ?? '').slice(0, 12) || `b${Date.now().toString(36)}`;

export default defineConfig(({ command }) => ({
  root: 'client',
  define: { __BUILD_ID__: JSON.stringify(command === 'build' ? buildId : 'dev') },
  plugins: [{
    name: 'version-json',
    apply: 'build',
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: buildId }) }); },
  }],
  base: './',
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022' },
  server: { host: true, fs: { allow: [root] } },
}));
