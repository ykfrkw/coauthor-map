import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// GitHub Pages のサブパス配信のため base は必ず相対にする。
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        widget: resolve(import.meta.dirname, 'widget.html'),
      },
    },
  },
});
