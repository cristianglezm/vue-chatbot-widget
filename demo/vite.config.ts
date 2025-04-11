import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
// @ts-ignore
import eslint from 'vite-plugin-eslint';

/** @type {import('vite').UserConfig} */
export default defineConfig({
  server:{
    fs: {
      allow: ['../']
    }
  },
  plugins: [
    vue(),
    vueDevTools(),
    eslint()
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  build: {
    chunkSizeWarningLimit: 3500,
    minify: false, // this is needed to show the code to the user in <code>.
    outDir: 'dist',
  },
  esbuild:{
    legalComments: 'inline',
  }
});

