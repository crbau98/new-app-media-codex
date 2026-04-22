import { execSync } from 'child_process';
import { dirname, resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, cpSync, mkdirSync, rmSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const indexPath = join(root, 'index.html');

// Read the original index.html
const originalHtml = readFileSync(indexPath, 'utf-8');

// Create a build-friendly index.html with a static script tag
// so Vite can discover and bundle the entry point
const buildHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Codex Research Radar</title>
    <meta name="theme-color" content="#0a0e17">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"><\/script>
  </body>
</html>`;

writeFileSync(indexPath, buildHtml, 'utf-8');
console.log('[build] Wrote build-friendly index.html');

try {
  execSync('npx vite build', { cwd: root, stdio: 'inherit' });
  console.log('[build] Vite build completed successfully');
} catch (e) {
  writeFileSync(indexPath, originalHtml, 'utf-8');
  process.exit(1);
}

// Vercel only needs `frontend/dist`. Docker & local uvicorn load from `app/static/dist`.
const onVercel =
  process.env.VERCEL === '1' ||
  process.env.VERCEL_ENV === 'production' ||
  process.env.VERCEL_ENV === 'preview' ||
  process.env.VERCEL_ENV === 'development';
const distDir = join(root, 'dist');
const appStaticDist = join(root, '..', 'app', 'static', 'dist');
if (!onVercel && existsSync(distDir)) {
  mkdirSync(join(root, '..', 'app', 'static'), { recursive: true });
  if (existsSync(appStaticDist)) {
    rmSync(appStaticDist, { recursive: true });
  }
  cpSync(distDir, appStaticDist, { recursive: true });
  console.log('[build] Synced dist -> app/static/dist');
}

writeFileSync(indexPath, originalHtml, 'utf-8');
console.log('[build] Restored original index.html');
