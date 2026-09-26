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
| `base.css` | Fonts, reset, header, game navigation, page layout, footer, privacy page and consent banner. Every game page uses one `.page-shell` width, and each game card sets its own max-width (42rem, or 64rem with `.game-card--wide`). `GameIntro` sits above the card, left-aligned at the card's width (its `wide` prop matches the 64rem cards of the map and the word search): the kicker, a title of at most 2rem on one line where it fits and one sentence, with "Como jogar" / "How to play" at the right of the kicker row and its steps opening under the sentence. At 1440x900 the card starts 122px below the top of `main`. |
| `components.css` | Shared building blocks: buttons, game card, the sticky action bar (`.game-actions`, whose live region is `.game-actions-message` with `role="status"`, mounted with the instructions before the first answer, so the button and links are not announced), HUD, choices, alerts, badges, modal, loading state, results, share box and review list. |
| `stats.css` | Player statistics modal. |
| `games/*.css` | Only what is unique to each game, such as its board, tiles or keyboard. |

New UI should reuse the building blocks in `components.css` before adding game-specific rules. Shared Preact hooks live in `web/src/lib/`: `useFocusOnChange` moves focus to the action a player unlocks, or to the result title when a round ends, without scrolling. `light-dark()` needs Chrome 123, Safari 17.5 or Firefox 120 or newer. `tokens.test.ts` reads `tokens.css` and checks WCAG AA contrast for every text and background pair in both themes.

The quiz setup and its questions use the same 42rem card, and Start, Submit and Next sit in `.game-actions`. After an answer the bar shows the verdict with the player's answer and the correct one, cut at two lines on screen while the live region reads the whole text. A "Ver fonte" / "Show source" toggle (labelled "Ocultar fonte" / "Hide source" while open) sits before Next and opens the answers, the explanation and the revision links inside the bar, so Tab moves from the toggle to the links and then to Next. Next ignores clicks for 300 ms after it replaces Submit and ignores a held Enter, so a double click or a long press on Submit does not skip the verdict.

In the name guess game the on-screen keyboard is the `.game-actions` bar. The board's tiles shrink with the viewport height (down to 1.75rem) so the whole keyboard, ENTER and DEL included, fits under the board at 390x844 and 1440x900. A rejected guess is announced from the bar's live region, which is visually hidden, and shown over the HUD just above the first row, so it never covers the row being typed and never moves the board. When the game ends the result replaces the keyboard in the bar: the verdict, the answer, Share, Play again and a "Ver fonte" / "Show source" toggle (labelled "Ocultar fonte" / "Hide source" while open). The toggle appears when the target has clues or a source, and the panel shows the description, the stats and the Wikidata link, with long content scrolling inside it. While the panel is open the bar stops being sticky and stays below the final board instead of covering it. Focus moves to the result title only when the game ends during the visit, not when a finished game is restored, and Play again moves focus to the empty board. The result buttons ignore clicks for 300 ms and a held Enter, so a double tap on ENTER does not share or restart. Share opens the system share sheet where there is one (closing it is not an error) and otherwise copies `K-pop Guess <date>`, the score and one row of squares per guess; the visually hidden live region announces "Resultado copiado." / "Result copied." on every copy. If neither works, the live region says so, the text shows in a read-only field that selects all of it on focus or click, and the bar stops being sticky so the field opens below the board. The HUD keeps the guesses counter after the end, and the high-contrast toggle sits below the card; its setting is still saved with the day's game in `localStorage`.

