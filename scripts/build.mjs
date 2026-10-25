import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { validatePricingMarkup } from './pricing.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('Build requires a clean committed source tree.');
const sourceSha = git('rev-parse', 'HEAD');
if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error('A canonical source commit is required.');
const allowed = ['index.html', 'salons.html', 'clubs.html', 'rezidential.html', 'administratii.html', 'farm.html'];
const present = new Set(await readdir(root));
const files = allowed.filter(name => present.has(name));
const args = process.argv.slice(2);
if (args.length > 1 || (args.length && !['--publication=none', '--publication=github-pages'].includes(args[0]))) throw new Error('Unsupported publication argument.');
const publication = args[0] === '--publication=github-pages' ? 'github-pages' : 'none';
await validatePricingMarkup(root);
for (const name of ['index.html', 'salons.html', 'clubs.html']) {
  if (!files.includes(name)) throw new Error(`Missing core source: ${name}`);
}
const manifest = { kind: 'concept-presentations', source_sha: sourceSha, publication, files: {} };
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
console.log(JSON.stringify({ built: true, source_sha: sourceSha, standalone_html: files, publication }));
