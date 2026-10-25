#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const outputs = path.join(root, 'outputs');
const reportPath = path.join(outputs, 'local-acceptance-report.json');
const playwrightModule = process.env.PLAYWRIGHT_MODULE
  || '/home/capostol/clarified-social-publisher/management_clinica/carevia/node_modules/@playwright/test/index.mjs';
const pages = [
  { key: 'index', file: 'index.html', kind: 'index' },
  {
    key: 'salons', file: 'salons.html', kind: 'product', brand: 'OrdoSalons', pdf: 'OrdoSalons.pdf',
  },
  {
    key: 'clubs', file: 'clubs.html', kind: 'product', brand: 'OrdoClubs', pdf: 'OrdoClubs.pdf',
  },
];
const viewports = [
  { key: 'desktop', width: 1440, height: 1000, screenshot: true },
  { key: 'mobile', width: 390, height: 844, screenshot: true },
  { key: 'mobile-320', width: 320, height: 720, screenshot: false },
];

const report = {
  schemaVersion: 1,
  status: 'LOCAL_ACCEPTANCE_RUNNING',
  scope: 'local-file-offline',
  startedAt: new Date().toISOString(),
  finishedAt: null,
  sourceCommit: null,
  distManifest: null,
  checks: [],
  artifacts: [],
};

function safeError(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
}

async function check(name, action) {
  const result = { name, status: 'RUNNING' };
  report.checks.push(result);
  try {
    const details = await action();
    result.status = 'PASS';
    if (details !== undefined) result.details = details;
    return details;
  } catch (error) {
    result.status = 'FAIL';
    result.error = safeError(error);
    throw error;
  }
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function requiredFile(filename) {
  const target = path.join(dist, filename);
  const metadata = await stat(target).catch(() => null);
  assert.ok(metadata?.isFile(), `Lipsește artefactul obligatoriu dist/${filename}. Rulează build-ul canonic înainte de verificare.`);
  return target;
}

async function manifestWithSourceSha() {
  const candidates = ['manifest.json', 'build-manifest.json'];
  for (const candidate of candidates) {
    const filename = path.join(dist, candidate);
    try {
      const parsed = JSON.parse(await readFile(filename, 'utf8'));
      if (typeof parsed.source_sha === 'string') return { filename: candidate, parsed };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw new Error(`Manifest invalid dist/${candidate}: ${safeError(error)}`);
    }
  }
  throw new Error('Lipsește dist/manifest.json sau dist/build-manifest.json cu proprietatea source_sha.');
}

function normalize(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/‑/g, '-').toLowerCase();
}

function monitorPage(context, page) {
  const state = { externalRequests: [], failedRequests: [], consoleErrors: [], pageErrors: [], badResponses: [] };
  context.route(/^https?:\/\//, async (route) => {
    state.externalRequests.push(route.request().url());
    await route.abort('blockedbyclient');
  });
  page.on('requestfailed', (request) => {
    state.failedRequests.push({ protocol: new URL(request.url()).protocol, path: new URL(request.url()).pathname, reason: request.failure()?.errorText || 'failed' });
  });
  page.on('console', (message) => { if (message.type() === 'error') state.consoleErrors.push(message.text().slice(0, 250)); });
  page.on('pageerror', (error) => state.pageErrors.push(error.message.slice(0, 250)));
  page.on('response', (response) => {
    if (response.status() >= 400) state.badResponses.push({ status: response.status(), path: new URL(response.url()).pathname });
  });
  return state;
}

function assertCleanOffline(state, label) {
  assert.equal(state.externalRequests.length, 0, `${label}: pagina a încercat cereri HTTP(S) externe.`);
  assert.equal(state.failedRequests.length, 0, `${label}: pagina are cereri locale eșuate.`);
  assert.equal(state.consoleErrors.length, 0, `${label}: pagina are erori în consolă.`);
  assert.equal(state.pageErrors.length, 0, `${label}: pagina are erori JavaScript necapturate.`);
  assert.equal(state.badResponses.length, 0, `${label}: pagina are răspunsuri cu eroare.`);
}

