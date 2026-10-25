import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('Build requires a clean committed source tree.');
const sourceSha = git('rev-parse', 'HEAD');
if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error('A canonical source commit is required.');
const files = ['index.html', 'salons.html', 'clubs.html'];
const manifest = { kind: 'local-concept-presentations', source_sha: sourceSha, publication: 'none', files: {} };
await mkdir(join(root, 'dist'), { recursive: true });
for (const name of files) {
  const content = await readFile(join(root, name));
  const html = content.toString('utf8');
  if (!html.startsWith('<!doctype html>') || !html.includes('lang="ro"')) throw new Error(`Invalid Romanian HTML: ${name}`);
  if (/<(?:script|link|img)\b[^>]+(?:src|href)\s*=\s*["'](?:https?:)?\/\//i.test(html)) throw new Error(`External asset dependency in ${name}`);
  if (/chatgpt\.site|cloudapp\.azure\.com|appgprj_/i.test(html)) throw new Error(`Live deployment link or identity leaked into ${name}`);
  await writeFile(join(root, 'dist', name), content);
  manifest.files[name] = { bytes: content.byteLength, sha256: createHash('sha256').update(content).digest('hex') };
}
await writeFile(join(root, 'dist', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ built: true, source_sha: sourceSha, standalone_html: files, publication: 'none' }));
