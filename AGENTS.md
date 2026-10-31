# Ordo product presentations

- User selected OrdoSalons, OrdoClubs, OrdoRezidential, OrdoAdministratii and OrdoFarm.
- On 2026-10-31 the user withdrew the old OrdoClinics presentation and demo under clinics/. Those routes are retired and must not be republished. The other five product presentations remain published.
- Scope is concept presentations with indicative commercial offers, not production applications.
- The user explicitly authorized public publication on their GitHub account on 2026-10-25.
- Publish the five product presentation materials through GitHub Pages; do not modify Azure, Stripe, the operational OrdoClinics application or existing client data.
- Keep each HTML presentation standalone and usable offline; no external asset requests or live application integrations.
- Proposed modules, illustrative data and price ranges must be identified accurately. Do not publish internal costs or margin assumptions.
- commercial-offers.json is the canonical price source; scripts/pricing.mjs renders and validates the inline pricing sections.
- Commit clean source before building. Deploy the identified commit and verify the exact public HTML hashes and browser behavior.
