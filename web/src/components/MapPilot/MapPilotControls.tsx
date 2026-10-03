import type { Ref } from "preact";
import type { MapPilotCountry } from "../../data/map-pilot";
import { mapPilotCountryLabel } from "../../data/map-pilot";
import type { Locale } from "../../lib/quiz-types";
import type { MapPilotCopy } from "./map-pilot-copy";

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
    // Narrow screens have no room for the list beside the map: the same
    // countries sit in the bar as a select with its answer button.
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
