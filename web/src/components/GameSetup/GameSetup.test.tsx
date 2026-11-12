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

  it("keeps the kind of quiz open and the other options under Customize, in reading order", () => {
    const { container } = render(
      <GameSetup
        playMode="standard"
        onSelectMode={vi.fn()}
        theme="daily"
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
    const customize = container.querySelector<HTMLDetailsElement>("details.setup-customize")!;
    expect(customize.open).toBe(false);
    expect(container.querySelector(".game-collection")!.closest("details")).toBeNull();
    expect(screen.getByRole("radio", { name: /Quiz do dia/ })).toBeChecked();
    // From 60rem the open group splits: decades left, mode and timer right.
    const groups = [...customize.querySelectorAll(".setup-customize-body > .setup-group")];
    expect(customize.querySelector(".setup-customize-body")).toHaveClass("setup-customize-body--split");
    expect(groups).toHaveLength(2);
    expect(groups[0]!.querySelector(".decade-picker")).not.toBeNull();
    expect(groups[1]!.querySelector(".difficulty-picker")).not.toBeNull();
    expect(groups[1]!.querySelector(".timer-choice")).not.toBeNull();
    // Tab reads today's quiz first, then Customize and its options, then Start.
    const names = [...container.querySelectorAll("input, summary, button")].map((node) =>
      node instanceof HTMLInputElement ? `${node.name}:${node.value}` : node.tagName === "SUMMARY" ? "summary" : node.textContent);
    expect(names).toEqual([
      "quiz-theme:daily", "quiz-theme:history",
      "summary",
      "quiz-decade:1990", "quiz-decade:2000",
      "play-mode:assisted", "play-mode:standard", "play-mode:expert",
      ":on",
      messages.start,
    ]);
  });

  it("names the current mode, timer and decades on the closed Customize row", () => {
    const props = {
      onSelectMode: vi.fn(),
      onSelectTheme: vi.fn(),
      availableDecades: [1990, 2000, 2010] as Array<1990 | 2000 | 2010>,
      onSelectDecades: vi.fn(),
      onTimerChange: vi.fn(),
      onStart: vi.fn(),
      isReady: true,
    };
    const { rerender } = render(<GameSetup {...props} playMode="standard" decades={[]} timerEnabled={false} messages={messages} />);
    const summary = screen.getByTestId("setup-customize-summary");
    expect(summary.closest("summary")).toHaveTextContent("Personalizar");
    expect(summary).toHaveTextContent("Modo Padrão · sem limite de tempo");
    rerender(<GameSetup {...props} playMode="expert" decades={[1990, 2010]} timerEnabled={true} messages={messages} />);
    expect(summary).toHaveTextContent("Modo Especialista · 20 segundos por pergunta · anos 1990, 2010");
    rerender(<GameSetup {...props} playMode="assisted" decades={[2000]} timerEnabled={false} messages={getMessages("en")} />);
    expect(screen.getByTestId("setup-customize-summary")).toHaveTextContent("Assisted mode · no time limit · 2000s");
    expect(screen.getByTestId("setup-customize-summary").closest("summary")).toHaveTextContent("Customize");
  });

  it("opens Customize to reach the mode", () => {
    const onSelectMode = vi.fn();
    const { container } = render(
      <GameSetup
        playMode="standard"
        onSelectMode={onSelectMode}
        onSelectTheme={vi.fn()}
        timerEnabled={false}
        onTimerChange={vi.fn()}
        onStart={vi.fn()}
        isReady={true}
        messages={messages}
      />
    );
    const customize = container.querySelector<HTMLDetailsElement>("details.setup-customize")!;
    fireEvent.click(customize.querySelector("summary")!);
    expect(customize.open).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /Especialista/ }));
    expect(onSelectMode).toHaveBeenCalledWith("expert");
  });

  it("leaves out the decade group when there are no decades to pick", () => {
    const { container } = render(
      <GameSetup
        playMode="standard"
        onSelectMode={vi.fn()}
        timerEnabled={false}
        onTimerChange={vi.fn()}
        onStart={vi.fn()}
        isReady={true}
        messages={messages}
      />
    );
    const groups = [...container.querySelectorAll(".setup-customize-body > .setup-group")];
    expect(groups).toHaveLength(1);
    expect(container.querySelector(".setup-customize-body")).not.toHaveClass("setup-customize-body--split");
    expect(groups[0]!.querySelector(".difficulty-picker")).not.toBeNull();
    expect(container.querySelector(".setup-group:empty")).toBeNull();
  });
});
