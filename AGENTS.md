# Ordo product presentations

- User selected OrdoSalons, OrdoClubs, OrdoRezidential, OrdoAdministratii and OrdoFarm.
- On 2026-10-27 the user additionally requested urgent GitHub publication of the OrdoClinics presentation and an isolated interactive demo, independent of suspended Azure services. Publish those under clinics/; demo data is fictitious and browser-local.
- Scope is concept presentations with indicative commercial offers, not production applications.
- The user explicitly authorized public publication on their GitHub account on 2026-10-25.
- Publish these presentation materials and the explicitly requested browser-local OrdoClinics demo through GitHub Pages; do not modify Azure, Stripe, the operational OrdoClinics application or existing client data.
- Keep each HTML presentation standalone and usable offline; no external asset requests or live application integrations.
- Proposed modules, illustrative data and price ranges must be identified accurately. Do not publish internal costs or margin assumptions.
- commercial-offers.json is the canonical price source; scripts/pricing.mjs renders and validates the inline pricing sections.
- Commit clean source before building. Deploy the identified commit and verify the exact public HTML hashes and browser behavior.
