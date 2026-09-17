import type { IntersectionGrid, Locale } from "../../lib/quiz-types";
import type { Messages } from "../../i18n/catalog";
import { cellKey, type GridCellState } from "./types";

export interface GridReviewProps {
  grid: IntersectionGrid;
  cellStates: Record<string, GridCellState>;
  locale: Locale;
  messages: Messages;
}

export function GridReview({ grid, cellStates, locale, messages }: GridReviewProps) {
  const candidateMap = new Map(grid.candidate_pool.map((c) => [c.id, c]));

  return (
    <section class="grid-review-section" aria-labelledby="grid-review-heading">
      <h3 id="grid-review-heading" class="grid-review-heading">
        {messages.gridReviewTitle}
      </h3>
      <div class="grid-review-list">
        {grid.cells.map((cell) => {
          const { row_index, col_index, valid_entity_ids, evidence } = cell;
          const key = cellKey(row_index, col_index);
          const state = cellStates[key] || { solved: false, failed: false };
          const rowCrit = grid.row_criteria[row_index]!;
          const colCrit = grid.col_criteria[col_index]!;

          const acceptedNames = valid_entity_ids
            .map((qid) => {
              const cand = candidateMap.get(qid);
              return cand ? cand.names[locale] || cand.canonical_name : qid;
            })
            .join(", ");

          return (
            <article key={key} class={`review-cell-item ${state.solved ? "solved" : "unsolved"}`}>
              <header class="review-cell-header">
                <h4>{messages.gridReviewCellHeader(row_index, col_index)}</h4>
                <p class="review-cell-criteria">
                  <strong>{rowCrit.label[locale]}</strong> × <strong>{colCrit.label[locale]}</strong>
                </p>
              </header>

              <div class="review-cell-body">
                <p class="review-user-guess">
                  <span class="label-prefix">{messages.yourAnswer}: </span>
                  {state.solved && state.entityName ? (
                    <strong class="text-success">{state.entityName}</strong>
                  ) : state.failed && state.lastAttempt ? (
                    <strong class="text-error">{state.lastAttempt}</strong>
                  ) : (
                    <span class="text-muted">{messages.noAnswer}</span>
                  )}
                </p>

                <p class="review-accepted-answers">
                  <span class="label-prefix">{messages.gridAcceptedAnswers} </span>
                  <span>{acceptedNames}</span>
                </p>

                {evidence.length > 0 && (
                  <div class="review-evidence">
                    <span class="label-prefix">{messages.gridEvidenceSource} </span>
                    <ul class="evidence-links-list">
                      {evidence.map((ev, evIdx) => (
                        <li key={evIdx}>
                          <a
                            href={ev.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="evidence-link"
                          >
                            {ev.source_key} (rev {ev.revision_id})
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
