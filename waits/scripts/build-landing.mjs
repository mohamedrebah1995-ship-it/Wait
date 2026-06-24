// Post-build: put the static landing page at / (dist/index.html) and the React app at /app
// (dist/app.html). The Vite build itself is unchanged — this only rearranges the output so the
// root URL serves a crawlable landing page while the app keeps all its behaviour at /app.
import { renameSync, copyFileSync, existsSync } from 'node:fs';

if (!existsSync('dist/index.html')) {
  console.error('build-landing: dist/index.html not found — run vite build first');
  process.exit(1);
}
renameSync('dist/index.html', 'dist/app.html');   // the built React app shell → /app.html
copyFileSync('landing.html', 'dist/index.html');  // the static landing page → /
console.log('build-landing: dist/index.html = landing, dist/app.html = app');
