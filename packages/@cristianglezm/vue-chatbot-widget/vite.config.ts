import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import dts from 'vite-plugin-dts';
import path from 'path';
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";

export default defineConfig({
  plugins: [
    vue(), 
    dts({
      insertTypesEntry: true,
      outDir: 'dist/lib/types',
      include: ["./src/**/*.ts", "./src/**/*.tsx", "./src/**/*.vue"],
      cleanVueFileName: true,
      rollupTypes: true,
      tsconfigPath: './tsconfig.json'
    }),
    cssInjectedByJsPlugin()
  ],
  resolve:{
    alias: {
        "@": path.resolve(__dirname, './src'),
    },
  },
  esbuild:{
    legalComments: 'inline',
  },
  publicDir: 'public',
  base: './',
  worker:{
    format: 'es',
    rollupOptions: {
      treeshake: true,
      external: [
//        '@huggingface/inference',
//        '@huggingface/jinja',
//        '@huggingface/transformers',
//        'kokoro-js',
//        'onnxruntime-node',
//        'onnxruntime-web',
      ],
      output: {
        exports: 'named',
        assetFileNames: 'assets/[name].[hash].[ext]',
        globals:{
//          '@huggingface/inference':'HuggingFaceInference',
//          '@huggingface/jinja':'HuggingFaceJinja',
//          '@huggingface/transformers':'HuggingFaceTranformers',
//          'kokoro-js':'KokoroJs',
//          'onnxruntime-node':'onnxruntimeNode',
//          'onnxruntime-web':'onnxruntimeWeb',
        }
      }
    }
  },
  build: {
    emptyOutDir: false,
    outDir: 'dist/lib',
    minify: true,
    target: 'esnext',
    sourcemap: true,
    lib: {
      entry: ['./src/main.ts'],
      formats: ['es', 'cjs', 'umd'],
      name: 'vue-chatbot-widget',
      fileName: (format) => `vue-chatbot-widget.${format}.js`
    },
    rollupOptions: {
      treeshake: true,
      external: [
        'vue', 
        '@huggingface/inference', 
        '@huggingface/jinja', 
        '@huggingface/transformers', 
        'kokoro-js', 
        'onnxruntime-node',
        'onnxruntime-web',
        'waveform-data', 
        'mitt',
        'pinia'
      ],
      output: {
        exports: 'named',
        assetFileNames: 'assets/[name].[hash].[ext]',
        globals:{
            'vue':'Vue',
            '@huggingface/inference':'HuggingFaceInference',
            '@huggingface/jinja':'HuggingFaceJinja',
            '@huggingface/transformers':'HuggingFaceTranformers',
            'kokoro-js':'KokoroJs',
            'onnxruntime-node':'OnnxruntimeNode',
            'onnxruntime-web':'OnnxruntimeWeb',
            'waveform-data':'WaveformData',
            'mitt':'Mitt',
            'pinia':'Pinia',
        }
      }
    }
  }
});
