#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const CATALOG_FILE = 'commercial-offers.json';
const PRODUCT_FILES = Object.freeze({
  salons: 'salons.html',
  clubs: 'clubs.html',
  rezidential: 'rezidential.html',
  administratii: 'administratii.html',
  farm: 'farm.html',
});
const PRODUCT_BRANDS = Object.freeze({
  salons: 'OrdoSalons',
  clubs: 'OrdoClubs',
  rezidential: 'OrdoRezidential',
  administratii: 'OrdoAdministratii',
  farm: 'OrdoFarm',
});
const PLAN_IDS = Object.freeze(['starter', 'growth', 'network']);
const HTML_START = '<!-- ORDO_PRICING_START -->';
const HTML_END = '<!-- ORDO_PRICING_END -->';
const CSS_START = '/* ORDO_PRICING_CSS_START */';
const CSS_END = '/* ORDO_PRICING_CSS_END */';

const PALETTES = Object.freeze({
  salons: { primary: '#44263b', primary2: '#60364f', accent: '#c98665', tint: '#faf5f0', ink: '#251b22', muted: '#75666e', line: '#e7d9d2' },
  clubs: { primary: '#111e35', primary2: '#192944', accent: '#3e63f3', tint: '#f5f7fc', ink: '#18243a', muted: '#62708a', line: '#dce3ef' },
  rezidential: { primary: '#173f4f', primary2: '#234f5d', accent: '#d3b275', tint: '#f4f0e7', ink: '#24363d', muted: '#68767b', line: '#d8d7d0' },
  administratii: { primary: '#252d35', primary2: '#313b45', accent: '#e39449', tint: '#f5f6f7', ink: '#28323b', muted: '#69747e', line: '#dce0e3' },
  farm: { primary: '#234f84', primary2: '#173b66', accent: '#00a79d', tint: '#f4fafc', ink: '#172c45', muted: '#66768a', line: '#d7e3e9' },
});

function fail(message) {
  throw new Error(`Pricing: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  if (!isRecord(value)) fail(`${label} trebuie să fie obiect.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} trebuie să conțină exact câmpurile: ${expected.join(', ')}.`);
  }
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) fail(`${label} trebuie să fie text nevid fără spații marginale.`);
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} trebuie să fie număr întreg EUR/cantitate, pozitiv sau zero.`);
}

function range(value, label) {
  if (!Array.isArray(value) || value.length !== 2) fail(`${label} trebuie să fie interval [min, max].`);
  nonNegativeInteger(value[0], `${label}[0]`);
  nonNegativeInteger(value[1], `${label}[1]`);
  if (value[0] > value[1]) fail(`${label}: minimul nu poate depăși maximul.`);
}

