# K-pop Quiz

Daily K-pop quiz and puzzle games about groups and artists, in Portuguese and English. Play at <https://kpopquiz.online>.

The site has five games: a ten-question quiz with assisted, standard, and expert modes, a grid, connections, name guess, and word search. New puzzles are published every day.

Every answer comes from Wikipedia and Wikidata. A Python collector queries both APIs, records the consulted revisions in SQLite, and keeps page and entity responses as compressed JSON. Each accepted fact points to a Wikidata reference or a Wikipedia revision excerpt, and the games only use accepted facts.

The collector covers page discovery, summaries, candidate classification, and Wikidata fact extraction for accepted groups and members. It also keeps an auditable catalog of music release candidates. The catalog rejects lists, disambiguation pages, redirects, and QIDs without an accepted music type.

The map-game pilot at `/pt-br/mapa/` and `/en/map/` asks in which country the official schedule listed each date of BLACKPINK's DEADLINE WORLD TOUR. `python -m kpop_scraping.map_pilot_refresh` rebuilds `data/map-pilot/deadline-events.json`. An event enters it only when the YG schedule lists the date and city, MusicBrainz records the concert at one venue, and the venue area's current Wikidata country (P17) matches the MusicBrainz area hierarchy. The country then maps to a Natural Earth feature by Wikidata QID. A workflow runs the refresh on the first day of each month. The routes appear in the game menu and in the sitemap. [ADR-015](docs/decisions/015-contrato-de-dados-do-jogo-de-mapas.md) and [the pilot notes](docs/map-game-pilot.md) record the sources and checks.

## Requirements

- Python 3.11 or newer
- Node.js 22 or newer for the web interface
- Internet access to run the collector

The collector uses only the Python standard library.

## Quick start

```bash
python3 -m venv .venv
source .venv/bin/activate
python main.py --limit 10
```

This creates `data/kpop.db`, writes snapshots to `data/raw`, and exports `data/catalog-report.csv`. Drop `--limit 10` to walk through the whole category.

The snapshot directory can live outside the database folder:

```bash
python main.py --limit 10 --database /tmp/kpop.db --raw-dir /tmp/kpop-raw
```

Use a custom identifier for recurring runs:

```bash
python main.py --user-agent "kpop-quiz/0.1 (https://your-site.example/contact)"
```

## Commands

```bash
python main.py --help
python main.py --limit 3 --database /tmp/kpop-quiz.db
python main.py --limit 3 --catalog-report /tmp/kpop-catalog.csv
python main.py --limit 45 --database /tmp/kpop.db --facts-limit 30 --facts-report /tmp/kpop-facts.csv
python main.py --limit 45 --database /tmp/kpop.db --releases --release-group-limit 10 --release-report /tmp/kpop-releases.csv
python main.py --limit 60 --database /tmp/kpop.db --releases --release-group-limit 25 --release-group-offset 25
python -m kpop_scraping.group_relevance_cli --database /tmp/kpop.db --reference-date 2026-09-21 --user-agent "kpop-quiz/0.1 (https://your-site.example/contact)"
python -m kpop_scraping.group_relevance_score_cli --database /tmp/kpop.db
python -m kpop_scraping.quiz_cli --database /tmp/kpop.db --output /tmp/questions.json --report /tmp/quiz-report.json --session-output /tmp/session.json --seed round-1 --timer-seconds 20
python -m kpop_scraping.web_publish --database /tmp/kpop.db --output-dir web/public/data --seed web-launch-v1 --timer-seconds 20
python -m kpop_scraping.web_publish --output-dir web/public/data --verify
python -m unittest discover -v
python -m compileall -q .
```

## Web interface

The static interface uses Astro and Preact. The production build produces the `/pt-br/` and `/en/` routes at the site root. Opening `/` renders the Portuguese quiz directly and uses `/pt-br/` as its canonical URL. The site is published on Cloudflare Pages at <https://kpopquiz.online> (with `kpopquiz.pages.dev` as the platform URL). A push to the `dev` branch deploys a staging build to GitHub Pages at <https://pedrosatin.github.io/kpop-quiz/>. The staging workflow sets `ASTRO_SITE` and `ASTRO_BASE`, so page and asset URLs start with `/kpop-quiz/`. The browser validates the manifest, the SHA-256, and the session contract before starting the quiz.

```bash
cd web
npm ci
npm test
npm run build
ASTRO_SITE=https://pedrosatin.github.io ASTRO_BASE=/kpop-quiz npm run build  # staging build under /kpop-quiz/
```

