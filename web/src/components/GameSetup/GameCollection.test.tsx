import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { GameCollection } from "./GameCollection";
import { getMessages } from "../../i18n/catalog";

const ptMessages = getMessages("pt-BR");
const enMessages = getMessages("en");

describe("GameCollection component", () => {
  it("renders both General Quiz and Daily Quiz options in pt-BR", () => {
    const onSelect = vi.fn();
    render(
      <GameCollection
        selectedTheme="history"
        onSelectTheme={onSelect}
        messages={ptMessages}
      />
    );

    expect(screen.getByText("Quiz geral")).toBeInTheDocument();
    expect(screen.getByText("Partida diária")).toBeInTheDocument();
    expect(screen.getByText(ptMessages.generalGameDescription)).toBeInTheDocument();
    expect(screen.getByText(ptMessages.dailyGameDescription)).toBeInTheDocument();

    const historyRadio = screen.getByRole("radio", { name: /Quiz geral/ });
    const dailyRadio = screen.getByRole("radio", { name: /Partida diária/ });

    expect(historyRadio).toBeChecked();
    expect(dailyRadio).not.toBeChecked();
  });

  it("renders both options in English", () => {
    render(
      <GameCollection
        selectedTheme="daily"
        onSelectTheme={vi.fn()}
        messages={enMessages}
      />
    );

    expect(screen.getByText("General quiz")).toBeInTheDocument();
    expect(screen.getByText("Daily quiz")).toBeInTheDocument();

    const historyRadio = screen.getByRole("radio", { name: /General quiz/ });
    const dailyRadio = screen.getByRole("radio", { name: /Daily quiz/ });

    expect(historyRadio).not.toBeChecked();
    expect(dailyRadio).toBeChecked();
  });

  it("triggers onSelectTheme callback when switching game theme", () => {
    const onSelect = vi.fn();
    render(
      <GameCollection
        selectedTheme="history"
        onSelectTheme={onSelect}
        messages={ptMessages}
      />
    );

    const dailyRadio = screen.getByRole("radio", { name: /Partida diária/ });
    fireEvent.click(dailyRadio);
    expect(onSelect).toHaveBeenCalledWith("daily");
  });

  it("disables all options when disabled prop is true", () => {
    render(
      <GameCollection
        selectedTheme="history"
        onSelectTheme={vi.fn()}
        messages={ptMessages}
        disabled={true}
      />
    );

    const fieldset = screen.getByRole("group", { hidden: true });
    expect(fieldset).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Quiz geral/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Partida diária/ })).toBeDisabled();
  });
});