function validateCatalog(catalog) {
  exactKeys(catalog, ['version', 'currency', 'vatIncluded', 'asOf', 'status', 'commercialNote', 'products'], 'catalogul');
  if (catalog.version !== 1) fail('versiunea catalogului trebuie să fie 1.');
  if (catalog.currency !== 'EUR') fail('moneda catalogului trebuie să fie EUR.');
  if (catalog.vatIncluded !== false) fail('vatIncluded trebuie să fie false pentru intervalele fără TVA.');
  if (catalog.status !== 'proposal') fail('status trebuie să fie proposal.');
  if (catalog.asOf !== '2026-10-25') fail('asOf trebuie să fie data comercială verificată 2026-10-25.');
  nonEmptyString(catalog.commercialNote, 'commercialNote');
  exactKeys(catalog.products, Object.keys(PRODUCT_FILES), 'products');

  for (const [key, product] of Object.entries(catalog.products)) {
    exactKeys(product, ['brand', 'unitLabel', 'scopeNote', 'saas', 'onPrem', 'extraScope'], `products.${key}`);
    if (product.brand !== PRODUCT_BRANDS[key]) fail(`products.${key}.brand trebuie să fie ${PRODUCT_BRANDS[key]}.`);
    nonEmptyString(product.unitLabel, `products.${key}.unitLabel`);
    nonEmptyString(product.scopeNote, `products.${key}.scopeNote`);
    nonEmptyString(product.extraScope, `products.${key}.extraScope`);
    if (!Array.isArray(product.saas) || product.saas.length !== 3) fail(`products.${key}.saas trebuie să conțină exact trei planuri.`);

    product.saas.forEach((plan, index) => {
      exactKeys(plan, ['id', 'name', 'scope', 'monthly', 'setup', 'smsSegments', 'whatsappUtility', 'emails', 'supportMinutes'], `products.${key}.saas[${index}]`);
      if (plan.id !== PLAN_IDS[index]) fail(`products.${key}.saas[${index}].id trebuie să fie ${PLAN_IDS[index]}.`);
      nonEmptyString(plan.name, `products.${key}.saas[${index}].name`);
      nonEmptyString(plan.scope, `products.${key}.saas[${index}].scope`);
      range(plan.monthly, `products.${key}.saas[${index}].monthly`);
      range(plan.setup, `products.${key}.saas[${index}].setup`);
      for (const field of ['smsSegments', 'whatsappUtility', 'emails', 'supportMinutes']) {
        nonNegativeInteger(plan[field], `products.${key}.saas[${index}].${field}`);
      }
    });

    exactKeys(product.onPrem, ['scope', 'license', 'implementation', 'maintenanceMonthly', 'supportMinutes'], `products.${key}.onPrem`);
    nonEmptyString(product.onPrem.scope, `products.${key}.onPrem.scope`);
    range(product.onPrem.license, `products.${key}.onPrem.license`);
    range(product.onPrem.implementation, `products.${key}.onPrem.implementation`);
    range(product.onPrem.maintenanceMonthly, `products.${key}.onPrem.maintenanceMonthly`);
    nonNegativeInteger(product.onPrem.supportMinutes, `products.${key}.onPrem.supportMinutes`);
  }
  return catalog;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function formatInteger(value) {
  nonNegativeInteger(value, 'valoarea afișată');
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function formatRange([minimum, maximum]) {
  return minimum === maximum ? formatInteger(minimum) : `${formatInteger(minimum)}–${formatInteger(maximum)}`;
}

function sumRange(first, second) {
  return [first[0] + second[0], first[1] + second[1]];
}

function multiplyRange(value, multiplier) {
  return [value[0] * multiplier, value[1] * multiplier];
}

function productKey(product, catalog) {
  const match = Object.entries(catalog.products).find(([, candidate]) => candidate === product || candidate.brand === product?.brand);
  if (!match) fail('produsul transmis către renderPricing nu aparține catalogului.');
  return match[0];
}

function renderPlan(plan) {
  return `
        <article class="op-plan${plan.id === 'growth' ? ' op-plan-featured' : ''}">
          <div class="op-plan-head">
            <span class="op-plan-name">${escapeHtml(plan.name)}</span>
            ${plan.id === 'growth' ? '<span class="op-plan-tag">Echilibru operațional</span>' : ''}
          </div>
          <p class="op-scope">${escapeHtml(plan.scope)}</p>
          <div class="op-price"><strong>${formatRange(plan.monthly)} €</strong><span>/ lună · total organizație</span></div>
          <p class="op-setup"><b>${formatRange(plan.setup)} €</b> configurare inițială, o singură dată</p>
          <ul class="op-allowances">
            <li><span>SMS</span><b>${formatInteger(plan.smsSegments)} segmente / lună</b></li>
            <li><span>WhatsApp</span><b>${formatInteger(plan.whatsappUtility)} Utility / lună</b></li>
            <li><span>Email</span><b>${formatInteger(plan.emails)} mesaje / lună</b></li>
            <li><span>Suport inclus</span><b>${formatInteger(plan.supportMinutes)} min / lună</b></li>
          </ul>
        </article>`;
}

export function renderPricing(product, catalog) {
  validateCatalog(catalog);
  const key = productKey(product, catalog);
  const current = catalog.products[key];
  const onPrem = current.onPrem;
  const initial = sumRange(onPrem.license, onPrem.implementation);
  const annualMaintenance = multiplyRange(onPrem.maintenanceMonthly, 12);

  return `${HTML_START}
  <section class="ordo-pricing op-theme-${key}" id="tarife" aria-labelledby="tarife-heading">
    <div class="op-shell">
      <header class="op-heading">
        <div>
          <p class="op-eyebrow">Ofertă comercială propusă · ${escapeHtml(catalog.asOf)}</p>
          <h2 id="tarife-heading">Tarife clare pentru ${escapeHtml(current.brand)}.</h2>
          <p>${escapeHtml(current.scopeNote)}</p>
        </div>
        <span class="op-label">Intervale orientative · EUR, fără TVA</span>
      </header>

      <div class="op-saas-head">
        <div><span class="op-number">01</span><strong>SaaS administrat · ${escapeHtml(current.unitLabel)}</strong></div>
        <p>Găzduirea, actualizările și backupul sunt incluse în limitele și responsabilitățile contractate.</p>
      </div>
      <div class="op-plans">
        ${current.saas.map(renderPlan).join('')}
      </div>

      <div class="op-onprem">
        <div class="op-onprem-intro">
          <span class="op-number">02</span>
          <p class="op-eyebrow">Instalare în infrastructura clientului</p>
          <h3>On‑Premise</h3>
          <p>${escapeHtml(onPrem.scope)}</p>
        </div>
        <div class="op-onprem-prices">
          <div class="op-total"><span>Investiție inițială totală</span><strong>${formatRange(initial)} €</strong><small>licență + implementare, o singură dată</small></div>
          <dl>
            <div><dt>Licență</dt><dd>${formatRange(onPrem.license)} €</dd></div>
            <div><dt>Implementare</dt><dd>${formatRange(onPrem.implementation)} €</dd></div>
            <div><dt>Mentenanță</dt><dd>${formatRange(onPrem.maintenanceMonthly)} € / lună</dd></div>
            <div><dt>Echivalent anual mentenanță</dt><dd>${formatRange(annualMaintenance)} € / an</dd></div>
            <div><dt>Suport inclus</dt><dd>${formatInteger(onPrem.supportMinutes)} min / lună</dd></div>
          </dl>
        </div>
      </div>

      <div class="op-notes">
        <p><strong>Comunicare inclusă în SaaS.</strong> Cotele sunt lunare, comune organizației și nu se reportează. SMS se contorizează pe segmente; WhatsApp include doar mesaje Utility, fără Marketing; depășirea necesită un buget suplimentar agreat. Este inclus un profil de expeditor per organizație, după aprobarea și configurarea furnizorului.</p>
        <p><strong>Perimetru separat.</strong> În On‑Premise, infrastructura clientului, Microsoft 365 și consumul furnizorilor sunt separate. Migrările complexe, dezvoltările, conectorii personalizați sau reglementați se ofertează distinct. ${escapeHtml(current.extraScope)}</p>
      </div>
      <footer class="op-commercial">
        <p>${escapeHtml(catalog.commercialNote)}</p>
        <strong>Oferta finală confirmă perimetrul, volumele, responsabilitățile și calendarul de implementare.</strong>
      </footer>
    </div>
  </section>
${HTML_END}`.replace(/[ \t]+$/gm, '');
}

export function renderPricingCss(key) {
  const palette = PALETTES[key];
  if (!palette) fail(`paletă necunoscută pentru ${key}.`);
  return `${CSS_START}
    .op-price-jump { display: inline-flex; align-items: center; margin-top: 16px; padding: 9px 12px; border: 1px solid ${palette.line}; border-radius: 9px; color: ${palette.primary}; background: ${palette.tint}; font-size: 10px; font-weight: 850; text-decoration: none; }
    .op-price-jump:hover { border-color: ${palette.accent}; color: ${palette.primary2}; }
    .op-price-jump:focus-visible { outline: 3px solid ${palette.accent}; outline-offset: 3px; }
    .ordo-pricing {
      --op-primary: ${palette.primary};
      --op-primary-2: ${palette.primary2};
      --op-accent: ${palette.accent};
      --op-tint: ${palette.tint};
      --op-ink: ${palette.ink};
      --op-muted: ${palette.muted};
      --op-line: ${palette.line};
      padding: 94px 0;
      color: var(--op-ink);
      background: var(--op-tint);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      line-height: 1.5;
    }
    .ordo-pricing *, .ordo-pricing *::before, .ordo-pricing *::after { box-sizing: border-box; }
    .ordo-pricing .op-shell { width: min(1160px, calc(100% - 42px)); margin: 0 auto; }
    .ordo-pricing .op-heading { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 36px; margin-bottom: 34px; }
    .ordo-pricing .op-heading > div { max-width: 760px; min-width: 0; }
    .ordo-pricing .op-eyebrow { margin: 0 0 10px; color: var(--op-accent); font-size: 9px; font-weight: 900; letter-spacing: .13em; text-transform: uppercase; }
    .ordo-pricing h2, .ordo-pricing h3, .ordo-pricing p { margin-top: 0; }
    .ordo-pricing h2 { margin-bottom: 12px; color: var(--op-primary); font-size: clamp(36px, 4.7vw, 58px); line-height: 1.02; letter-spacing: -.05em; }
    .ordo-pricing .op-heading p:last-child { max-width: 700px; margin-bottom: 0; color: var(--op-muted); font-size: 14px; }
    .ordo-pricing .op-label { padding: 8px 11px; border: 1px solid var(--op-line); border-radius: 999px; color: var(--op-muted); background: #fff; font-size: 9px; font-weight: 850; white-space: nowrap; }
    .ordo-pricing .op-saas-head { display: flex; align-items: center; justify-content: space-between; gap: 22px; margin-bottom: 13px; }
    .ordo-pricing .op-saas-head > div { display: flex; align-items: center; gap: 9px; color: var(--op-primary); }
    .ordo-pricing .op-saas-head p { max-width: 580px; margin: 0; color: var(--op-muted); font-size: 11px; text-align: right; }
    .ordo-pricing .op-number { display: inline-grid; width: 25px; height: 25px; place-items: center; border-radius: 7px; color: var(--op-primary); background: color-mix(in srgb, var(--op-accent) 25%, white); font-size: 8px; font-weight: 900; }
    .ordo-pricing .op-plans { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 13px; }
    .ordo-pricing .op-plan { min-width: 0; padding: 21px; border: 1px solid var(--op-line); border-radius: 18px; background: #fff; box-shadow: 0 9px 26px color-mix(in srgb, var(--op-primary) 9%, transparent); }
    .ordo-pricing .op-plan-featured { border-top: 5px solid var(--op-accent); padding-top: 17px; }
    .ordo-pricing .op-plan-head { min-height: 26px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .ordo-pricing .op-plan-name { color: var(--op-primary); font-size: 16px; font-weight: 900; }
    .ordo-pricing .op-plan-tag { padding: 4px 6px; border-radius: 999px; color: var(--op-primary); background: color-mix(in srgb, var(--op-accent) 20%, white); font-size: 7px; font-weight: 900; white-space: nowrap; }
    .ordo-pricing .op-scope { min-height: 42px; margin: 7px 0 11px; color: var(--op-muted); font-size: 12px; }
    .ordo-pricing .op-price strong { display: block; color: var(--op-primary); font-size: clamp(25px, 2.8vw, 34px); line-height: 1; letter-spacing: -.045em; }
    .ordo-pricing .op-price span { display: block; margin-top: 5px; color: var(--op-muted); font-size: 10px; }
    .ordo-pricing .op-setup { margin: 12px 0; padding: 9px; border-radius: 9px; color: var(--op-muted); background: var(--op-tint); font-size: 11px; }
    .ordo-pricing .op-setup b { color: var(--op-primary); }
    .ordo-pricing .op-allowances { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
    .ordo-pricing .op-allowances li { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 7px 0; border-bottom: 1px solid var(--op-line); font-size: 11px; }
    .ordo-pricing .op-allowances li:last-child { border: 0; }
    .ordo-pricing .op-allowances span { color: var(--op-muted); }
    .ordo-pricing .op-allowances b { color: var(--op-primary); text-align: right; }
    .ordo-pricing .op-onprem { display: grid; grid-template-columns: .83fr 1.17fr; gap: 24px; margin-top: 14px; padding: 22px; border-radius: 18px; color: #fff; background: var(--op-primary); }
    .ordo-pricing .op-onprem-intro .op-number { margin-bottom: 12px; }
    .ordo-pricing .op-onprem-intro .op-eyebrow { color: #fff; }
    .ordo-pricing .op-onprem-intro h3 { margin-bottom: 7px; color: #fff; font-size: 25px; letter-spacing: -.035em; }
    .ordo-pricing .op-onprem-intro > p:last-child { margin: 0; color: rgba(255,255,255,.82); font-size: 12px; }
    .ordo-pricing .op-onprem-prices { display: grid; grid-template-columns: .8fr 1.2fr; gap: 12px; }
    .ordo-pricing .op-total { display: flex; flex-direction: column; justify-content: center; padding: 15px; border: 1px solid color-mix(in srgb, var(--op-accent) 50%, transparent); border-radius: 12px; background: color-mix(in srgb, var(--op-accent) 13%, transparent); }
    .ordo-pricing .op-total span, .ordo-pricing .op-total small { color: rgba(255,255,255,.72); font-size: 7px; }
    .ordo-pricing .op-total strong { margin: 6px 0; color: #fff; font-size: 22px; letter-spacing: -.035em; }
    .ordo-pricing dl { margin: 0; }
    .ordo-pricing dl div { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,.11); font-size: 11px; }
    .ordo-pricing dl div:last-child { border: 0; }
    .ordo-pricing dt { color: rgba(255,255,255,.67); }
    .ordo-pricing dd { margin: 0; color: #fff; font-weight: 850; text-align: right; }
    .ordo-pricing .op-notes { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
    .ordo-pricing .op-notes p { margin: 0; padding: 10px 12px; border: 1px solid var(--op-line); border-radius: 11px; color: var(--op-muted); background: #fff; font-size: 11px; }
    .ordo-pricing .op-notes strong { color: var(--op-primary); }
    .ordo-pricing .op-commercial { display: grid; grid-template-columns: 1.3fr .7fr; align-items: center; gap: 16px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--op-line); }
    .ordo-pricing .op-commercial p, .ordo-pricing .op-commercial strong { margin: 0; color: var(--op-muted); font-size: 10px; }
    .ordo-pricing .op-commercial strong { color: var(--op-primary); text-align: right; }
    @media (max-width: 760px) {
      .ordo-pricing { padding: 68px 0; }
      .ordo-pricing .op-shell { width: min(100% - 28px, 1160px); }
      .ordo-pricing .op-heading { grid-template-columns: 1fr; align-items: start; gap: 13px; }
      .ordo-pricing h2 { overflow-wrap: anywhere; font-size: clamp(29px, 10vw, 42px); }
      .ordo-pricing .op-label { white-space: normal; }
      .ordo-pricing .op-saas-head { align-items: flex-start; flex-direction: column; }
      .ordo-pricing .op-saas-head p { text-align: left; }
      .ordo-pricing .op-plans, .ordo-pricing .op-onprem, .ordo-pricing .op-onprem-prices, .ordo-pricing .op-notes, .ordo-pricing .op-commercial { grid-template-columns: 1fr; }
      .ordo-pricing .op-scope { min-height: 0; }
      .ordo-pricing .op-commercial strong { text-align: left; }
    }
    @media (prefers-reduced-motion: reduce) {
      .ordo-pricing *, .ordo-pricing *::before, .ordo-pricing *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
    }
    @media print {
      .ordo-pricing { min-height: 0; display: block; break-before: page; break-after: auto; padding: 5mm 0; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      body > footer { display: none !important; }
      .op-price-jump { display: none !important; }
      .ordo-pricing .op-shell { width: 100%; }
      .ordo-pricing .op-commercial { display: grid !important; }
      .ordo-pricing .op-heading { grid-template-columns: 1fr auto; gap: 12px; margin-bottom: 9px; }
      .ordo-pricing h2 { margin-bottom: 4px; font-size: 19pt; }
      .ordo-pricing .op-heading p:last-child { font-size: 7pt; }
      .ordo-pricing .op-label { padding: 4px 6px; font-size: 6pt; }
      .ordo-pricing .op-saas-head { margin-bottom: 5px; }
      .ordo-pricing .op-saas-head p { font-size: 6pt; }
      .ordo-pricing .op-number { width: 18px; height: 18px; font-size: 7pt; }
      .ordo-pricing .op-plans { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
      .ordo-pricing .op-plan { break-inside: avoid; padding: 9px; border-radius: 10px; box-shadow: none; }
      .ordo-pricing .op-plan-featured { padding-top: 6px; border-top-width: 4px; }
      .ordo-pricing .op-plan-head { min-height: 17px; }
      .ordo-pricing .op-plan-name { font-size: 9pt; }
      .ordo-pricing .op-plan-tag { font-size: 6.5pt; }
      .ordo-pricing .op-scope { min-height: 26px; margin: 3px 0 5px; font-size: 6pt; }
      .ordo-pricing .op-price strong { font-size: 15pt; }
      .ordo-pricing .op-price span, .ordo-pricing .op-setup { font-size: 7pt; }
      .ordo-pricing .op-setup { margin: 5px 0; padding: 5px; }
      .ordo-pricing .op-allowances li { padding: 3px 0; font-size: 7pt; }
      .ordo-pricing .op-onprem { break-inside: avoid; grid-template-columns: .78fr 1.22fr; gap: 8px; margin-top: 6px; padding: 9px; border-radius: 10px; }
      .ordo-pricing .op-onprem-intro .op-number { margin-bottom: 4px; }
      .ordo-pricing .op-onprem-intro h3 { margin-bottom: 3px; font-size: 12pt; }
      .ordo-pricing .op-onprem-intro > p:last-child { font-size: 7pt; }
      .ordo-pricing .op-onprem-prices { gap: 6px; }
      .ordo-pricing .op-total { padding: 7px; }
      .ordo-pricing .op-total strong { margin: 3px 0; font-size: 11pt; }
      .ordo-pricing .op-total span, .ordo-pricing .op-total small, .ordo-pricing dl div { font-size: 6.5pt; }
      .ordo-pricing dl div { padding: 2px 0; }
      .ordo-pricing .op-notes { grid-template-columns: 1fr 1fr; gap: 5px; margin-top: 5px; }
      .ordo-pricing .op-notes p { padding: 5px; font-size: 6.8pt; }
      .ordo-pricing .op-commercial { grid-template-columns: 1.3fr .7fr; gap: 7px; margin-top: 5px; padding-top: 5px; }
      .ordo-pricing .op-commercial p, .ordo-pricing .op-commercial strong { font-size: 6.5pt; }
    }
${CSS_END}`.replace(/[ \t]+$/gm, '');
}

function markerCount(source, marker) {
  return source.split(marker).length - 1;
}

function replaceOrInsert(source, start, end, generated, insertionPoint, label) {
  const starts = markerCount(source, start);
  const ends = markerCount(source, end);
  if (starts !== ends || starts > 1) fail(`${label}: markeri duplicați sau dezechilibrați.`);
  if (starts === 1) {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from);
    return `${source.slice(0, from)}${generated}${source.slice(to + end.length)}`;
  }
  const position = source.lastIndexOf(insertionPoint);
  if (position < 0) fail(`${label}: lipsește ${insertionPoint}, secțiunea nu poate fi injectată.`);
  return `${source.slice(0, position)}${generated}\n${source.slice(position)}`;
}

function expectedPage(source, key, catalog) {
  let output = replaceOrInsert(source, CSS_START, CSS_END, renderPricingCss(key), '</style>', `${PRODUCT_FILES[key]} CSS`);
  output = replaceOrInsert(output, HTML_START, HTML_END, renderPricing(catalog.products[key], catalog), '</main>', `${PRODUCT_FILES[key]} HTML`);
  return output;
}

async function readCatalog(root) {
  const filename = path.join(root, CATALOG_FILE);
  let source;
  try {
    source = await readFile(filename, 'utf8');
  } catch (error) {
    fail(`nu pot citi ${filename}: ${error instanceof Error ? error.message : String(error)}.`);
  }
  let catalog;
  try {
    catalog = JSON.parse(source);
  } catch (error) {
    fail(`${CATALOG_FILE} nu este JSON valid: ${error instanceof Error ? error.message : String(error)}.`);
  }
  return validateCatalog(catalog);
}

function normalizedRoot(root) {
  if (root instanceof URL) return fileURLToPath(root);
  if (typeof root !== 'string' || root.length === 0) fail('root trebuie să fie cale de proiect sau URL file:.');
  return path.resolve(root);
}

export async function validatePricingMarkup(root = PROJECT_ROOT) {
  const projectRoot = normalizedRoot(root);
  const catalog = await readCatalog(projectRoot);
  const checked = [];
  for (const [key, filename] of Object.entries(PRODUCT_FILES)) {
    const target = path.join(projectRoot, filename);
    const source = await readFile(target, 'utf8').catch((error) => fail(`nu pot citi ${target}: ${error.message}.`));
    if (markerCount(source, CSS_START) !== 1 || markerCount(source, CSS_END) !== 1 || markerCount(source, HTML_START) !== 1 || markerCount(source, HTML_END) !== 1) {
      fail(`${filename}: secțiunea de tarife lipsește sau are markeri invalizi. Rulează node scripts/pricing.mjs --write.`);
    }
    const expected = expectedPage(source, key, catalog);
    if (source !== expected) fail(`${filename}: tarifele sunt stale sau modificate manual. Rulează node scripts/pricing.mjs --write.`);
    checked.push(filename);
  }
  return { status: 'PASS', catalog: CATALOG_FILE, asOf: catalog.asOf, files: checked };
}

async function writePricingMarkup(root = PROJECT_ROOT) {
  const projectRoot = normalizedRoot(root);
  const catalog = await readCatalog(projectRoot);
  const written = [];
  for (const [key, filename] of Object.entries(PRODUCT_FILES)) {
    const target = path.join(projectRoot, filename);
    const source = await readFile(target, 'utf8').catch((error) => fail(`nu pot citi ${target}: ${error.message}.`));
    const expected = expectedPage(source, key, catalog);
    if (expected !== source) {
      await writeFile(target, expected, 'utf8');
      written.push(filename);
    }
  }
  return { status: 'WRITTEN', catalog: CATALOG_FILE, asOf: catalog.asOf, files: written };
}

async function runCli() {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.includes('--help') || argumentsList.includes('-h')) {
    console.log('Utilizare: node scripts/pricing.mjs [--check | --write]');
    return;
  }
  const allowed = new Set(['--check', '--write']);
  for (const argument of argumentsList) if (!allowed.has(argument)) fail(`argument necunoscut: ${argument}.`);
  if (argumentsList.includes('--check') && argumentsList.includes('--write')) fail('alege --check sau --write, nu ambele.');
  const result = argumentsList.includes('--write') ? await writePricingMarkup(PROJECT_ROOT) : await validatePricingMarkup(PROJECT_ROOT);
  console.log(JSON.stringify(result));
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
