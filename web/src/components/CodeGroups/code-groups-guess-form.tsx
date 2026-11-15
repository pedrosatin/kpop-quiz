import type { CodeGroupsSymbol } from "../../data/code-groups";
import type { Messages } from "../../i18n/catalog";

export interface CodeGroupsGuessFormProps {
  symbols: readonly CodeGroupsSymbol[];
  nameByQid: ReadonlyMap<string, string>;
  selection: readonly string[];
  finished: boolean;
  messages: Messages;
  onSelect: (index: number, qid: string) => void;
  onSubmit: () => void;
  onRepeatKey: (event: KeyboardEvent) => void;
}

/** The four position slots and the Submit button, locked once the round ends. */
export function CodeGroupsGuessForm({ symbols, nameByQid, selection, finished, messages, onSelect, onSubmit, onRepeatKey }: CodeGroupsGuessFormProps) {
  return (
    <form
      onKeyDown={(event) => { if (event.key === "Enter") onRepeatKey(event); }}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <fieldset disabled={finished}>
        <legend>{messages.codeYourGuess}</legend>
        <div class="code-slots">
          {selection.map((value, index) => (
            <label key={index}>
              {`${messages.codePosition} ${index + 1}`}
              <select
                value={value}
                disabled={finished}
                onChange={(event) => onSelect(index, event.currentTarget.value)}
                aria-label={`${messages.codePosition} ${index + 1}`}
              >
                <option value="">{messages.codeChooseGroup}</option>
                {symbols.map((s) => (
                  <option value={s.qid} key={s.qid}>
                    {nameByQid.get(s.qid) ?? s.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <button class="btn btn-primary" type="submit" disabled={finished}>
          {messages.codeSubmit}
        </button>
      </fieldset>
    </form>
  );
}
