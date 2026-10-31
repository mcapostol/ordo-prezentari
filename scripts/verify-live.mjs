#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const outputs = path.join(root, 'outputs');
const reportPath = path.join(outputs, 'live-acceptance-report.json');
const playwrightModule = process.env.PLAYWRIGHT_MODULE
  || '/home/capostol/clarified-social-publisher/management_clinica/carevia/node_modules/@playwright/test/index.mjs';
const products = [
  { key: 'salons', file: 'salons.html', brand: 'OrdoSalons' },
  { key: 'clubs', file: 'clubs.html', brand: 'OrdoClubs' },
  { key: 'rezidential', file: 'rezidential.html', brand: 'OrdoRezidential' },
  { key: 'administratii', file: 'administratii.html', brand: 'OrdoAdministratii' },
  { key: 'farm', file: 'farm.html', brand: 'OrdoFarm' },
];
const expectedHtml = ['index.html', ...products.map((product) => product.file)];
const retiredRoutes = ['clinics/', 'clinics/index.html', 'clinics/demo/', 'clinics/demo/index.html'];
const started = Date.now();

function argumentsFrom(argv) {
  let baseUrl = process.env.BASE_URL || null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') return { help: true, baseUrl: null };
    if (argument.startsWith('--base-url=')) baseUrl = argument.slice('--base-url='.length);
    else if (argument === '--base-url') baseUrl = argv[++index];
    else throw new Error(`Argument necunoscut: ${argument}`);
  }
  assert.ok(baseUrl, 'BASE_URL este obligatoriu: folosește --base-url sau variabila BASE_URL.');
  const parsed = new URL(baseUrl);
  assert.equal(parsed.protocol, 'https:', 'BASE_URL trebuie să folosească HTTPS.');
  assert.equal(parsed.username, '', 'BASE_URL nu poate conține credențiale.');
  assert.equal(parsed.password, '', 'BASE_URL nu poate conține credențiale.');
  assert.equal(parsed.search, '', 'BASE_URL nu poate conține query string.');
  assert.equal(parsed.hash, '', 'BASE_URL nu poate conține fragment.');
  assert.ok(parsed.pathname.endsWith('/'), 'BASE_URL trebuie să se termine cu „/”.');
  return { help: false, baseUrl: parsed.href };
}

const options = argumentsFrom(process.argv.slice(2));
if (options.help) {
  console.log([
    'Utilizare:',
    '  BASE_URL=https://utilizator.github.io/repository/ node scripts/verify-live.mjs',
    '  node scripts/verify-live.mjs --base-url https://utilizator.github.io/repository/',
    '',
    'BASE_URL este obligatoriu și nu are valoare implicită.',
  ].join('\n'));
  process.exit(0);
}

const base = new URL(options.baseUrl);
const report = {
  schemaVersion: 1,
  status: 'RUNNING',
  scope: 'public-github-pages',
  baseUrl: base.href,
  startedAt: new Date(started).toISOString(),
  finishedAt: null,
  durationMs: null,
  sourceCommit: null,
  checks: [],
  artifacts: [],
};

function safeError(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
}

async function check(name, action) {
  const item = { name, status: 'RUNNING' };
  report.checks.push(item);
  try {
    const details = await action();
    item.status = 'PASS';
    if (details !== undefined) item.details = details;
    return details;
  } catch (error) {
    item.status = 'FAIL';
    item.error = safeError(error);
    throw error;
  }
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function withinPublishedRoot(url) {
  return url.origin === base.origin && url.pathname.startsWith(base.pathname);
}

async function fetchPublished(relative, expectedPath = new URL(relative, base).pathname) {
  const requested = new URL(relative, base);
  assert.ok(withinPublishedRoot(requested), `Calea publică iese din rădăcina configurată: ${requested.pathname}`);
  let current = requested;
  const redirects = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      assert.ok(location, `${current.pathname}: redirect fără Location.`);
      const next = new URL(location, current);
      assert.ok(withinPublishedRoot(next), `${current.pathname}: redirect în afara originii sau prefixului public.`);
      redirects.push({ from: current.pathname, to: next.pathname, status: response.status });
      current = next;
      continue;
    }
    assert.equal(response.status, 200, `${current.pathname}: status HTTP ${response.status}, așteptat 200.`);
    assert.equal(current.protocol, 'https:');
    assert.equal(current.origin, base.origin);
    assert.equal(current.pathname, expectedPath, `Calea finală diferă de cea cerută pentru ${requested.pathname}.`);
    assert.equal(current.search, '', `${requested.pathname}: URL-ul final conține query string.`);
    assert.equal(current.hash, '', `${requested.pathname}: URL-ul final conține fragment.`);
    return { response, finalUrl: current, redirects };
  }
  throw new Error(`${requested.pathname}: prea multe redirecturi.`);
}