Styles live in `web/src/styles/`. `global.css` only imports the other files, in this order:

| File | Contents |
| --- | --- |
| `tokens.css` | Colors, spacing, radii, shadows, fonts and sizes, including `--play-max-h`, the tallest a board may grow so the question, the board and the answered action bar fit one viewport. It subtracts the consent banner, the chrome above the board and the bar's height after an answer, with separate values for phones. Each color is declared once with `light-dark()`, and the theme selector sets `color-scheme` through `data-theme`. |
| `base.css` | Fonts, reset, header, game navigation, page layout (one `.page-shell` width for every game; each game card sets its own max-width), footer, privacy page and consent banner. |
| `components.css` | Shared building blocks: buttons, game card, the sticky action bar (`.game-actions`, whose live region is `.game-actions-message` with `role="status"`, mounted with the instructions before the first answer, so the button and links are not announced), HUD, choices, alerts, badges, modal, loading state, results, share box and review list. |
| `stats.css` | Player statistics modal. |
| `games/*.css` | Only what is unique to each game, such as its board, tiles or keyboard. |

New UI should reuse the building blocks in `components.css` before adding game-specific rules. Shared Preact hooks live in `web/src/lib/`: `useFocusOnChange` moves focus to the action a player unlocks, or to the result title when a round ends, without scrolling. The quiz setup and its questions use the same 42rem card, and Start, Submit and Next sit in `.game-actions`. After an answer the bar shows the verdict with the player's answer and the correct one; a "Ver fonte" toggle next to Next opens the explanation and the revision links inside the bar. `light-dark()` needs Chrome 123, Safari 17.5 or Firefox 120 or newer. `tokens.test.ts` reads `tokens.css` and checks WCAG AA contrast for every text and background pair in both themes.

`web_publish` generates ten-question sessions in Portuguese and English for the assisted, standard, and expert modes. The files land in `web/public/data`. Each filename includes its SHA-256, and the publisher swaps `manifest-v2.json` only after validating and writing all six sessions. `manifest.json` and the v1 sessions stay published during the transition. The deploy workflow verifies the v2 artifacts before the build.

## Privacy, analytics, and indexing

Production pages include the Cloudflare Web Analytics beacon only when the `PUBLIC_CF_BEACON_TOKEN` build secret is set; the staging build never includes it. What is collected: page URL, referrer, and coarse device/geo aggregates in the Cloudflare dashboard. What is not collected: no cookies, no personal data, no cross-site tracking.

Google Analytics 4 loads only after explicit opt-in through the consent banner, which appears solely in production builds with the `PUBLIC_GA4_ID` build secret set. Accepting stores `accepted` in localStorage (`kpop-quiz-consent`) and loads `gtag`; rejecting stores `rejected` and nothing from Google loads. The "Preferências de medição" button remains available after either choice. It reopens the banner, and choosing "Só essencial" disables future GA4 measurement in the current visit and later visits. The dual setup is recorded in [ADR 017](docs/decisions/017-web-analytics.md). Until each secret is configured, production builds ship without that beacon by design.

For search and LLM indexing, production serves `sitemap.xml` (twelve canonical routes, both languages), an environment-aware `robots.txt` (staging answers `Disallow: /`), canonical URLs with `hreflang` (`pt-BR`/`en`/`x-default`), per-route titles and descriptions, Open Graph tags, and `llms.txt` with Markdown versions of each route under `web/public/llms/`. JSON data files under `/data/` are excluded from the sitemap and carry `X-Robots-Tag: noindex`. The strategy is recorded in [ADR 018](docs/decisions/018-seo-llm-indexing.md). Search Console verification and sitemap submission remain operator steps.

