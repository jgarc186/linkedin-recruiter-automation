import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync } from 'fs';

export default defineConfig({
  root: 'src',
  base: '',
  publicDir: false,
  build: {
    modulePreload: false,
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup.html'),
        options: resolve(__dirname, 'src/options.html'),
        background: resolve(__dirname, 'src/background.ts'),
        content: resolve(__dirname, 'src/content.ts'),
      },
      // Chrome MV3 content scripts and service workers can't load
      // cross-chunk ES module imports, so disable code splitting
      preserveEntrySignatures: 'exports-only',
      output: {
        entryFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
  },
  plugins: [
    {
      name: 'copy-manifest',
      closeBundle() {
        copyFileSync(
          resolve(__dirname, 'manifest.json'),
          resolve(__dirname, 'dist/manifest.json'),
        );
      },
    },
  ],
  resolve: {
    alias: {
      '@linkedin-plugin/shared': resolve(__dirname, '../shared/types.ts'),
    },
  },
});
