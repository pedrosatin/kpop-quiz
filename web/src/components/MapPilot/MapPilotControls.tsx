import type { Ref } from "preact";
import type { MapPilotCountry } from "../../data/map-pilot";
import { mapPilotCountryLabel } from "../../data/map-pilot";
import type { Locale } from "../../lib/quiz-types";
import type { MapPilotCopy } from "./map-pilot-copy";
import { classes } from "./map-pilot-targets";

export function MapPilotNextButton({
  buttonRef,
  label,
  onNext,
}: {
  buttonRef: Ref<HTMLButtonElement>;
  label: string;
  onNext: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      class="btn btn-primary"
      type="button"
      onKeyDown={(event) => { if (event.repeat) event.preventDefault(); }}
      onClick={onNext}
    >
      {label}
    </button>
  );
}

export function MapPilotPickForm({
  listChoice,
  sortedCountries,
  locale,
  copy,
  onListChoice,
  onClearPickPrompt,
  onChooseCountry,
  onEmptySubmit,
}: {
  listChoice: string;
  sortedCountries: MapPilotCountry[];
  locale: Locale;
  copy: MapPilotCopy;
  onListChoice: (value: string) => void;
  onClearPickPrompt: () => void;
  onChooseCountry: (featureId: string) => void;
  onEmptySubmit: () => void;
}) {
  return (
    // Narrow screens use the select; wide screens hide it in CSS and keep
    // Answer so map/list selection still needs an explicit submit.
    <form
      class="map-pilot-pick"
      onSubmit={(event) => {
        event.preventDefault();
        if (listChoice) onChooseCountry(listChoice);
        else onEmptySubmit();
      }}
    >
      <select
        class="map-pilot-select"
        aria-label={copy.countryChoices}
        value={listChoice}
        onChange={(event) => {
          onListChoice((event.currentTarget as HTMLSelectElement).value);
          onClearPickPrompt();
        }}
      >
        <option value="" disabled>{copy.pickPlaceholder}</option>
        {sortedCountries.map((country) => (
          <option key={country.map_feature_id} value={country.map_feature_id}>
            {mapPilotCountryLabel(country, locale)}
          </option>
        ))}
      </select>
      {/* aria-disabled keeps Answer in the Tab order and lets it say why nothing happened. */}
      <button class="btn btn-primary" type="submit" aria-disabled={listChoice ? undefined : "true"}>{copy.answer}</button>
    </form>
  );
}

/** Beside the map on wide screens; narrow screens use the select in the bar. */
export function MapPilotCountryList({
  countries,
  locale,
  copy,
  highlightFeature,
  selectedFeature,
  answerFeature,
  onPick,
}: {
  countries: MapPilotCountry[];
  locale: Locale;
  copy: MapPilotCopy;
  highlightFeature: string | null;
  /** The committed answer for the date on screen. */
  selectedFeature: string | null;
  /** The correct country of the date on screen. */
  answerFeature: string;
  onPick: (featureId: string) => void;
}) {
  const answered = selectedFeature !== null;
  return (
    <div class="map-pilot-answers" role="group" aria-labelledby="map-country-choices">
      <h3 id="map-country-choices" class="map-pilot-country-heading">{copy.countryChoices}</h3>
      <div class="map-pilot-country-list">
        {countries.map((country) => (
          <button
            key={country.map_feature_id}
            type="button"
            class={classes(
              "map-pilot-country",
              highlightFeature === country.map_feature_id && "is-selected",
              answered && country.map_feature_id === answerFeature && "is-answer",
            )}
            disabled={answered}
            onClick={() => onPick(country.map_feature_id)}
            data-testid={`answer-country-${country.iso_3166_1}`}
          >
            {mapPilotCountryLabel(country, locale)}
          </button>
        ))}
      </div>
    </div>
  );
}
