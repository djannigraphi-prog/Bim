import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ command, mode }) => {
  // Compilation de production : l'adresse de l'API est obligatoire. Sans elle, l'administration publiée
  // appellerait silencieusement http://localhost:3000 (audit du 16/10/2026, C-17).
  if (command === 'build' && mode === 'production' && !loadEnv(mode, process.cwd(), 'VITE_').VITE_API_URL) {
    throw new Error('VITE_API_URL est obligatoire pour compiler l’administration (adresse publique de l’API).');
  }
  return {
    plugins: [react()],
    server: { port: 5173, strictPort: true },
    test: { environment: 'jsdom', include: ['src/**/*.test.ts?(x)'] },
  };
});
