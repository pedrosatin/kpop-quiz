# ADR-014: Score group relevance from Wikipedia pageviews

## Status

Accepted

## Date

2026-09-22

## Context

Factual complexity does not predict whether a player will recognize a group. Assisted mode needs familiar groups, while expert mode benefits from less familiar ones. The browser uses static quiz files and cannot consult audience services while a round is running.

Audience signals also have incompatible definitions and usage rules. Wikipedia pageviews, YouTube subscribers and channel views cannot be combined as if they measured the same behavior. The YouTube [Developer Policies](https://developers.google.com/youtube/terms/developer-policies) restrict retention of non-authorized API data, and the [policy guide](https://developers.google.com/youtube/terms/developer-policies-guide) limits derived metrics. Those rules make public YouTube API statistics unsuitable for this persistent composite score. Dated follower statements from Wikidata use CC0, but their observation dates vary too much for a fair catalog-wide comparison.

## Decision

The first relevance algorithm uses only English Wikipedia pageviews. No machine-learning model classifies or scores a group.

1. `group_relevance_cli` requests 365 completed UTC days from the Wikimedia Analytics Pageviews API. It uses the English article linked to each accepted group, `all-access`, and `user` traffic.
2. `group_relevance_score_cli` selects the newest complete run and converts total views into a tie-aware percentile from 0 through 10,000 within the accepted catalog.
3. The percentile is the relevance score. Equal view totals receive the same midpoint rank.

Assisted mode admits scores from 6,667 through 10,000. Expert mode admits scores from 0 through 3,333. Standard mode has no relevance filter. These boundaries are terciles of a relative score, not audience-count cuts. If the filtered pool has fewer than ten questions, session generation uses the unfiltered pool.

For questions associated with several groups, the highest score applies only when every referenced group has a score. Missing coverage does not become zero.

## Collection and provenance

The pageview window ends two days before `reference_date` to avoid depending on a day that may still be incomplete. The collector stores the requested title, dates, API URL, canonical response, SHA-256 digest, observed-day count, total views and run status. A response must match the requested project, access class, agent class, article, granularity and final day. Internal gaps invalidate the response. Missing days before the first returned row count as zero for a newly created article.

The scorer accepts a run only when that single run covers every accepted group linked to an English Wikipedia page. It never combines measurements from separate runs. A limited trial cannot change quiz sessions.

The score run stores the pageview run ID, algorithm version, raw total, percentile, final score and coverage counts. The existing YouTube columns remain null or zero. They are not inputs to this algorithm.

Wikimedia does not assign views of a redirect to its target article. The total measures traffic to the stored English title, not every alias a group may have. It also reflects English-language readership rather than worldwide familiarity. The raw response remains available for review, and a later algorithm must use a new version string.

## Evidence

On 2026-09-22, a trial requested 39 accepted groups. Thirty-eight articles returned data through 2026-09-20. Tuide had only 58 observed days because its article was newer. The sample was exploratory: 22 groups were spaced through the catalog by Wikidata ID, while 17 familiar or punctuation-heavy titles were added deliberately.

The trial produced a minimum of 1,705 views, a median of 88,259 and a maximum of 3,019,960. A 500,000 cut excluded EXO, Ive, Red Velvet, NCT and Itzy. A 100,000 cut placed STAYC and Oh My Girl in the expert pool. Seventeen was only 658 views above the proposed assisted cut. These boundary effects support catalog percentiles instead of absolute thresholds.

The Wikimedia endpoint and traffic classes are documented in the [Analytics API pageview reference](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/reference/page-views.html) and [pageview concepts](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/concepts/page-views.html).

## Alternatives considered

Live requests from the web app were rejected because they would make a round depend on network state and credentials.

Absolute audience-count cuts were rejected after the trial. The boundaries split familiar groups on small count differences and left a large middle band unused.

A composite with YouTube subscribers or channel views was rejected. The signals have different semantics, incomplete ownership mapping and usage restrictions. The diagnostic channel report remains separate from scoring.

Google search volume was rejected because the official [Google Trends API](https://developers.google.com/search/apis/trends) is an alpha program with limited access, not a generally available dependency for this project. Keyword Planner requires a Google Ads account.

## Consequences

A catalog change requires a new complete pageview run before a new score can affect sessions. Scores may move when the accepted catalog changes or when readership changes. The quiz dataset version records the score map used to create it. Version hashes for the other puzzle types remain based on their factual inputs and do not include this map.

The metric estimates recognition through English Wikipedia readership. It does not measure regional familiarity, streaming, downloads, YouTube audiences or Google searches.
