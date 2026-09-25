import type { Messages } from "../../i18n/catalog";
import type { QuizDecadeSelection, QuizDecadeValue } from "../Quiz/url-params";

export function DecadePicker({ available, value, onChange, messages, disabled = false }: {
  available: QuizDecadeValue[]; value: QuizDecadeSelection; onChange: (decades: QuizDecadeSelection) => void;
  messages: Messages; disabled?: boolean;
}) {
  if (!available.length) return null;
  return <fieldset class="decade-picker" disabled={disabled}>
    <legend class="setup-legend">{messages.chooseDecades}</legend>
    <p class="setup-help">{messages.decadeHelp}</p>
    <div class="decade-options">
      {available.map((decade) => {
        const selected = value.includes(decade);
        return <label class={`choice choice-compact ${selected ? "selected" : ""}`} key={decade}>
          <input
            type="checkbox"
            name="quiz-decade"
            value={decade}
            checked={selected}
            onChange={() => onChange(selected
              ? value.filter((item) => item !== decade)
              : [...value, decade].sort())}
          />
          <span class="choice-title">{messages.decadeLabel(decade)}</span>
        </label>;
      })}
    </div>
  </fieldset>;
}
