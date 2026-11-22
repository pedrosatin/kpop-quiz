import { render } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useQuizFocus } from "./useQuizFocus";
import type { QuizMatch } from "./useQuizMatch";

function Harness({ match }: { match: QuizMatch }) {
  const { setupHeadingRef } = useQuizFocus(match);
  return (
    <section class="quiz-setup" data-testid="game-setup">
      <p class="kicker">Antes de começar</p>
      <h2 ref={setupHeadingRef} tabIndex={-1}>Monte sua partida</h2>
    </section>
  );
}

function matchStub(overrides: Partial<QuizMatch> = {}): QuizMatch {
  return {
    state: "setup",
    questionIndex: 0,
    restoredVisit: false,
    focusQuestionRef: { current: false },
    focusRestoredRef: { current: false },
    focusSetupRef: { current: true },
    ...overrides,
  } as QuizMatch;
}

describe("useQuizFocus", () => {
  const originalFocus = HTMLHeadingElement.prototype.focus;
  const originalScroll = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");

  afterEach(() => {
    HTMLHeadingElement.prototype.focus = originalFocus;
    if (originalScroll) Object.defineProperty(Element.prototype, "scrollIntoView", originalScroll);
    else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    vi.restoreAllMocks();
  });

  it("focuses the setup title without scrolling, then scrolls the setup card to the start", () => {
    const focus = vi.fn();
    const scrollIntoView = vi.fn();
    HTMLHeadingElement.prototype.focus = focus;
    Element.prototype.scrollIntoView = scrollIntoView;

    render(<Harness match={matchStub()} />);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    expect(scrollIntoView.mock.contexts[0]).toHaveClass("quiz-setup");
  });

  it("clears the setup focus flag after running once", () => {
    HTMLHeadingElement.prototype.focus = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
    const focusSetupRef = { current: true };
    render(<Harness match={matchStub({ focusSetupRef })} />);
    expect(focusSetupRef.current).toBe(false);
  });
});
