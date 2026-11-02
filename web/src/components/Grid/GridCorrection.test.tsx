import { render, screen, waitFor } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import { IntersectionGrid } from "./IntersectionGrid";
import { getMessages } from "../../i18n/catalog";
import grid from "../../tests/fixtures/grid.daily.json";
const oldId = "b".repeat(64);
const cells = Object.fromEntries(grid.cells.map(c => [`${c.row_index},${c.col_index}`, { solved: false, failed: false }]));
const oldSave = { guessesUsed: 1, cells: { ...cells, "0,0": { solved: true, failed: false, entityId: grid.cells[0]!.valid_entity_ids[0] } } };
function serve(corrected: boolean) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("grid-publication.")) return new Response(JSON.stringify({ schema_version: "kpop-grid-publication-v1", reference_date: grid.reference_date, grid_reference_date: grid.reference_date, grid_id: grid.grid_id, replaces: corrected ? [oldId] : [] }));
    return new Response(JSON.stringify(grid));
  }));
}
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it.each(["pt-BR", "en"] as const)("explains correction, ignores old save, and restores corrected progress on reload (%s)", async locale => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(`${grid.reference_date}T15:00:00Z`));
  localStorage.setItem(`kpop-grid-${oldId}`, JSON.stringify(oldSave));
  serve(true);
  const first = render(<IntersectionGrid locale={locale} />);
  await screen.findByTestId("game-board");
  expect(screen.getByTestId("grid-correction")).toHaveTextContent(getMessages(locale).gridCorrected);
  expect(screen.getByText(locale === "en" ? "0 of 9 squares correct" : "0 de 9 casas certas")).toBeInTheDocument();
  expect(localStorage.getItem(`kpop-grid-${oldId}`)).toBe(JSON.stringify(oldSave));
  first.unmount();
  localStorage.setItem(`kpop-grid-${grid.grid_id}`, JSON.stringify(oldSave));
  render(<IntersectionGrid locale={locale} />);
  await screen.findByTestId("game-board");
  expect(screen.getByTestId("grid-correction")).toHaveTextContent(getMessages(locale).gridCorrected);
  await waitFor(() => expect(screen.getByText(locale === "en" ? "1 of 9 squares correct" : "1 de 9 casas certas")).toBeInTheDocument());
});
it("normal same-day reload preserves the save without a correction notice", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(`${grid.reference_date}T15:00:00Z`));
  serve(false); localStorage.setItem(`kpop-grid-${grid.grid_id}`, JSON.stringify(oldSave));
  render(<IntersectionGrid locale="en" />); await screen.findByTestId("game-board");
  expect(screen.queryByTestId("grid-correction")).toBeNull();
  expect(screen.getByText("1 of 9 squares correct")).toBeInTheDocument();
});
