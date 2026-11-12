import type { Ref } from "preact";
import { useRef, useState } from "preact/hooks";
import type { MapPilotCountry, MapPilotEvent } from "../../data/map-pilot";
import type { getMessages } from "../../i18n/catalog";
import type { Locale } from "../../lib/quiz-types";
import type { MapPilotCopy } from "./map-pilot-copy";
import { MapPilotFeedbackMessage, mapPilotBarState, type ShareNotice } from "./map-pilot-feedback";
import { MapPilotNextButton, MapPilotPickForm } from "./MapPilotControls";
import { MapPilotResult } from "./MapPilotResult";
import { classes } from "./map-pilot-targets";
import type { MapTurn, RoundState } from "./map-pilot-turn";
import type { MapRoundActions } from "./useMapRoundActions";

export interface MapPilotActionBarProps {
  locale: Locale;
  copy: MapPilotCopy;
  messages: ReturnType<typeof getMessages>;
  game: RoundState;
  round: MapPilotEvent[];
  turn: MapTurn;
  countryByFeature: Map<string, MapPilotCountry>;
  sortedCountries: MapPilotCountry[];
  listChoice: string;
  setListChoice: (featureId: string) => void;
  actions: MapRoundActions;
  nextButton: Ref<HTMLButtonElement>;
  resultTitle: Ref<HTMLHeadingElement>;
}

/** The answer controls, the verdict and Next, then the result at the end. */
export function MapPilotActionBar({
  locale,
  copy,
  messages,
  game,
  round,
  turn,
  countryByFeature,
  sortedCountries,
  listChoice,
  setListChoice,
  actions,
  nextButton,
  resultTitle,
}: MapPilotActionBarProps) {
  const [notice, setNotice] = useState<ShareNotice | null>(null);
  const notices = useRef(0);
  const { isComplete, answerState, questionIndex } = turn;

  return (
    // Only the message is a live region, so the buttons and links are not announced.
    <div class={`game-actions map-pilot-actions${mapPilotBarState(answerState)}`}>
      <div
        class={classes("game-actions-message", isComplete && "visually-hidden")}
        role="status"
        aria-live="polite"
      >
        <MapPilotFeedbackMessage
          isComplete={isComplete}
          answerState={answerState}
          current={turn.current}
          answerCountry={turn.answerCountry}
          selectedCountry={turn.selectedCountry}
          pickPrompt={actions.pickPrompt}
          notice={notice}
          locale={locale}
          copy={copy}
          messages={messages}
        />
      </div>
      {isComplete ? (
        <MapPilotResult
          roundDate={game.date}
          round={round}
          answers={game.answers}
          countryByFeature={countryByFeature}
          locale={locale}
          gaveUp={game.gaveUp === true || game.answers.length < round.length}
          onCopied={() => setNotice({ kind: "copied", n: ++notices.current })}
          onShareFailed={() => setNotice({ kind: "shareFailed", n: ++notices.current })}
          titleRef={resultTitle}
        />
      ) : answerState ? (
        <MapPilotNextButton
          buttonRef={nextButton}
          label={questionIndex + 1 === round.length ? copy.finish : copy.next}
          onNext={actions.nextQuestion}
        />
      ) : (
        <>
          <MapPilotPickForm
            listChoice={listChoice}
            sortedCountries={sortedCountries}
            locale={locale}
            copy={copy}
            onListChoice={setListChoice}
            onClearPickPrompt={actions.clearPickPrompt}
            onChooseCountry={actions.submitAnswer}
            onEmptySubmit={actions.promptPick}
          />
          {/* After an answer the bar keeps only Next: giving up waits for the next date. */}
          <button type="button" class="btn btn-secondary" onClick={actions.requestGiveUp}>
            {messages.giveUp}
          </button>
        </>
      )}
    </div>
  );
}
