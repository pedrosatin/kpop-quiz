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
    expect(screen.getByText("Quiz do dia")).toBeInTheDocument();
    expect(screen.getByText(ptMessages.generalGameDescription)).toBeInTheDocument();
    expect(screen.getByText(ptMessages.dailyGameDescription)).toBeInTheDocument();

    const historyRadio = screen.getByRole("radio", { name: /Quiz geral/ });
    const dailyRadio = screen.getByRole("radio", { name: /Quiz do dia/ });

    expect(historyRadio).toBeChecked();
    expect(dailyRadio).not.toBeChecked();
  });

  it("lists today's quiz first, so the default card is the first one on screen", () => {
    render(
      <GameCollection
        selectedTheme="daily"
        onSelectTheme={vi.fn()}
        messages={ptMessages}
      />
    );
    expect(screen.getAllByRole("radio").map((radio) => (radio as HTMLInputElement).value)).toEqual(["daily", "history"]);
  });

  it("puts the note in place of the general quiz description, in both languages", () => {
    const { unmount } = render(
      <GameCollection
        selectedTheme="daily"
        onSelectTheme={vi.fn()}
        messages={ptMessages}
        generalNote={ptMessages.quizGeneralInProgress(4, 10)}
      />
    );
    expect(screen.getByRole("radio", { name: /Quiz geral/ }).closest("label")).toHaveTextContent("Você parou na pergunta 4 de 10. Escolha para continuar.");
    expect(screen.queryByText(ptMessages.generalGameDescription)).not.toBeInTheDocument();
    expect(screen.getByText(ptMessages.dailyGameDescription)).toBeInTheDocument();
    unmount();
    render(
      <GameCollection
        selectedTheme="daily"
        onSelectTheme={vi.fn()}
        messages={enMessages}
        generalNote={enMessages.quizGeneralInProgress(4, 10)}
      />
    );
    expect(screen.getByRole("radio", { name: /General quiz/ }).closest("label")).toHaveTextContent("You stopped at question 4 of 10. Pick it to continue.");
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

    const dailyRadio = screen.getByRole("radio", { name: /Quiz do dia/ });
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
    expect(screen.getByRole("radio", { name: /Quiz do dia/ })).toBeDisabled();
  });

  it("does not repeat links to other games, which live in the game navigation bar", () => {
    render(
      <GameCollection
        selectedTheme="history"
        onSelectTheme={vi.fn()}
        messages={ptMessages}
      />
    );

    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
