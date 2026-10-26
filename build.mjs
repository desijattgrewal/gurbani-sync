import { cp, mkdir, rm } from 'node:fs/promises';
await rm('dist', { recursive: true, force: true });
await mkdir('dist');
for (const name of ['index.html', 'style.css', 'app.js', 'gurbani.js', 'banis.js', 'present.js', 'listener.js', 'cloud-listener.js', 'speech-worker.js', 'assets', 'banis']) {
  await cp(name, `dist/${name}`, { recursive: true });
}
