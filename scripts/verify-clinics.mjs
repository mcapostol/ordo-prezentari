import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = process.argv[2] || pathToFileURL(path.join(root, 'dist/')).href;
const live = base.startsWith('https://');
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(), '', 'A clean canonical commit is required');
const manifest = JSON.parse(await readFile(path.join(root, 'dist/manifest.json'), 'utf8'));
assert.equal(manifest.source_sha, sourceSha);
if (live) {
  const published = await fetch(new URL('manifest.json', base), { cache: 'no-store' });
  assert.equal(published.status, 200);
  assert.deepEqual(await published.json(), manifest);
  for (const file of ['clinics/index.html', 'clinics/demo/index.html']) {
    const response = await fetch(new URL(file, base), { cache: 'no-store' });
    assert.equal(response.status, 200);
    assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), manifest.files[file].sha256);
  }
}
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/home/capostol/clarified-social-publisher/management_clinica/carevia/node_modules/@playwright/test/index.mjs');
const browser = await chromium.launch({ headless: true });
const checks = [];
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.protocol.startsWith('http') && (!live || url.origin !== new URL(base).origin)) external.push(url.href);
    });
    await page.goto(new URL('clinics/index.html', base).href, { waitUntil: 'networkidle' });
    assert.match(await page.title(), /OrdoClinics/);
    assert.equal(await page.locator('[data-pricing-grid] .pricing-card').count(), 3);
    for (const [plan, amount] of [['starter', 99], ['growth', 249], ['network', 499]]) {
      assert.match(await page.locator(`[data-plan="${plan}"] .plan-price`).innerText(), new RegExp(String(amount)));
    }
    assert.match(await page.locator('[data-onprem-prices]').innerText(), /4[.\s]?900/);
    assert.match(await page.locator('[data-onprem-prices]').innerText(), /1[.\s]?490/);
    assert.match(await page.locator('[data-onprem-prices]').innerText(), /1[.\s]?190/);
    for (const [locations, expected] of [[1, 'Starter'], [3, 'Growth'], [6, 'Network'], [7, 'personalizat']]) {
      await page.locator('input[name="locations"]').fill(String(locations));
      assert.match(await page.locator('[data-plan-result]').innerText(), new RegExp(expected, 'i'));
    }
    assert.equal(await page.locator('a.header-cta').getAttribute('href'), 'demo/');
    assert.match(await page.locator('.publication-note').innerText(), /date fictive/);
    assert.equal(await page.locator('a[href^="mailto:office@clarified.ro"]').count() >= 5, true);
    const metrics = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
    assert.ok(metrics.width <= metrics.viewport + 1, `Horizontal overflow: ${JSON.stringify(metrics)}`);
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    await mkdir(path.join(root, 'outputs'), { recursive: true });
    await page.screenshot({ path: path.join(root, `outputs/clinics-${live ? 'live' : 'local'}-${viewport.width}.png`), fullPage: true });
    checks.push({ viewport, pricing: 'PASS', calculator: 'PASS', responsive: 'PASS', networkIndependent: 'PASS' });
    await page.goto(new URL('clinics/demo/index.html', base).href, { waitUntil: 'networkidle' });
    assert.match(await page.locator('.demo-banner').innerText(), /date fictive/);
    const navigate = async view => {
      if (viewport.width < 761) await page.locator('#menu-toggle').click();
      await page.locator(`.nav [data-view="${view}"]`).click();
    };
    if (viewport.width > 1000) {
      await navigate('patients');
      await page.locator('[data-open="patient-form"]').click();
      await page.locator('#new-patient-form [name="name"]').fill('Pacient Verificare Demo');
      await page.locator('#new-patient-form [name="email"]').fill('verificare@example.test');
      await page.locator('#new-patient-form button[type="submit"]').click();
      assert.match(await page.locator('#patients-table').innerText(), /Pacient Verificare Demo/);
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ordoclinics.demo.v1')));
      const patientId = saved.patients.find(item => item.name === 'Pacient Verificare Demo').id;
      await navigate('appointments');
      await page.locator('[data-open="appointment-form"]').click();
      await page.locator('#new-appointment-form [name="patient"]').selectOption(patientId);
      await page.locator('#new-appointment-form [name="type"]').fill('Control demonstrativ verificat');
      await page.locator('#new-appointment-form button[type="submit"]').click();
      assert.match(await page.locator('#calendar').innerText(), /Control demonstrativ verificat/);
      await navigate('communications');
      assert.equal(await page.locator('.outbox-row').count(), 3, 'Appointments create three simulated notifications');
      await page.locator('#communication-form button[type="submit"]').click();
      assert.equal(await page.locator('.outbox-row').count(), 6);
      await navigate('finance');
      const all = await page.locator('#pnl-card').innerText();
      await page.locator('#branch-filter').selectOption('nord');
      assert.notEqual(await page.locator('#pnl-card').innerText(), all);
      assert.equal(await page.locator('#finance-branches .branch-card').count(), 1);
      await page.locator('#branch-filter').selectOption('all');
      await navigate('inventory');
      await page.locator('[data-open="order-form"]').click();
      await page.locator('#new-order-form [name="qty"]').fill('17');
      await page.locator('#new-order-form button[type="submit"]').click();
      const order = page.locator('.order-card').first();
      assert.match(await order.innerText(), /17 unități/);
      await order.locator('button').click();
      assert.match(await page.locator('.order-card').first().innerText(), /Aprobată/);
      await page.reload({ waitUntil: 'networkidle' });
      await navigate('patients');
      assert.match(await page.locator('#patients-table').innerText(), /Pacient Verificare Demo/);
      const reopened = await context.newPage();
      await reopened.goto(new URL('clinics/demo/index.html', base).href, { waitUntil: 'networkidle' });
      const persisted = await reopened.evaluate(() => JSON.parse(localStorage.getItem('ordoclinics.demo.v1')));
      assert.equal(persisted.outbox.length, 6);
      assert.ok(persisted.appointments.some(item => item.type === 'Control demonstrativ verificat'));
      assert.ok(persisted.orders.some(item => item.qty === 17 && item.status === 'Aprobată'));
      await reopened.close();
      checks.push({ viewport, patientAndAppointment: 'PASS', notifications: 'SIMULATED_ONLY', branchPnl: 'PASS', orderApproval: 'PASS', refreshAndReopenPersistence: 'PASS' });
    } else {
      for (const view of ['patients', 'appointments', 'communications', 'finance', 'inventory']) {
        await navigate(view);
        const width = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
        assert.ok(width.width <= width.viewport + 1, `${view}: horizontal overflow`);
      }
      checks.push({ viewport, demoMobileNavigation: 'PASS' });
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    await page.screenshot({ path: path.join(root, `outputs/clinics-demo-${live ? 'live' : 'local'}-${viewport.width}.png`), fullPage: true });
    await context.close();
  }
} finally { await browser.close(); }
const report = { sourceSha, scope: live ? 'public-presentation' : 'built-presentation', status: live ? 'VERIFIED_LIVE' : 'VERIFIED_BUILD', checks };
await writeFile(path.join(root, `outputs/clinics-presentation-${live ? 'live' : 'local'}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
