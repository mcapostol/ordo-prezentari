#!/usr/bin/env python3
"""Package artifacts from the current committed, accepted local build."""
from hashlib import sha256
import json
from pathlib import Path
import subprocess
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
OUT = ROOT / 'outputs'


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


if git('status', '--porcelain'):
    raise SystemExit('Packaging requires a clean committed source tree.')
manifest = json.loads((DIST / 'manifest.json').read_text())
report = json.loads((OUT / 'local-acceptance-report.json').read_text())
commit = git('rev-parse', 'HEAD')
if manifest['source_sha'] != commit or report['sourceCommit'] != commit:
    raise SystemExit('Build, acceptance and source revisions differ.')
if report['status'] != 'LOCAL_ACCEPTANCE_PASS' or any(c['status'] != 'PASS' for c in report['checks']):
    raise SystemExit('Acceptance contains a failed or unfinished check.')
products = {
    'salons': 'OrdoSalons', 'clubs': 'OrdoClubs',
    'rezidential': 'OrdoRezidential', 'administratii': 'OrdoAdministratii', 'farm': 'OrdoFarm',
}
if set(report['products']) != set(products):
    raise SystemExit('All five product presentations must be accepted before packaging.')
expected = {'index.html', *(key + '.html' for key in products)}
if set(manifest['files']) != expected:
    raise SystemExit('The manifest does not contain exactly the complete portfolio.')
entries = {}
for name, details in manifest['files'].items():
    payload = (DIST / name).read_bytes()
    if sha256(payload).hexdigest() != details['sha256'] or payload != (ROOT / name).read_bytes():
        raise SystemExit(f'Source/build checksum mismatch: {name}')
    entries[name] = payload
for key, brand in products.items():
    matches = [item for item in report['artifacts'] if item['type'] == 'pdf' and item['page'] == key + '.html']
    if len(matches) != 1 or not 3 <= matches[0]['pageCount'] <= (11 if key == 'farm' else 7):
        raise SystemExit(f'Accepted PDF missing or invalid: {brand}')
    payload = (OUT / (brand + '.pdf')).read_bytes()
    if sha256(payload).hexdigest() != matches[0].get('sha256') or len(payload) != matches[0].get('bytes'):
        raise SystemExit(f'PDF checksum does not match the accepted artifact: {brand}')
    if not payload.startswith(b'%PDF-'):
        raise SystemExit(f'Invalid PDF signature: {brand}')
    entries[brand + '.pdf'] = payload
entries['manifest.json'] = (DIST / 'manifest.json').read_bytes()
entries['Citeste-ma.txt'] = '''FAMILIA ORDO — POWERED BY CLARIFIED

Deschide index.html pentru întregul portofoliu sau fișierul HTML al unui produs.
Prezentările funcționează offline, în browser, pe desktop și pe telefon.
Fiecare produs are și o prezentare PDF pentru distribuire și tipărire.

OrdoSalons — saloane, frizerii și rețele de beauty.
OrdoClubs — săli de sport, studiouri și rețele de fitness.
OrdoRezidential — complexuri rezidențiale și operațiuni de facility management.
OrdoAdministratii — asociații de proprietari și administrații de bloc.
OrdoFarm — farmacii independente și lanțuri de farmacii.

Fiecare prezentare explică modulele propuse, portalul utilizatorului, administrarea
unei organizații sau rețele, controlul financiar, aprovizionarea și accesul pe roluri.
Sunt incluse ambele modele: SaaS și On-Premise, cu responsabilitățile și modelul
comercial aferent. Sunt incluse intervale de preț orientative; oferta finală confirmă configurația clientului.

Aceste materiale prezintă concepte de produs și interfețe cu date ilustrative.
Nu sunt aplicații operaționale și nu activează conturi, plăți sau integrări reale.
Nu au fost publicate în Azure. Integrările specifice se configurează și se validează
la implementare, împreună cu furnizorii și organizația clientului.
'''.encode()
zip_path = OUT / 'Ordo-portofoliu-prezentari.zip'
with ZipFile(zip_path, 'w', compression=ZIP_DEFLATED, compresslevel=9) as archive:
    for name, payload in entries.items():
        archive.writestr(name, payload)
with ZipFile(zip_path) as archive:
    if archive.testzip() is not None:
        raise SystemExit('ZIP integrity check failed.')
    if set(archive.namelist()) != set(entries):
        raise SystemExit('ZIP contents do not match the accepted portfolio.')
    for name, payload in entries.items():
        if archive.read(name) != payload:
            raise SystemExit(f'ZIP member mismatch: {name}')
print(json.dumps({'status': 'LOCAL_PACKAGE_COMPLETE', 'source_sha': commit,
                  'files': len(entries), 'zip': str(zip_path.relative_to(ROOT)),
                  'sha256': sha256(zip_path.read_bytes()).hexdigest(), 'publication': 'none'}))