In connections, Shuffle, Clear selection and Submit sit in the `.game-actions` bar, on one row at 390px with Submit on the right. The board keeps four columns at every width, and its rows shrink with the viewport height (down to the 44px touch target) so the 16 names and the bar fit at 390x844 and 1440x900. Each name takes the largest font size between 15px and 11px at which every word fits its tile. If none fits, the name may break after ":", "-", "." or "/" ("DAILY:" over "DIRECTION"), and a word still too wide at 11px breaks inside. The verdict of each guess (one away, wrong, already tried, category found with its explanation) shows in the bar's two-line message, which is the live region, so a guess never moves the board. A solved category's banner takes the height of the row of tiles it replaces, and focus moves to the first tile left; Clear also moves focus to the first tile, because Clear is disabled once nothing is selected. Submit ignores a second click within 300 ms and a held Enter. When the game ends the result replaces the controls in the bar: the verdict, Share, Play again, the no-color share option and a "Ver fonte" / "Show source" toggle that opens each category's explanation and one revision link per item. Share opens the system share sheet where there is one (closing it is not an error) and otherwise copies the text; if neither works, the live region says so and the text shows in a read-only field to copy by hand. The banners get shorter at the end so all four stay above the result. Focus moves to the result title only when the game ends during the visit; a finished game restored from `localStorage` shows the result without moving focus, and Play again moves focus to the new board.

In the word search the `.game-actions` bar holds a two-line message, the progress ("2 de 6" / "2 of 6") and the timer. The message is the live region and always keeps two lines, so the grid never moves: the letters being selected, "Início: S." / "Start: S." after the first tap, then the verdict of the selection ("Achou: Eunhyuk." / "Found: Eunhyuk.", a name already found, or "SH não é um dos nomes." / "SH is not one of the names." for any selection of two letters or more). The grid shrinks with the viewport height so the grid, the word chips and the bar fit at 390x844, 768x1024 and 1440x900. Up to 52rem the chips sit under the grid next to "Mostrar palavras" / "Show words"; from 52rem they sit beside the grid with the theme. When the last name is found the result replaces the progress in the bar: the title (described by the "6 palavras em 02:05." / "6 words in 02:05." summary), Share and a "Ver fonte" / "Show source" toggle (labelled "Ocultar fonte" / "Hide source" while open). The panel lists, for each name, its clue, its Wikidata item and one line per cited revision and location in the source ("Local na fonte" / "Location in source"); while it is open the bar stops being sticky and stays below the solved grid. Share opens the system share sheet where there is one and otherwise copies the text; if neither works, the live region says so and the text shows in a read-only field to copy by hand. Focus moves to the result title only when the puzzle ends during the visit. The result and source modals are gone. Two exceptions to the screen rules have their measurements in `word-search.css`. Cells stay below the 44px touch target (about 25px at 390px wide), because 12 columns of 44px do not fit a phone and letters cannot sit 8px apart without breaking up the words; two taps work as well as a drag, and the bar spells out the selected letters. On phones the chips form one row that scrolls sideways, with faded ends where chips are hidden and keyboard focus when it scrolls, and at the end the grid gives up about 2px per cell to keep that row above the taller result bar.

In the grid the `.game-actions` bar sits under the board and holds a two-line message next to the counters ("9 palpites restantes" / "9 guesses left" and "0 de 9 casas certas" / "0 of 9 squares correct"). The message is the live region: the instructions at first, then the verdict of the last guess with the group's name ("Certa: TWICE." / "Correct: TWICE.", "Errada: SHINee." / "Wrong: SHINee."), followed by the counters for screen readers. The board never moves, and the headers, the nine cells and the bar fit at 390x844 and 1440x900. The group picker is a modal dialog: Tab stays inside it, Escape and Close return focus to the cell that opened it, and on phones it follows the visual viewport so the search field and about five groups stay above the keyboard. After a guess focus goes to the same cell when it is still open, or to the next empty cell after a right guess. A solved cell stays focusable with `aria-disabled`, so the arrow keys still walk through it, and for 300ms after a guess the board ignores taps and clicks, so a double tap on a group does not open the cell under it; Enter and Space still open the focused cell, and a held key does not. The grid is now saved per grid in `localStorage` under `kpop-grid-<grid_id>` after each guess and restored on reload. The save keeps the QIDs of the right groups and of the last wrong group per cell, so the names follow the page's language; an untouched board is not saved, and a save that names a group outside the pool or one the cell does not accept is dropped. When the game ends the result replaces the counters in the bar: the title (described by the "8 de 9 casas certas com 9 palpites" / "8 of 9 squares correct in 9 guesses" summary, which starts with the verdict of the last guess when the game ends during the visit), Share, Play again and a "Ver fonte" / "Show source" toggle (labelled "Ocultar fonte" / "Hide source" while open), with the high-contrast option under them. At the end the icon moves beside the name, names keep two lines and the rows get shorter (3.5rem on wider screens); on phones the category tags and the check marks of right cells hide and the rows shrink toward the 44px touch target, so the finished board stays above the taller bar. A wrong cell keeps its cross and strike-through. The panel lists, for each cell, the player's answer, the accepted groups and one line per group and cited revision with every location in the source ("Local na fonte" / "Location in source") in words, such as "caracteres 140 a 148 do resumo" / "extract characters 140–148", with the raw locator in the tooltip; while it is open the bar stops being sticky. Share opens the system share sheet where there is one and otherwise copies the text; if neither works, the live region says so and the text shows in a read-only field to copy by hand. The result buttons, "Ver fonte" included, ignore activation for 300ms and held keys. Focus moves to the result title only when the game ends during the visit; a finished game restored from storage does not take focus, and it is counted in the statistics once, on the first load that finds it uncounted.