async function fetchRetired(relative) {
  const requested = new URL(relative, base);
  assert.ok(withinPublishedRoot(requested), `Calea retrasă iese din rădăcina configurată: ${requested.pathname}`);
  let current = requested;
  const redirects = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      assert.ok(location, `${current.pathname}: redirect fără Location.`);
      const next = new URL(location, current);
      assert.ok(withinPublishedRoot(next), `${current.pathname}: redirect în afara originii sau prefixului public.`);
      redirects.push({ from: current.pathname, to: next.pathname, status: response.status });
      current = next;
      continue;
    }
    assert.equal(response.status, 404, `${current.pathname}: status HTTP ${response.status}, așteptat 404.`);
    assert.equal(current.protocol, 'https:');
    assert.equal(current.origin, base.origin);
    return { finalUrl: current.href, redirects };
  }
  throw new Error(`${requested.pathname}: prea multe redirecturi.`);
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

function monitorPage(page, existingState) {
  const state = existingState || { offOriginRequests: [], requestFailures: [], badResponses: [], consoleErrors: [], pageErrors: [] };
  page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!withinPublishedRoot(url)) {
      state.offOriginRequests.push({ origin: url.origin, path: url.pathname });
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  page.on('requestfailed', (request) => state.requestFailures.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText || 'failed' }));
  page.on('response', (response) => {
    if (response.status() >= 400) state.badResponses.push({ status: response.status(), path: new URL(response.url()).pathname });
  });
  page.on('console', (message) => { if (message.type() === 'error') state.consoleErrors.push(message.text().slice(0, 250)); });
  page.on('pageerror', (error) => state.pageErrors.push(error.message.slice(0, 250)));
  return state;
}

function assertCleanBrowser(state, label) {
  assert.equal(state.offOriginRequests.length, 0, `${label}: cereri în afara originii publice.`);
  assert.equal(state.requestFailures.length, 0, `${label}: cereri de rețea eșuate.`);
  assert.equal(state.badResponses.length, 0, `${label}: răspunsuri HTTP >= 400.`);
  assert.equal(state.consoleErrors.length, 0, `${label}: erori în consola browserului.`);
  assert.equal(state.pageErrors.length, 0, `${label}: erori JavaScript necapturate.`);
}

async function layout(page, label) {
  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  assert.ok(metrics.documentWidth <= metrics.viewport + 1, `${label}: documentul are overflow orizontal.`);
  assert.ok(metrics.bodyWidth <= metrics.viewport + 1, `${label}: body are overflow orizontal.`);
  return metrics;
}

function hasFragment(source, fragment) {
  const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\bid\\s*=\\s*["']${escaped}["']`).test(source);
}

async function links(page, currentFile, liveHtml, liveFiles) {
  const hrefs = await page.locator('a[href]').evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute('href')));
  for (const href of hrefs) {
    assert.ok(href && !/^(?:javascript|data|blob):/i.test(href), `${currentFile}: link nesigur.`);
    const resolved = new URL(href, page.url());
    assert.ok(withinPublishedRoot(resolved), `${currentFile}: link în afara portofoliului public.`);
    const relativePath = decodeURIComponent(resolved.pathname.slice(base.pathname.length));
    const targetFile = relativePath || 'index.html';
    assert.ok(liveFiles.has(targetFile), `${currentFile}: țintă locală nepublicată ${targetFile}.`);
    if (resolved.hash) {
      const fragment = decodeURIComponent(resolved.hash.slice(1));
      assert.ok(fragment && hasFragment(liveHtml.get(targetFile), fragment), `${currentFile}: fragment inexistent ${targetFile}#${fragment}.`);
    }
  }
  return hrefs.length;
}

