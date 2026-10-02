# Map full game, slice 1: coverage measurement and source-policy review

Date: 2026-10-02. Gate input for `.scratch/map-full-game` ticket 01
(TWICE / TREASURE fallback / kill the slice). "Verified" = observed in code
or a live check; everything else is marked estimate. Raw probe outputs lived
in `/tmp` (volatile); the numbers below are transcribed here.

Reference database: local `data/kpop.db` snapshot present on 2026-09-29
(gitignored, not part of any PR). Reference date for the live checks: 2026-10-02.

## 1. geo_coverage on the current DB

`python3 -m kpop_scraping.geo_coverage --database data/kpop.db`
(report `geo-coverage-v1`, read-only, no network):

- Scope: 552 accepted catalog groups, all 552 with a fact run,
  502 unique members of processed groups.
- `origin_country`: 440/552 subjects with an accepted fact (79.7%),
  440 accepted / 91 rejected / 2 conflict, 3 distinct country candidates.
- `born_in`: 1/502 subjects with an accepted fact (0.2%),
  1 accepted / 430 rejected / 15 conflict / 1 superseded,
  1 distinct place candidate: BM → Los Angeles (Q65).
  Rejected values are dominated by real places missing evidence
  (Seoul Q8684 ×242, South Korea Q884 ×71, Busan Q16520 ×57, ...).

## 2. P131→P17 resolvability probe (50-fact born_in sample)

Method: 50 most frequent distinct `born_in` place QIDs (1 accepted first,
then rejected/conflict by frequency), resolved with the repo's own
`WikidataEntityClient` (identifiable `User-Agent`, `maxlag=5`, 30 s timeout,
sequential requests, one `wbgetentities` batch of 50 with `props=info|claims`;
P17 read first, P131 followed up to 3 hops only when P17 is absent).

Result: 50/50 resolve to a country through direct P17, 0 need P131 hops,
0 missing. P131 plumbing is unnecessary in practice: the places already
carry P17.

Conclusion: geographic resolution is not the bottleneck for the birthplace
track; evidence is. With 1 accepted `born_in` fact against the track-b gate
(≥100 playable facts across ≥15 countries), the birthplace track stays
killed regardless of resolvability.

## 3. TWICE rendered-calendar measurement (browser)

Method: headless Chromium 152 with a stdlib CDP driver (no new dependencies):
`Page.navigate` to `https://twice.jype.com/schedule`, then 8 month-back
clicks on `bg-btn-prev.png` (alt "이전 달 스케줄 보기"), snapshotting body
text per month. Static fetch (73 KB, HTTP 200) and page-bundle inspection
as backup; one guessed RSC request returned HTTP 500 and was discarded
(no retry against undocumented endpoints).

Result: 9 monthly snapshots, October 2026 back to February 2026, every one
an empty day grid (~330–360 chars of body text: nav, month shell, T/ETC/E/A/R/S
legend, no entries). 0 stops, 0 distinct countries, per-stop
city+venue+date granularity unconfirmed. The `<THIS IS FOR>` tour ran
Jan–Jul 2026 and the site keeps no navigable archive of past stops.
The ~81 shows / ~15+ countries figures stay estimates.

`robots.txt` (`https://twice.jype.com/robots.txt`, HTTP 200) allows `/` but
explicitly disallows `/api/` and `/_next/` and publishes a sitemap. The
calendar data loads through those disallowed paths, so a scraper that talks
to them directly would run against the operator's stated crawl limits.

## 4. domain:jype.com source-policy review

- License/terms: no website ToS or anti-scraping clause found. Page footers
  (desktop, mobile, schedule) carry only
  "Copyright © JYP ENTERTAINMENT Co., Ltd. All rights reserved."
  No permission is granted anywhere either.
- Attribution: JYP ENTERTAINMENT Co., Ltd. as above.
- Limits: `robots.txt` `Disallow: /api/` + `Disallow: /_next/` (see §3);
  schedule content is JS-rendered and past months are not archived.
- Coverage: unconfirmed (see §3).
- Sign-off: still required from the maintainer. Copyrighted schedule text
  with "all rights reserved" and no grant cannot be self-approved by an agent;
  record this as pending, blocking any JYP scraping.

Per the repo rule, no new source is added by this change, so there is no new
source entry to document beyond this note.

## 5. Gate decision: kill the slice

- TWICE fails the gate: stop/country counts are unconfirmable in a browser
  (empty grids Feb–Oct 2026), granularity is unconfirmed, the tour is over
  with no archive, and the data paths the calendar uses are crawler-disallowed.
- TREASURE fallback fails the diversity bar: verified 20 dates / 8 cities /
  2 countries (KR, JP), both countries already inside the pilot's 14, so the
  combined pool would stay at ~14 distinct countries against the required
  ≥25 with no country above 30% of events. Same-day double shows (Hyogo 7/25,
  Tokyo 9/5) would also break the pipeline's date-as-key assumption.
- Birthplace track: independently below its gate (1 accepted fact vs ≥100
  across ≥15 countries).

Decision: kill slice 1 as specified. The pilot (31 events / 14 countries,
BLACKPINK DEADLINE) is untouched. Reopen condition: a static, ToS-clear
agenda for a multi-country tour that adds new countries to the pool, with
per-stop city+venue+date granularity verifiable without disallowed endpoints.