In the map quiz the question sits over the map, and the `.game-actions` bar holds the verdict and Next. From 60rem wide the round's 14 countries sit beside the map in two columns of 44px buttons, sorted by name in the page's language; at 1440x900 the map keeps 644 of the 760px it had alone, and the list ends above the bar. Below 60rem the list did not fit above the bar, so the same countries are a select in the bar with a "Responder" / "Answer" button, and Next takes that button's place after the answer. Answer stays in the Tab order with `aria-disabled` until a country is picked; pressed before that, the live region says "Escolha um país primeiro." / "Pick a country first.". The map stays the main way to answer, and Tab reaches its highlighted countries. After an answer the bar's live region shows the verdict, "Sua resposta" / "Your answer" when it is wrong, the correct country and the links to the YG schedule and MusicBrainz. At 420px and below the schedule notice beside the links is visually hidden but stays in the live region for screen readers. Next gets focus and ignores activation for 300ms and a held Enter, so a double tap on a country or on Answer does not skip the verdict. The round date is the date in São Paulo (America/Sao_Paulo), the same one the daily games use to turn the day, so the round and its save change at midnight there. Progress is saved per round date in `localStorage` under `kpop-map-<YYYY-MM-DD>` as `{ events, answers, index }`: the MusicBrainz event MBIDs of the round, the map feature picked for each answered date and the date on screen. A save for other events (after a data refresh), with a feature outside the round's countries or with counts that play cannot reach is dropped, an untouched round is not saved, and loading the game removes the saves of other dates. A reload resumes the date on screen, answered or not, or the result, without moving focus. When the round ends the map shows the round's countries and the result replaces Next in the bar: the title (described by the "7 de 10 certas." / "7 of 10 right." summary), Share, "Jogar novamente" / "Play again" and a "Ver fonte" / "Show source" toggle (labelled "Ocultar fonte" / "Hide source" while open). The panel lists each date with the correct country, the player's answer, the YG schedule link with the location in the source ("Local na fonte: GOYANG, GOYANG STADIUM", the raw locator in the tooltip), the MusicBrainz event, the Wikidata QID and revision that gave the country of the venue's area (a link to that revision) and the date checked; while it is open the bar stops being sticky. Share opens the system share sheet where there is one and otherwise copies `K-pop Map <date>`, the score and one square per date (🟩 right, ⬛ wrong, as in Adivinhe); if neither works, the live region says so and the text shows in a read-only field to copy by hand. The result buttons ignore activation for 300ms and held keys. Focus moves to the result title only when the round ends during the visit, and Play again, like in Adivinhe and Conexões, clears the save and replays the same dates of the day, moving focus to the first question. The map does not record rounds in the player statistics.

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
