import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://127.0.0.1:4177/' } },
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    setupFiles: ['test/setup.ts'],
  },
});
