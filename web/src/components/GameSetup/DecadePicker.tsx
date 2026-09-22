import type { Messages } from "../../i18n/catalog";
import type { QuizDecade } from "../Quiz/url-params";

export function DecadePicker({ available, value, onChange, messages, disabled = false }: {
  available: Exclude<QuizDecade, null>[]; value: QuizDecade; onChange: (decade: QuizDecade) => void;
  messages: Messages; disabled?: boolean;
}) {
  if (!available.length) return null;
  return <fieldset class="decade-picker" disabled={disabled}>
    <legend>{messages.chooseDecade}</legend>
    <div class="decade-options" role="radiogroup" aria-label={messages.chooseDecade}>
      {[null, ...available].map((decade) => <label class={`decade-option ${value === decade ? "selected" : ""}`} key={decade ?? "all"}>
        <input type="radio" name="quiz-decade" checked={value === decade} onChange={() => onChange(decade)} />
        {decade === null ? messages.allDecades : messages.decadeLabel(decade)}
      </label>)}
    </div>
  </fieldset>;
}
