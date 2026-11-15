import { fireEvent, render, screen } from "@testing-library/preact";
import { expect, it, vi } from "vitest";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";
import { resetRound } from "./quiz-round-state";
import { useQuizMatch } from "./useQuizMatch";
import { useQuizSettings } from "./useQuizSettings";

it("closes a pending give-up dialog when the Quiz round resets", () => {
  function Round() {
    const match = useQuizMatch();
    const settings = useQuizSettings("pt-BR", []);
    const reset = () => resetRound({
      locale: "pt-BR",
      settings,
      match,
      question: undefined,
      timerSeconds: null,
      persistProgress: vi.fn(),
      analytics: { start: vi.fn(), reset: vi.fn(), resume: vi.fn() },
    }, 10, "question.ready", null);

    return <>
      <button onClick={match.requestGiveUp}>Desistir</button>
      <button onClick={reset}>Reset round</button>
      <output>{match.state}</output>
      <ConfirmDialog
        isOpen={match.confirmGiveUpOpen}
        title="Desistir da partida?"
        body="Você perderá o progresso desta partida."
        confirmLabel="Sim, desistir"
        cancelLabel="Cancelar"
        onConfirm={() => match.confirmGiveUp(vi.fn())}
        onCancel={match.closeGiveUpConfirm}
      />
    </>;
  }

  render(<Round />);
  fireEvent.click(screen.getByRole("button", { name: "Desistir" }));
  expect(screen.getByRole("dialog", { name: "Desistir da partida?" })).toBeInTheDocument();

  // Exercise the round transition directly: replay is unavailable behind the dialog.
  fireEvent.click(screen.getByRole("button", { name: "Reset round" }));

  expect(screen.getByRole("status")).toHaveTextContent("question.ready");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
