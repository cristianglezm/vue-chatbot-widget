import path from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
// @ts-ignore
import eslint from 'vite-plugin-eslint';

const widgetSrc = path.resolve(__dirname, 'packages/@cristianglezm/vue-chatbot-widget/src/main.ts');

export default defineConfig(({ command }) => ({
  plugins: [
    vue(),
    vueDevTools(),
    eslint()
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // dev server: use the widget sources (HMR, no need to rebuild the lib).
      // build: use the built package through the workspace link, so the demo
      // exercises the same files that are published.
      ...(command === 'serve' ? { '@cristianglezm/vue-chatbot-widget': widgetSrc } : {}),
    },
    // one copy of vue / pinia / mitt no matter who imports them.
    dedupe: ['vue', 'pinia', 'mitt'],
  },
  build: {
    chunkSizeWarningLimit: 3500,
    minify: false, // this is needed to show the code to the user in <code>.
    outDir: 'dist',
  },
  esbuild:{
    legalComments: 'inline',
  }
}));