async function assertDelivery(page, file) {
  const buttons = page.locator('[data-mode]');
  const panels = page.locator('[data-mode-panel]');
  assert.equal(await buttons.count(), 2, `${file}: sunt necesare două butoane de livrare.`);
  assert.equal(await panels.count(), 2, `${file}: sunt necesare două panouri de livrare.`);
  assert.deepEqual(new Set(await buttons.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-mode')))), new Set(['saas', 'onprem']));
  assert.ok(await buttons.evaluateAll((nodes) => nodes.every((node) => node.tagName === 'BUTTON' && (node.textContent || '').trim())),
    `${file}: selectorul de livrare nu este format din butoane accesibile.`);
  for (const mode of ['saas', 'onprem']) {
    await page.locator(`[data-mode="${mode}"]`).click();
    for (const candidate of ['saas', 'onprem']) {
      assert.equal(await page.locator(`[data-mode="${candidate}"]`).getAttribute('aria-pressed'), String(candidate === mode));
      assert.equal(await page.locator(`[data-mode-panel="${candidate}"]`).isVisible(), candidate === mode);
    }
  }
}

async function assertPersistedOnPremise(context, page, url, file, state) {
  await page.locator('[data-mode="onprem"]').click();
  await page.reload({ waitUntil: 'load', timeout: 15_000 });
  assert.equal(await page.locator('[data-mode="onprem"]').getAttribute('aria-pressed'), 'true', `${file}: On-Premise nu persistă după reload.`);
  assert.equal(await page.locator('[data-mode-panel="onprem"]').isVisible(), true);
  await page.close();

  const reopened = await context.newPage();
  monitorPage(reopened, state);
  const response = await reopened.goto(url, { waitUntil: 'load', timeout: 15_000 });
  assert.equal(response?.status(), 200);
  assert.equal(await reopened.locator('[data-mode="onprem"]').getAttribute('aria-pressed'), 'true', `${file}: On-Premise nu persistă într-un tab nou.`);
  assert.equal(await reopened.locator('[data-mode-panel="onprem"]').isVisible(), true);
  await reopened.locator('[data-mode="saas"]').click();
  assert.equal(await reopened.locator('[data-mode="saas"]').getAttribute('aria-pressed'), 'true');
  return reopened;
}

let browser;
let localManifest;
const liveHtml = new Map();
const liveFiles = new Set();
try {
  await mkdir(outputs, { recursive: true });
  await check('Commitul local, manifestul public și hashurile tuturor fișierelor coincid', async () => {
    const head = git('rev-parse', 'HEAD');
    assert.match(head, /^[0-9a-f]{40}$/);
    assert.equal(git('status', '--porcelain'), '', 'Working tree-ul local nu este curat.');
    localManifest = JSON.parse(await readFile(path.join(dist, 'manifest.json'), 'utf8'));
    assert.equal(localManifest.source_sha, head, 'Manifestul local nu corespunde HEAD.');

    const manifestFetch = await fetchPublished('manifest.json');
    const liveManifest = JSON.parse(Buffer.from(await manifestFetch.response.arrayBuffer()).toString('utf8'));
    assert.equal(liveManifest.source_sha, head, 'Manifestul public nu corespunde HEAD.');
    assert.deepEqual(liveManifest, localManifest, 'Manifestul public diferă de buildul local.');
    assert.deepEqual(Object.keys(localManifest.files || {}).sort(), [...expectedHtml].sort(), 'Manifestul trebuie să conțină numai cele șase prezentări publice active.');
    assert.deepEqual([...(localManifest.retired_routes || [])].sort(), [...retiredRoutes].sort(), 'Manifestul nu declară exact rutele OrdoClinics retrase.');
    assert.equal(await isPresent(path.join(dist, 'clinics')), false, 'Directorul dist/clinics trebuie să lipsească.');
    for (const filename of expectedHtml) assert.ok(localManifest.files?.[filename], `Manifestul nu declară ${filename}.`);

    const verified = [];
    for (const [filename, evidence] of Object.entries(localManifest.files)) {
      if (!/\.(?:html|pdf)$/i.test(filename)) continue;
      assert.ok(!path.isAbsolute(filename) && !filename.split('/').some(part => !part || part === '..' || part === '.') && filename.endsWith('.html'), `Cale nepermisă în manifest: ${filename}`);
      assert.match(evidence?.sha256 || '', /^[0-9a-f]{64}$/);
      const localBytes = await readFile(path.join(dist, filename));
      assert.equal(digest(localBytes), evidence.sha256, `${filename}: hash local diferit de manifest.`);
      const published = await fetchPublished(filename);
      const liveBytes = Buffer.from(await published.response.arrayBuffer());
      assert.equal(digest(liveBytes), evidence.sha256, `${filename}: hash public diferit de manifest.`);
      if (Number.isInteger(evidence.bytes)) assert.equal(liveBytes.length, evidence.bytes, `${filename}: dimensiune publică diferită.`);
      liveFiles.add(filename);
      if (filename.endsWith('.html')) liveHtml.set(filename, liveBytes.toString('utf8'));
      verified.push({ file: filename, sha256: evidence.sha256, redirects: published.redirects.length });
    }

    const portfolio = await fetchPublished('', base.pathname);
    const portfolioBytes = Buffer.from(await portfolio.response.arrayBuffer());
    assert.equal(digest(portfolioBytes), localManifest.files['index.html'].sha256, 'Portofoliul de la BASE_URL nu este index.html canonic.');
    const retired = [];
    for (const route of retiredRoutes) retired.push({ route, ...(await fetchRetired(route)) });
    report.sourceCommit = head;
    return { sourceCommit: head, manifestRedirects: manifestFetch.redirects.length, verified, retired, portfolioRedirects: portfolio.redirects.length };
  });

  const moduleUrl = playwrightModule.startsWith('file:') ? playwrightModule : pathToFileURL(path.resolve(playwrightModule)).href;
  const { chromium } = await import(moduleUrl);
  browser = await chromium.launch({ headless: true });

  for (const viewport of [{ key: 'desktop', width: 1440, height: 1000 }, { key: 'mobile', width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, locale: 'ro-RO' });
    try {
      for (const descriptor of [{ key: 'index', file: 'index.html', url: base.href }, ...products.map((product) => ({ ...product, url: new URL(product.file, base).href }))]) {
        await check(`${descriptor.file} · live ${viewport.width}px`, async () => {
          let page = await context.newPage();
          const state = monitorPage(page);
          const response = await page.goto(descriptor.url, { waitUntil: 'load', timeout: 15_000 });
          assert.equal(response?.status(), 200);
          const final = new URL(page.url());
          assert.equal(final.protocol, 'https:');
          assert.equal(final.origin, base.origin);
          assert.equal(final.pathname, new URL(descriptor.url).pathname, `${descriptor.file}: cale finală neașteptată în browser.`);
          assert.equal(final.search, '', `${descriptor.file}: URL-ul final conține query string.`);
          assert.equal(final.hash, '', `${descriptor.file}: URL-ul final conține fragment.`);
          const metrics = await layout(page, `${descriptor.file} ${viewport.width}px`);
          const linkCount = await links(page, descriptor.file, liveHtml, liveFiles);
          let persistence = null;
          if (descriptor.file !== 'index.html') {
            await assertDelivery(page, descriptor.file);
            if (viewport.key === 'desktop') {
              page = await assertPersistedOnPremise(context, page, descriptor.url, descriptor.file, state);
              persistence = { reload: true, newTab: true, resetToSaas: true };
            } else {
              await page.locator('[data-mode="saas"]').click();
            }
          }
          assertCleanBrowser(state, `${descriptor.file} ${viewport.width}px`);
          const screenshot = `live-${descriptor.key}-${viewport.key}.png`;
          await page.screenshot({ path: path.join(outputs, screenshot), animations: 'disabled' });
          report.artifacts.push({ type: 'cover-screenshot', page: descriptor.file, viewport: `${viewport.width}x${viewport.height}`, file: `outputs/${screenshot}` });
          await page.close();
          return { ...metrics, linkCount, ...(persistence ? { persistence } : {}) };
        });
      }
    } finally {
      await context.close();
    }
  }
} catch (error) {
  if (!report.checks.some((item) => item.status === 'FAIL')) report.checks.push({ name: 'Runner intern', status: 'FAIL', error: safeError(error) });
} finally {
  if (browser) await browser.close().catch(() => {});
  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - started;
  report.status = report.checks.every((item) => item.status === 'PASS') ? 'VERIFIED_LIVE' : 'FAILED';
  await mkdir(outputs, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({
    status: report.status,
    passed: report.checks.filter((item) => item.status === 'PASS').length,
    failed: report.checks.filter((item) => item.status === 'FAIL').length,
    durationMs: report.durationMs,
    report: 'outputs/live-acceptance-report.json',
  }));
  if (report.status !== 'VERIFIED_LIVE') process.exitCode = 1;
}
