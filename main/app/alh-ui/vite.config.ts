import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  // E.1 FIX: Add code splitting for better bundle optimization
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React dependencies
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // Data fetching and utilities
          'vendor-utils': ['axios', '@tanstack/react-virtual'],
        },
      },
    },
    // Generate chunk size warnings for chunks > 500KB
    chunkSizeWarningLimit: 500,
  },
})
