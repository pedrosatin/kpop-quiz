import type { ComponentChildren, RefObject } from "preact";
import type { QuizOption } from "../../lib/quiz-types";

export interface QuestionCardProps {
  headingRef?: RefObject<HTMLHeadingElement> | undefined;
  prompt: string;
  options: QuizOption[];
  selectedOptionId: string | null;
  onSelectOption: (id: string) => void;
  answered: boolean;
  correctOptionId: string;
  onSubmit: () => void;
  submitLabel: string;
  legendLabel: string;
  children?: ComponentChildren;
}

export function QuestionCard({
  headingRef,
  prompt,
  options,
  selectedOptionId,
  onSelectOption,
  answered,
  correctOptionId,
  onSubmit,
  submitLabel,
  legendLabel,
  children,
}: QuestionCardProps) {
  return (
    <div class="quiz-question-card">
      <h2 id="question-heading" {...(headingRef ? { ref: headingRef } : {})} tabIndex={-1}>
        {prompt}
      </h2>
      {children}
      <fieldset class="options" disabled={answered}>
        <legend class="visually-hidden">{legendLabel}</legend>
        {options.map((option, index) => {
          const state = answered
            ? option.id === correctOptionId
              ? "correct"
              : option.id === selectedOptionId
              ? "incorrect"
              : ""
            : "";
          return (
            <label class={`option ${state}`} key={option.id}>
              <input
                type="radio"
                name="answer"
                value={option.id}
                checked={selectedOptionId === option.id}
                onChange={() => onSelectOption(option.id)}
              />
              <span class="option-key" aria-hidden="true">
                {String.fromCharCode(65 + index)}
              </span>
              <span>{option.label}</span>
            </label>
          );
        })}
      </fieldset>
      {!answered && (
        <button
          class="primary-action"
          type="button"
          disabled={!selectedOptionId}
          onClick={onSubmit}
        >
          {submitLabel}
        </button>
      )}
    </div>
  );
}
