import { cleanup, fireEvent, render } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import { MapPilotGame } from "./MapPilotGame";
import { mapPilotCountries, mapPilotCountryLabel, mapPilotEvents, selectMapPilotRound } from "../../data/map-pilot";

describe("map pilot game", () => {
  afterEach(cleanup);

  it("shows a source-linked correct answer and finishes a complete round", () => {
    const date = "2026-09-24";
    const round = selectMapPilotRound(mapPilotEvents, date);
    const { getByRole, getByTestId, getByText, queryByRole } = render(<MapPilotGame locale="pt-BR" seedDate={date} />);

    expect(getByRole("heading", { level: 2 }).textContent).toContain("Em qual país");
    expect(getByText("Pergunta 1 de 10")).toBeTruthy();

    for (const [index, event] of round.entries()) {
      const answer = getByTestId(`answer-country-${event.country_iso_3166_1}`);
      fireEvent.click(answer);
      expect(getByRole("status").textContent).toContain("Resposta correta.");
      const links = Array.from(document.querySelectorAll(".map-pilot-evidence a")) as HTMLAnchorElement[];
      expect(links.map((link) => link.href)).toContain(event.source_url);
      expect(links.map((link) => link.href)).toContain(event.musicbrainz_event_url);
      fireEvent.click(getByRole("button", { name: index === round.length - 1 ? "Ver resultado" : "Próxima data" }));
    }

    expect(getByRole("heading", { name: "Rodada concluída" })).toBeTruthy();
    expect(getByText("10 de 10 respostas corretas.")).toBeTruthy();
    expect(queryByRole("button", { name: "Próxima data" })).toBeNull();
  });

  it("reveals the right answer after an incorrect selection", () => {
    const date = "2026-09-24";
    const [event] = selectMapPilotRound(mapPilotEvents, date);
    const wrong = mapPilotEvents.find((candidate) => candidate.country_iso_3166_1 !== event!.country_iso_3166_1)!;
    const answerLabel = mapPilotCountryLabel(
      mapPilotCountries.find((country) => country.iso_3166_1 === event!.country_iso_3166_1)!,
      "pt-BR",
    );
    const { getByRole, getByTestId } = render(<MapPilotGame locale="pt-BR" seedDate={date} />);
    fireEvent.click(getByTestId(`answer-country-${wrong.country_iso_3166_1}`));
    expect(getByRole("status").textContent).toContain("Essa não é a resposta.");
    expect(getByRole("status").textContent).toContain("País correto");
    expect(getByRole("status").textContent).toContain(answerLabel);
    const wrongLabel = mapPilotCountryLabel(
      mapPilotCountries.find((country) => country.iso_3166_1 === wrong.country_iso_3166_1)!,
      "pt-BR",
    );
    expect(getByRole("status").textContent).toContain(`Sua resposta: ${wrongLabel}`);
  });

  it("keeps the next action in the action bar and focuses it after an answer", () => {
    const date = "2026-09-24";
    const [event] = selectMapPilotRound(mapPilotEvents, date);
    const { getByRole, getByTestId } = render(<MapPilotGame locale="pt-BR" seedDate={date} />);
    expect(getByRole("status").textContent).toContain("Escolha um país destacado");
    fireEvent.click(getByTestId(`answer-country-${event!.country_iso_3166_1}`));
    const next = getByRole("button", { name: "Próxima data" });
    expect(next.closest(".map-pilot-action-bar")).toBe(getByRole("status"));
    expect(document.activeElement).toBe(next);
    fireEvent.click(next);
    expect(getByRole("status").textContent).toContain("Escolha um país destacado");
  });

  it("chooses the daily round after mount so the server HTML matches the first client render", async () => {
    const { findByText, getByRole } = render(<MapPilotGame locale="en" />);
    expect(await findByText("Question 1 of 10")).toBeTruthy();
    expect(getByRole("heading", { level: 2 }).textContent).toContain("Which country");
  });
});
