import type { Messages } from "../../i18n/catalog";
import type { QuestionResult } from "../Quiz/types";
import { groupEvidence } from "../Quiz/AnswerFeedback";
import { LicensedMedia } from "../Quiz/LicensedMedia";

export interface ReviewAnswersProps {
  items: QuestionResult[];
  messages: Messages;
}

export function ReviewAnswers({ items, messages }: ReviewAnswersProps) {
  if (items.length === 0) return null;

  return (
    <section class="review-answers" aria-labelledby="review-answers-heading">
      <h3 id="review-answers-heading" class="review-title">
        {messages.reviewTitle}
      </h3>
      <ol class="review-list">
        {items.map((item, index) => {
          const selectedOption = item.selectedOptionId
            ? item.question.options.find((option) => option.id === item.selectedOptionId)
            : null;
          const correctOption = item.question.options.find(
            (option) => option.id === item.question.answer_option_id
          );
          const displayedEvidence = groupEvidence(item.question.evidence);

          return (
            <li key={item.question.id} class="review-item">
              <div class="review-item-header">
                <span class={`review-badge ${item.isCorrect ? "success" : "failure"}`}>
                  {item.isCorrect ? messages.correct : messages.incorrect}
                </span>
                <span class="review-item-counter">
                  {messages.questionCounter(index + 1, items.length)}
                </span>
              </div>
              <h4 class="review-prompt">{item.question.prompt}</h4>
              {item.question.media && (
                <LicensedMedia
                  media={item.question.media}
                  isAnswered={true}
                  messages={messages}
                />
              )}
              <div class="review-details">
                <p class="review-row">
                  <span class="review-label">{messages.yourAnswer}: </span>
                  <strong class="review-value">
                    {selectedOption ? selectedOption.label : messages.noAnswer}
                  </strong>
                </p>
                <p class="review-row">
                  <span class="review-label">{messages.correctAnswer}: </span>
                  <strong class="review-value">
                    {correctOption ? correctOption.label : ""}
                  </strong>
                </p>
              </div>
              <p class="review-explanation">{item.question.explanation}</p>
              {displayedEvidence.length > 0 && (
                <details class="review-evidence">
                  <summary>{messages.evidence}</summary>
                  {displayedEvidence.map((ev) => (
                    <p key={`${ev.source_url}-${ev.revision_id}-${ev.locator}`}>
                      {ev.project}, {messages.revision} {ev.revision_id}.
                      {ev.declaredReference && (
                        <> {messages.declaredReference}: {ev.declaredReference}.</>
                      )}
                      {" "}
                      <a href={ev.source_url} target="_blank" rel="noopener noreferrer">
                        {messages.openRevision(ev.project)}
                      </a>
                    </p>
                  ))}
                </details>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
