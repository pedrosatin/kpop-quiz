import type { GridCellData, IntersectionGrid, Locale } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";
import { cellKey, type GridCellState } from "./types";

export interface GridReviewProps {
  grid: IntersectionGrid;
  cellStates: Record<string, GridCellState>;
  locale: Locale;
  messages: Messages;
}

interface SourceLine {
  key: string;
  project: "Wikidata" | "Wikipedia";
  revision: number;
  url: string;
  locators: string[];
}

interface GroupSources {
  qid: string;
  /** Null when the fact id does not name a group of the pool. */
  name: string | null;
  lines: SourceLine[];
}

/**
 * Evidence of one cell by group: one line per cited revision, with every
 * place in it that backs the group. The fact id starts with the group's
 * QID. The player's group comes first.
 */
export function cellSources(
  grid: IntersectionGrid,
  cell: GridCellData,
  locale: Locale,
  firstQid?: string,
): GroupSources[] {
  const groups = new Map<string, GroupSources>();
  for (const evidence of cell.evidence) {
    const qid = evidence.fact_base_id.split("$")[0]!;
    let group = groups.get(qid);
    if (!group) {
      const candidate = grid.candidate_pool.find((c) => c.id === qid);
      group = { qid, name: candidate ? candidate.names[locale] || candidate.canonical_name : null, lines: [] };
      groups.set(qid, group);
    }
    const key = `${evidence.source_url}\u0000${evidence.revision_id}`;
    let line = group.lines.find((l) => l.key === key);
    if (!line) {
      let project: SourceLine["project"] = "Wikipedia";
      try {
        if (new URL(evidence.source_url).hostname === "www.wikidata.org") project = "Wikidata";
      } catch {}
      line = { key, project, revision: evidence.revision_id, url: evidence.source_url, locators: [] };
      group.lines.push(line);
    }
    if (!line.locators.includes(evidence.locator)) line.locators.push(evidence.locator);
  }
  const list = [...groups.values()];
  const first = list.findIndex((g) => g.qid === firstQid);
  if (first > 0) list.unshift(...list.splice(first, 1));
  return list;
}

/**
 * A place in a source as a reader would say it. The raw locator stays in
 * the title: `…#extract[140:148]` is a span of the page summary, and
 * `claims/P264/…/references/…` a Wikidata statement with its reference.
 * Anything else shows what follows `#`, or the locator itself.
 */
export function readableLocator(locator: string, messages: Messages): string {
  const hash = locator.lastIndexOf("#");
  const place = hash >= 0 ? locator.slice(hash + 1) : locator;
  const extract = /^extract\[(\d+):(\d+)\]$/.exec(place);
  if (extract) return messages.gridLocatorExtract(Number(extract[1]), Number(extract[2]));
  const claim = /^claims\/(P\d+)(?:\/|$)/.exec(place);
  if (claim) return messages.gridLocatorClaim(claim[1]!);
  return place || locator;
}

export function GridReview({ grid, cellStates, locale, messages }: GridReviewProps) {
  const candidateMap = new Map(grid.candidate_pool.map((c) => [c.id, c]));

  return (
    <section class="review-section grid-review" aria-labelledby="grid-review-heading">
      <h3 id="grid-review-heading" class="review-section-title">
        {messages.gridReviewTitle}
      </h3>
      <ol class="review-list">
        {grid.cells.map((cell) => {
          const { row_index, col_index, valid_entity_ids } = cell;
          const key = cellKey(row_index, col_index);
          const state = cellStates[key] || { solved: false, failed: false };
          const rowCrit = grid.row_criteria[row_index]!;
          const colCrit = grid.col_criteria[col_index]!;
          const sources = cellSources(grid, cell, locale, state.solved ? state.entityId : undefined);
          const lineCount = sources.reduce((n, g) => n + g.lines.length, 0);

          const acceptedNames = valid_entity_ids
            .map((qid) => {
              const cand = candidateMap.get(qid);
              return cand ? cand.names[locale] || cand.canonical_name : qid;
            })
            .join(", ");

          let badge = messages.gridReviewEmpty;
          let badgeClass = "badge";
          if (state.solved) {
            badge = messages.gridReviewCorrect;
            badgeClass = "badge badge-success";
          } else if (state.failed) {
            badge = messages.gridReviewWrong;
            badgeClass = "badge badge-failure";
          }

          return (
            <li key={key} class={`review-item ${state.solved ? "is-correct" : "is-wrong"}`}>
              <div class="review-item-header">
                <span class={badgeClass}>{badge}</span>
                <span class="text-muted">{messages.gridReviewCellHeader(row_index, col_index)}</span>
              </div>
              <h4 class="review-item-title">
                {rowCrit.label[locale]} × {colCrit.label[locale]}
              </h4>

              <p>
                <span class="review-label">{messages.yourAnswer}: </span>
                {state.solved && state.entityName ? (
                  <strong class="text-success">{state.entityName}</strong>
                ) : state.failed && state.lastAttempt ? (
                  <strong class="text-error">{state.lastAttempt}</strong>
                ) : (
                  <span class="text-muted">{messages.noAnswer}</span>
                )}
              </p>

              <p>
                <span class="review-label">{messages.gridAcceptedAnswers} </span>
                <span>{acceptedNames}</span>
              </p>

              {lineCount > 0 && (
                <details class="evidence-details grid-sources">
                  <summary>{messages.gridSourcesSummary(lineCount)}</summary>
                  <ul>
                    {sources.map((group) => (
                      <li key={group.qid}>
                        {group.name && <strong>{group.name}</strong>}
                        <ul>
                          {group.lines.map((line) => (
                            <li key={line.key}>
                              {`${line.project}, ${messages.revision} ${line.revision}.`}{" "}
                              <a href={line.url} target="_blank" rel="noopener noreferrer">
                                {messages.openRevision(line.project)}
                              </a>
                              <span class="grid-source-locator">
                                {messages.gridSourceLocator}{" "}
                                {line.locators.map((locator, i) => (
                                  <span key={locator} title={locator}>
                                    {i > 0 && ", "}
                                    {readableLocator(locator, messages)}
                                  </span>
                                ))}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
