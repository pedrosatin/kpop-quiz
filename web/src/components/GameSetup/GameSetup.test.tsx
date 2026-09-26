import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { GameSetup } from "./GameSetup";
import { DifficultyPicker } from "./DifficultyPicker";
import { TimerControl } from "./TimerControl";
import { getMessages } from "../../i18n/catalog";

const messages = getMessages("pt-BR");

describe("GameSetup components", () => {
  it("renders DifficultyPicker and triggers mode selection callback", () => {
    const onSelect = vi.fn();
    render(
      <DifficultyPicker
        playMode="standard"
        onSelectMode={onSelect}
        messages={messages}
      />
    );
    const expertRadio = screen.getByRole("radio", { name: /Especialista/ });
    fireEvent.click(expertRadio);
    expect(onSelect).toHaveBeenCalledWith("expert");
  });

  it("renders TimerControl and responds to toggle", () => {
    const onChange = vi.fn();
    render(
      <TimerControl
        enabled={false}
        onChange={onChange}
        label={messages.enableTimer}
      />
    );
    const checkbox = screen.getByRole("checkbox", { name: messages.enableTimer });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("allows selecting more than one formation decade", () => {
    const onSelectDecades = vi.fn();
    render(
      <GameSetup
        playMode="standard"
        onSelectMode={vi.fn()}
        availableDecades={[1990, 2000, 2010, 2020]}
        decades={[1990]}
        onSelectDecades={onSelectDecades}
        timerEnabled={false}
        onTimerChange={vi.fn()}
        onStart={vi.fn()}
        isReady={true}
        messages={messages}
      />
    );

    const nineties = screen.getByRole("checkbox", { name: "Anos 1990" });
    const twoThousands = screen.getByRole("checkbox", { name: "Anos 2000" });
    expect(nineties).toBeChecked();
    fireEvent.click(twoThousands);
    expect(onSelectDecades).toHaveBeenCalledWith([1990, 2000]);
  });

  it("renders GameSetup with rules and disables start button when not ready", () => {
    const onStart = vi.fn();
    const { rerender } = render(
      <GameSetup
        playMode="expert"
        onSelectMode={vi.fn()}
        timerEnabled={false}
        onTimerChange={vi.fn()}
        onStart={onStart}
        isReady={false}
        messages={messages}
      />
    );
    expect(screen.getByText(messages.roundRules)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: messages.start });
    expect(button).toBeDisabled();

    rerender(
      <GameSetup
        playMode="expert"
        onSelectMode={vi.fn()}
        timerEnabled={false}
        onTimerChange={vi.fn()}
        onStart={onStart}
        isReady={true}
        messages={messages}
      />
    );
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("keeps the start button after every option so focus order matches the layout", () => {
    render(
      <GameSetup
        playMode="standard"
        onSelectMode={vi.fn()}
        onSelectTheme={vi.fn()}
        availableDecades={[1990, 2000]}
        decades={[]}
        onSelectDecades={vi.fn()}
        timerEnabled={false}
        onTimerChange={vi.fn()}
        onStart={vi.fn()}
        isReady={true}
        messages={messages}
      />
    );
    const start = screen.getByRole("button", { name: messages.start });
    const timer = screen.getByRole("checkbox", { name: messages.enableTimer });
    const lastMode = screen.getByRole("radio", { name: /Especialista/ });

    expect(start.closest(".setup-actions")).not.toBeNull();
    expect(lastMode.compareDocumentPosition(timer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(timer.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("splits the options into two column groups without changing their order", () => {
    const { container } = render(
      <GameSetup
        playMode="standard"
        onSelectMode={vi.fn()}
        onSelectTheme={vi.fn()}
        availableDecades={[1990, 2000]}
        decades={[]}
        onSelectDecades={vi.fn()}
        timerEnabled={false}
        onTimerChange={vi.fn()}
        onStart={vi.fn()}
        isReady={true}
        messages={messages}
      />
    );
    expect(container.querySelector("#quiz")).toHaveClass("game-card--wide");
    const groups = [...container.querySelectorAll(".setup-options > .setup-group")];
    expect(groups).toHaveLength(2);
    // Left: which questions (kind of quiz, decades). Right: how to play them.
    expect(groups[0]!.querySelector(".game-collection")).not.toBeNull();
    expect(groups[0]!.querySelector(".decade-picker")).not.toBeNull();
    expect(groups[1]!.querySelector(".difficulty-picker")).not.toBeNull();
    expect(groups[1]!.querySelector(".timer-choice")).not.toBeNull();
    // Tab reads the left column, then the right one, then Start.
    const names = [...container.querySelectorAll("input, button")].map((node) =>
      node instanceof HTMLInputElement ? `${node.name}:${node.value}` : node.textContent);
    expect(names).toEqual([
      "quiz-theme:history", "quiz-theme:daily",
      "quiz-decade:1990", "quiz-decade:2000",
      "play-mode:assisted", "play-mode:standard", "play-mode:expert",
      ":on",
      messages.start,
    ]);
  });
});
