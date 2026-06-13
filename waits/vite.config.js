import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Split big, rarely-changing vendor code into its own long-cache chunks so
        // app-code edits don't force a re-download of React / Firebase, and the
        // browser can fetch them in parallel with the app shell.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('/react') || id.includes('/scheduler')) return 'react';
          // Storage is dynamically imported (chat media only) — leave it out of the
          // firebase chunk so it stays a separate, on-demand chunk.
          if (id.includes('@firebase/storage') || id.includes('firebase/storage')) return;
          if (id.includes('@firebase') || id.includes('/firebase')) return 'firebase';
        },
      },
    },
  },
})