The daily cycle is automated by the unified runner and the `daily-puzzles-cron.yml` workflow. The cron job rebuilds the database from Wikipedia and Wikidata with incremental caching, generates the six daily games (`grid.daily.json`, `connections.daily.json`, `name-guess.daily.json`, `word-search.daily.json`, `timeline.daily.json`, and the daily sessions for both languages), validates each artifact against its matching schema in a temporary directory, and publishes by atomic swap only when every check passes. If the rebuild fails 3 times, 10 minutes apart (usually because Wikidata answers `maxlag`), the workflow restores the cached database and publishes the day's puzzles from it. If the grid generator cannot fill a 3x3, the runner keeps the previous grid and the workflow shows a warning in the run summary. The workflow runs at 15:00 UTC with `--ahead`, which also publishes the next day's set under `web/public/data/next/`. After midnight in Sao Paulo, the web loaders read `next/` when the main artifact is from an earlier day, so a late run does not leave the site on yesterday's puzzles. The next run promotes `next/` without generating it again, and a day that is already published is kept unless `--regenerate` is passed, so every player gets the same puzzle for a date. Each game's seed is derived from the date (`kpop-{game}-daily-{YYYY-MM-DD}`), so the same date and database produce identical bytes. In the word search, each word's clue cites one audited fact that sets it apart from the other theme words (birth year, formation year, record label, or another group), and its evidence is published with the word; words without such a fact have no clue. The rule is in [ADR 011](docs/decisions/011-mecanica-caca-palavras.md). The same flow runs locally with `python -m kpop_scraping.daily_puzzles_cli --database data/kpop.db --output-dir web/public/data`, with standalone verification via `--verify`.

A new run updates each page by the combination of provider, language, and `pageid`. `collection_runs` records success or failure. `source_pages` holds the latest state, `source_revisions` points to each snapshot and its SHA-256, and `collection_run_revisions` records which revisions each run used. `catalog_entries` holds one decision per page. A new revision, or a change to the metadata the classifier uses, returns the page to the `candidate` state.

The facts stage runs with `--facts`, `--facts-limit`, or `--facts-report`. It records entities, aliases, facts, and evidence. The coverage CSV shows, by group and predicate, how many facts were accepted, rejected, replaced, or left in conflict. Without `--facts-report`, the file `facts-coverage.csv` lands beside the database. Re-running the stage updates each fact by its Wikidata statement ID.

`--releases` uses the WDQS only to discover candidates; the query and its response are kept as snapshots with SHA-256. Each QID is then fetched again through `wbgetentities`, and class, artist, date, and genre are confirmed against that direct snapshot. The pipeline queries the `enwiki`, `ptwiki`, and `kowiki` sitelinks, resolves the title through each wiki's API, and records the revision of that entry. `performed_by` and `released_on` only enter the accepted set when an approved Wikidata reference or that revision's text confirms the relationship. Missing pages, lists, disambiguation pages, and pages linked to a different QID are recorded in `release_source_pages`. The default limit is 25 groups per query and 100 candidates per group.

`python -m kpop_scraping.quiz_cli` reads the database without running collection. It writes a bilingual dataset and a report as canonical JSON. `--session-output` also writes a ten-question session. The `--session-language`, `--theme`, `--group`, and `--play-mode` filters can be combined. `--timer-seconds` records the limit in the session configuration.

To enable relevance filtering, run the two relevance commands before generating the quiz dataset. `group_relevance_cli` caches 365 completed UTC days of English Wikipedia pageviews for each accepted group linked to an English article. `group_relevance_score_cli` converts one complete collection into catalog percentiles and stores the score, coverage, and algorithm version. Without a complete score run, dataset generation keeps the previous unfiltered behavior. Limited trials cannot affect sessions because the scorer requires one run that covers the full eligible catalog. [ADR-014](docs/decisions/014-pageview-relevance.md) defines the calculation and its source limitations. The separate [group signal report](docs/group-signals.md) is diagnostic and does not enter the score.

`schemas/quiz-dataset-v2.json` and `schemas/quiz-session-v2.json` describe the public contracts. `challenge_rating` records the original factual complexity; `play_mode` selects the assisted, standard, or expert mode. Decade hints point to accepted facts and their evidence. The same input, version, mode, and seed produce identical bytes. The v1 contracts stay versioned for older consumers.

The collector applies pending migrations when it opens the database. Each migration runs inside a transaction. Databases created by an earlier version keep their runs and pages through the migration.

## Structure

```text
kpop_scraping/   client, pipeline, CLI, and persistence
schemas/         JSON contracts for datasets and sessions
tests/           unit tests and fixtures
web/             static interface and published sessions
```

## License

MIT, see [LICENSE](LICENSE).

## Licensing and provenance

Only use sources whose license, attribution, and usage limits have been reviewed. Every publishable data point must keep the source and evidence that back the claim. Raw files, SQLite databases, and local CSVs are not tracked in Git.

The optional [group signal report](docs/group-signals.md) records Wikidata channel identifiers and dated follower statements with revision and statement locators. Live YouTube statistics are limited to local inspection and are not used in quiz scoring.
