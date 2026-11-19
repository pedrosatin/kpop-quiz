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
  legendLabel: string;
  children?: ComponentChildren;
  /** Inside a group-page section (already an h2), demote to h3. Defaults to 2. */
  headingLevel?: 2 | 3;
}

export function QuestionCard({
  headingRef,
  prompt,
  options,
  selectedOptionId,
  onSelectOption,
  answered,
  correctOptionId,
  legendLabel,
  children,
  headingLevel = 2,
}: QuestionCardProps) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <div class="quiz-question-card">
      <Heading id="question-heading" class="game-card-title" {...(headingRef ? { ref: headingRef } : {})} tabIndex={-1}>
        {prompt}
      </Heading>
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
    </div>
  );
}
