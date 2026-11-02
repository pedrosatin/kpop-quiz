import { render } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import { QuizRound } from "./QuizRound";
import type { QuizSession } from "../../lib/quiz-types";
import { getMessages } from "../../i18n/catalog";
import fixture from "../../tests/fixtures/session.pt-BR.standard.cfd5c3457b985e8171255a5b4fe7b8328ef25c5f5d9e5a4632f5179120fc1d47.json";

const session = fixture as QuizSession;
const originalIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const [key, descriptor] of [["scrollIntoView", originalIntoView], ["scrollTo", originalScrollTo]] as const) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
  }
});

it("positions each mobile question once without moving the player on selection or feedback", () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
  const intoView = vi.fn();
  const scrollTo = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: intoView });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });
  const props = {
    question: session.questions[0]!, selectedId: null as string | null, answered: false,
    playMode: "standard" as const, messages: getMessages("pt-BR"),
    onSelectOption: vi.fn(), onSubmit: vi.fn(), onRevealClue: vi.fn(),
  };
  const view = render(<QuizRound {...props} />);
  expect(intoView).toHaveBeenCalledTimes(1);
  expect(scrollTo).toHaveBeenCalledWith(0, 0);
  view.rerender(<QuizRound {...props} selectedId={props.question.options[0]!.id} answered />);
  expect(intoView).toHaveBeenCalledTimes(1);
  view.rerender(<QuizRound {...props} question={session.questions[1]!} />);
  expect(intoView).toHaveBeenCalledTimes(2);
});

it("preserves desktop page position", () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  const intoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: intoView });
  render(<QuizRound question={session.questions[0]!} selectedId={null} answered={false}
    playMode="standard" messages={getMessages("pt-BR")} onSelectOption={vi.fn()}
    onSubmit={vi.fn()} onRevealClue={vi.fn()} />);
  expect(intoView).not.toHaveBeenCalled();
});
