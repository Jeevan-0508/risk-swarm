import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  base: process.env.RS_BASE ?? '/risk-swarm/',
  plugins: [react()],
  resolve: {
    alias: {
      '@core': path.resolve(process.cwd(), 'src/core'),
      '@app': path.resolve(process.cwd(), 'src/app'),
    },
  },
  build: { target: 'es2022', sourcemap: false },
});
