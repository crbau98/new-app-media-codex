import { execSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

try {
  execSync('npx vite build', { cwd: root, stdio: 'inherit' });
} catch (e) {
  process.exit(1);
}