async function assertNoOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));
  assert.ok(metrics.documentWidth <= metrics.viewport + 1,
    `${label}: documentul depășește viewport-ul (${metrics.documentWidth}px > ${metrics.viewport}px).`);
  assert.ok(metrics.bodyWidth <= metrics.viewport + 1,
    `${label}: body depășește viewport-ul (${metrics.bodyWidth}px > ${metrics.viewport}px).`);
  return metrics;
}

async function assertSafeLocalDocument(page, pageFile) {
  const structure = await page.evaluate(() => {
    const unsafeSvg = [];
    for (const svg of document.querySelectorAll('svg')) {
      if (svg.querySelector('script, foreignObject, iframe, object, embed, image')) unsafeSvg.push('unsafe-child');
      for (const element of svg.querySelectorAll('*')) {
        for (const attribute of element.attributes) {
          const name = attribute.name.toLowerCase();
          const value = attribute.value.trim();
          if (name.startsWith('on')) unsafeSvg.push('event-handler');
          if ((name === 'href' || name === 'xlink:href') && value && !value.startsWith('#')) unsafeSvg.push('external-reference');
          if ((name === 'style' || name === 'fill' || name === 'stroke') && /url\((?!\s*#)/i.test(value)) unsafeSvg.push('external-style-reference');
        }
      }
    }
    return {
      baseCount: document.querySelectorAll('base').length,
      embeddedCount: document.querySelectorAll('iframe, object, embed').length,
      remoteAssetAttributes: [...document.querySelectorAll('script[src], link[rel~="stylesheet"][href], img[src], source[src], video[src], audio[src]')]
        .map((element) => element.getAttribute('src') || element.getAttribute('href')),
      formActions: [...document.querySelectorAll('form[action]')].map((form) => form.getAttribute('action')),
      refreshCount: document.querySelectorAll('meta[http-equiv="refresh" i]').length,
      unsafeSvg,
      links: [...document.querySelectorAll('a[href]')].map((anchor) => anchor.getAttribute('href')),
    };
  });

  assert.equal(structure.baseCount, 0, `${pageFile}: elementul <base> nu este permis.`);
  assert.equal(structure.embeddedCount, 0, `${pageFile}: conținutul embedded nu este permis.`);
  assert.equal(structure.remoteAssetAttributes.length, 0, `${pageFile}: prezentarea trebuie să păstreze CSS, JS și SVG inline.`);
  assert.equal(structure.formActions.filter((action) => action && action !== '#').length, 0, `${pageFile}: formular cu destinație externă.`);
  assert.equal(structure.refreshCount, 0, `${pageFile}: redirect-ul meta refresh nu este permis.`);
  assert.equal(structure.unsafeSvg.length, 0, `${pageFile}: SVG inline nesigur.`);

  for (const href of structure.links) {
    assert.ok(/^#[A-Za-z][\w:.-]*$/.test(href) || /^(?:\.\/)?(?:index|salons|clubs)\.html(?:#[A-Za-z][\w:.-]*)?$/.test(href),
      `${pageFile}: link-ul nu este fragment local sau pagină HTML soră: ${href}`);
    if (href.startsWith('#')) {
      const target = await page.locator(href).count().catch(() => 0);
      assert.ok(target > 0, `${pageFile}: fragment inexistent ${href}`);
    } else {
      const targetName = href.replace(/^\.\//, '').split('#', 1)[0];
      await requiredFile(targetName);
      const fragment = href.includes('#') ? href.slice(href.indexOf('#') + 1) : null;
      if (fragment) {
        const source = await readFile(path.join(dist, targetName), 'utf8');
        const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        assert.match(source, new RegExp(`\\bid=["']${escaped}["']`), `${pageFile}: fragment inexistent în ${targetName}#${fragment}`);
      }
    }
  }
  return { linkCount: structure.links.length, inlineSvgSafe: true, selfContained: true };
}

async function assertRequiredProductContent(page, pageFile) {
  const text = normalize(await page.locator('body').innerText());
  const requirements = [
    ['SaaS', /\bsaas\b/],
    ['On-Premise', /\bon-premise\b/],
    ['Powered by Clarified', /powered by clarified/],
    ['financiar', /financ/],
    ['stocuri sau inventar', /stoc|inventar/],
    ['mai multe sedii', /multi[ -]?(?:sedi|locatie)|mai multe sedii|retea/],
    ['comunicare', /comunic|sms|whatsapp/],
    ['Microsoft 365', /m365|microsoft 365/],
    ['Concept de produs', /concept de produs/],
    ['Date ilustrative', /date ilustrative/],
  ];
  for (const [label, pattern] of requirements) assert.match(text, pattern, `${pageFile}: lipsește conținutul obligatoriu „${label}”.`);
  const panels = page.locator('[data-mode-panel]');
  assert.equal(await panels.count(), 2, `${pageFile}: sunt necesare exact două panouri de deployment.`);
  return { requirements: requirements.map(([label]) => label), conceptDisclosure: true, illustrativeDataDisclosure: true };
}

async function assertDeploymentControls(page, pageFile) {
  const buttons = page.locator('[data-mode]');
  const panels = page.locator('[data-mode-panel]');
  assert.equal(await buttons.count(), 2, `${pageFile}: sunt necesare exact două butoane data-mode.`);
  assert.deepEqual(new Set(await buttons.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-mode')))), new Set(['saas', 'onprem']));
  assert.deepEqual(new Set(await panels.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-mode-panel')))), new Set(['saas', 'onprem']));
  assert.ok((await buttons.evaluateAll((nodes) => nodes.every((node) => node.tagName === 'BUTTON' && (node.textContent || '').trim().length > 0))),
    `${pageFile}: selectorul de deployment trebuie să folosească butoane accesibile, cu nume vizibil.`);
  assert.match(normalize(await page.locator('[data-mode="saas"]').innerText()), /saas/, `${pageFile}: lipsește eticheta SaaS.`);
  assert.match(normalize(await page.locator('[data-mode="onprem"]').innerText()), /on[- ]?premise/, `${pageFile}: lipsește eticheta On-Premise.`);
  for (const mode of ['saas', 'onprem']) {
    await page.locator(`[data-mode="${mode}"]`).click();
    for (const candidate of ['saas', 'onprem']) {
      assert.equal(await page.locator(`[data-mode="${candidate}"]`).getAttribute('aria-pressed'), String(candidate === mode),
        `${pageFile}: aria-pressed incorect pentru ${candidate}.`);
      assert.equal(await page.locator(`[data-mode-panel="${candidate}"]`).isVisible(), candidate === mode,
        `${pageFile}: panoul vizibil nu corespunde modului ${mode}.`);
    }
  }
  await page.locator('[data-mode="saas"]').click();
  return { modes: ['saas', 'onprem'], ariaPressed: true, selectedPanelOnly: true };
}

async function assertFixedBrand(page, config) {
  assert.ok((await page.title()).includes(config.brand), `${config.file}: titlul documentului nu include ${config.brand}.`);
  const headerText = await page.locator('header').first().innerText();
  assert.match(normalize(headerText), new RegExp(normalize(config.brand)), `${config.file}: antetul nu include ${config.brand}.`);
  assert.equal(await page.locator('[data-name]').count(), 0, `${config.file}: selectorul de nume nu mai face parte din produsul final.`);
  return { brand: config.brand, title: true, header: true, namePicker: false };
}

async function verifyIndex(page) {
  const text = await page.locator('body').innerText();
  for (const name of ['OrdoSalons', 'OrdoClubs']) assert.match(text, new RegExp(name));
  const links = await page.locator('a[href]').evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute('href')));
  assert.ok(links.some((href) => /^(?:\.\/)?salons\.html(?:#.*)?$/.test(href)), 'index.html: lipsește link-ul către salons.html.');
  assert.ok(links.some((href) => /^(?:\.\/)?clubs\.html(?:#.*)?$/.test(href)), 'index.html: lipsește link-ul către clubs.html.');
  return { productNames: ['OrdoSalons', 'OrdoClubs'], siblingLinks: true };
}

function pdfPageCount(buffer) {
  return (buffer.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
}

let browser;
try {
  await mkdir(outputs, { recursive: true });
  await check('Buildul provine din commitul canonic curat și manifestul are același SHA', async () => {
    const sourceCommit = git('rev-parse', 'HEAD');
    assert.match(sourceCommit, /^[0-9a-f]{40}$/);
    assert.equal(git('status', '--porcelain', '--untracked-files=no'), '', 'Working tree-ul urmărit de Git nu este curat.');
    for (const page of pages) await requiredFile(page.file);
    const manifest = await manifestWithSourceSha();
    assert.equal(manifest.parsed.source_sha, sourceCommit, 'source_sha din manifest nu corespunde commitului curent.');
    report.sourceCommit = sourceCommit;
    report.distManifest = manifest.filename;
    return { sourceCommit, manifest: `dist/${manifest.filename}`, pages: pages.map((page) => `dist/${page.file}`) };
  });

  const moduleUrl = playwrightModule.startsWith('file:') ? playwrightModule : pathToFileURL(path.resolve(playwrightModule)).href;
  const { chromium } = await import(moduleUrl);
  browser = await chromium.launch({ headless: true });

  for (const config of pages) {
    for (const viewport of viewports) {
      await check(`${config.file} · ${viewport.width}px · offline, sigur și fără overflow`, async () => {
        const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, locale: 'ro-RO' });
        const page = await context.newPage();
        const state = monitorPage(context, page);
        try {
          const response = await page.goto(pathToFileURL(path.join(dist, config.file)).href, { waitUntil: 'load' });
          assert.ok(response?.ok(), `${config.file}: documentul local nu s-a încărcat.`);
          const local = await assertSafeLocalDocument(page, config.file);
          const metrics = await assertNoOverflow(page, `${config.file} ${viewport.width}px`);
          let contract;
          if (config.kind === 'index') {
            contract = await verifyIndex(page);
          } else {
            await assertRequiredProductContent(page, config.file);
            await assertDeploymentControls(page, config.file);
            contract = await assertFixedBrand(page, config);
          }
          assertCleanOffline(state, `${config.file} ${viewport.width}px`);
          if (viewport.screenshot) {
            const filename = `${config.key}-${viewport.key}.png`;
            await page.screenshot({ path: path.join(outputs, filename), fullPage: true, animations: 'disabled' });
            report.artifacts.push({ type: 'screenshot', page: config.file, viewport: `${viewport.width}x${viewport.height}`, file: `outputs/${filename}` });
          }
          if (config.kind === 'product' && viewport.key === 'desktop') {
            await page.emulateMedia({ media: 'print' });
            const pdfName = config.pdf;
            await page.pdf({ path: path.join(outputs, pdfName), format: 'A4', preferCSSPageSize: true, printBackground: true });
            await page.emulateMedia({ media: 'screen' });
            const pdf = await readFile(path.join(outputs, pdfName));
            const pageCount = pdfPageCount(pdf);
            assert.ok(pageCount > 0, `${config.file}: PDF-ul nu conține pagini detectabile.`);
            report.artifacts.push({ type: 'pdf', page: config.file, brand: config.brand, pageCount, file: `outputs/${pdfName}` });
          }
          return { ...local, ...metrics, ...contract };
        } finally {
          await context.close();
        }
      });
    }
  }
} catch (error) {
  if (!report.checks.some((item) => item.status === 'FAIL')) report.checks.push({ name: 'Runner intern', status: 'FAIL', error: safeError(error) });
} finally {
  if (browser) await browser.close().catch(() => {});
  report.finishedAt = new Date().toISOString();
  report.status = report.checks.length > 0 && report.checks.every((item) => item.status === 'PASS')
    ? 'LOCAL_ACCEPTANCE_PASS'
    : 'LOCAL_ACCEPTANCE_FAIL';
  await mkdir(outputs, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  const summary = {
    status: report.status,
    passed: report.checks.filter((item) => item.status === 'PASS').length,
    failed: report.checks.filter((item) => item.status === 'FAIL').length,
    report: 'outputs/local-acceptance-report.json',
  };
  console.log(JSON.stringify(summary));
  if (report.status !== 'LOCAL_ACCEPTANCE_PASS') process.exitCode = 1;
}
