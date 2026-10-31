#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const baseArgument = process.argv[2] || null;
const publishedFiles = [
  'index.html',
  'salons.html',
  'clubs.html',
  'rezidential.html',
  'administratii.html',
  'farm.html',
];
const retiredRoutes = [
  'clinics/',
  'clinics/index.html',
  'clinics/demo/',
  'clinics/demo/index.html',
];

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function isPresent(file) {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

const head = git('rev-parse', 'HEAD');
assert.match(head, /^[0-9a-f]{40}$/);
assert.equal(git('status', '--porcelain'), '', 'Este necesar un commit canonic cu working tree curat.');

const manifest = JSON.parse(await readFile(path.join(dist, 'manifest.json'), 'utf8'));
assert.equal(manifest.source_sha, head, 'Manifestul buildului nu corespunde commitului canonic.');
assert.deepEqual(Object.keys(manifest.files || {}).sort(), [...publishedFiles].sort(), 'Manifestul trebuie să conțină numai cele șase prezentări publice active.');
assert.deepEqual([...(manifest.retired_routes || [])].sort(), [...retiredRoutes].sort(), 'Manifestul nu declară exact rutele OrdoClinics retrase.');

assert.equal(await isPresent(path.join(dist, 'clinics')), false, 'Directorul dist/clinics trebuie eliminat complet.');
for (const route of retiredRoutes.filter((route) => !route.endsWith('/'))) {
  assert.equal(await isPresent(path.join(dist, route)), false, `${route} nu trebuie să existe în build.`);
}

const hashes = {};
for (const file of publishedFiles) {
  const evidence = manifest.files[file];
  assert.match(evidence?.sha256 || '', /^[0-9a-f]{64}$/, `${file}: hash invalid în manifest.`);
  const bytes = await readFile(path.join(dist, file));
  assert.equal(digest(bytes), evidence.sha256, `${file}: hashul local diferă de manifest.`);
  if (Number.isInteger(evidence.bytes)) assert.equal(bytes.length, evidence.bytes, `${file}: dimensiunea locală diferă de manifest.`);
  hashes[file] = evidence.sha256;
}

const report = {
  sourceSha: head,
  scope: baseArgument ? 'public-github-pages-retirement' : 'built-retirement',
  status: baseArgument ? 'VERIFIED_LIVE' : 'VERIFIED_BUILD',
  publishedFiles: hashes,
  retiredRoutes,
};

if (baseArgument) {
  const base = new URL(baseArgument);
  assert.equal(base.protocol, 'https:', 'Baza publică trebuie să folosească HTTPS.');
  assert.ok(base.pathname.endsWith('/'), 'Baza publică trebuie să se termine cu „/”.');

  const manifestResponse = await fetch(new URL('manifest.json', base), { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  assert.equal(manifestResponse.status, 200, 'Manifestul public nu este disponibil.');
  assert.deepEqual(await manifestResponse.json(), manifest, 'Manifestul public diferă de buildul canonic.');

  for (const file of publishedFiles) {
    const response = await fetch(new URL(file, base), { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200, `${file}: status public neașteptat.`);
    assert.equal(digest(Buffer.from(await response.arrayBuffer())), manifest.files[file].sha256, `${file}: hashul public diferă de manifest.`);
  }

  for (const route of retiredRoutes) {
    const response = await fetch(new URL(route, base), { cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 404, `${route}: ruta retrasă trebuie să răspundă cu HTTP 404.`);
    assert.equal(new URL(response.url).protocol, 'https:', `${route}: redirectul final trebuie să rămână pe HTTPS.`);
  }
}

console.log(JSON.stringify(report));
