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
    <section class="review-section" aria-labelledby="grid-review-heading">
      <h3 id="grid-review-heading" class="review-section-title">
        {messages.gridReviewTitle}
      </h3>
      <ol class="review-list">
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
            <li key={key} class={`review-item ${state.solved ? "is-correct" : "is-wrong"}`}>
              <div class="review-item-header">
                <span class={`badge ${state.solved ? "badge-success" : "badge-failure"}`}>
                  {state.solved ? messages.correct : messages.incorrect}
                </span>
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

              {evidence.length > 0 && (
                <details class="evidence-details">
                  <summary>{messages.evidence}</summary>
                  <ul>
                    {evidence.map((ev, evIdx) => (
                      <li key={evIdx}>
                        <a href={ev.source_url} target="_blank" rel="noopener noreferrer">
                          {ev.source_key} (rev {ev.revision_id})
                        </a>
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
