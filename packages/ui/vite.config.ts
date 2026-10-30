import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { messagesFile } from './src/i18n/messages-file';

/** Writes `dist/messages.json` (every UI text per locale), which core reads to let the host's `translate` reword them. */
const messages = (): Plugin => ({
  name: 'nma-messages',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'messages.json', source: messagesFile() });
  },
});

export default defineConfig({
  // Relative asset URLs; core injects <base href="<mount path>/"> so any mount path works without a rebuild.
  base: './',
  plugins: [react(), tailwindcss(), messages()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, proxy: { '/admin/api': 'http://localhost:3000' } },
});
