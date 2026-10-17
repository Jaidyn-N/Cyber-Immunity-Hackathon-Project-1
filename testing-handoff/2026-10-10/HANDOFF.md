# Marketplace beta testing handoff

## Results

The 22 manual cases ended with **21 Pass, 1 Fail, 0 Blocked, 0 Not run**. Login, purchases, inventory, equipment, listings, player isolation and private-note checks passed. Player A tested seller self-obtain before Player B bought the listing.

**TC-04 failed.** Expected shop capacity: **5**. Observed capacity: **4**. The recorded error is "Handoff requires capacity 5; live API capacity is 4". The code sets `SHOP_CAPACITY = 4` in `lib/shop/rotation.ts`. Offer names, prices and rarities matched the API, the interface used to exchange app data.

## Environment

Tests ran on 9 and 10 October 2026 in Australia/Sydney. Windows and Docker Desktop hosted the app at http://localhost:3000 and TideCloak 0.14.20-DEV at http://localhost:8083. The realm was `login-app-with-tidecloak`. Node was 24.21.0; npm was 11.19.0. Playwright 1.62.1 used separate browser sessions for non-admin Player A and Player B. The user completed private sign-ins.

## Separate automated checks

The saved security suite passed **119/119**, with exit code 0, using a temporary Docker database. Type checking and the production build also passed with exit code 0. These checks are separate from the 22 manual cases.

The saved dependency audit found three affected packages: **next 16.3.1** (Critical), **sharp 0.35.3** (High) and **source-map-js 1.2.1** (High). Severity describes the reported risk level. The 12 advisory rows are in [dependency-audit-findings.csv](dependency-audit-findings.csv). These findings remain open. No exploit was attempted or dependency updated. This is a saved audit, not a new advisory check.

## Known limitations

- Marketplace obtain changes ownership in the app database. It does not create a Tide-backed transfer or a signed Tide ownership proof.
- Admin role grants and governed approvals were outside this test run. The plan records earlier project-owner checks. The documented approval threshold is 1; two-person approval was not shown.
- The plan says earlier ownership proofs are not revoked when a later owner is bound. That research flow was not tested again here.
- Decryption can be denied if `_tide_dob.selfdecrypt` is missing. A held both `_tide_dob.selfencrypt` and `_tide_dob.selfdecrypt`, so this run passed encryption and decryption.
- Only one item can be equipped at a time. Load testing and exploitation of audit findings were outside this run.

## Evidence and checks

- [Word report](Marketplace-Beta-Standalone-Testing-Report.docx): full results and review points. No team report template was found; this report is clearly labelled standalone.
- [manual-results.csv](manual-results.csv): all 22 cases and their evidence paths.
- [evidence-index.csv](evidence-index.csv): a short guide from test ID to evidence.
- [automated-results.csv](automated-results.csv): the 119 security assertions.
- [evidence/](evidence/): screenshots, recorded live checks and saved command output.
- [MANIFEST.csv](MANIFEST.csv): file sizes, SHA256 hashes and original sources. A hash is a file fingerprint. Original source paths refer to records kept locally.

Every case has supporting evidence. Word, tables and evidence links agree. All five Word pages were rendered in Microsoft Word and checked. The 15 unique screenshots were reviewed; identity fields are masked where needed. The private note is dummy test text. Text and Word contents were checked for saved private values, tokens, private keys and enrolment links. No private configuration, browser sign-in storage, database, installed package or build output is included.

Four duplicate screenshots were replaced with shared copies. Their recorded facts and results did not change. TC-03 uses a saved observation because the raw Account screenshot contained identity values. TC-14 and TC-17 have recorded checks without screenshots. Final state screenshots support the transfer checks; they do not show the transaction itself.

## Team review

Decide whether capacity should be 5 or the plan should specify 4. Keep TC-04 failed until the difference is resolved and tested again. Review the dependency advisories and assign owners for fixes or risk decisions. Review the known limitations before deployment. This handoff has one open failure and is not approval for production release.

GitHub review uses these expanded files only. The earlier ZIP and original setup records remain local. No application code was changed.
