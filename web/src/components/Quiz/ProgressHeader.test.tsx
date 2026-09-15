import { render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { ProgressHeader } from "./ProgressHeader";
import { getMessages } from "../../i18n/catalog";

const messages = getMessages("pt-BR");

describe("ProgressHeader", () => {
  it("renders question counter, score, and progressbar attributes", () => {
    render(
      <ProgressHeader
        currentIndex={2}
        totalQuestions={10}
        score={200}
        secondsLeft={15}
        timerVisible={true}
        messages={messages}
      />
    );
    expect(screen.getByText("Pergunta 3 de 10")).toBeInTheDocument();
    expect(screen.getByText("Pontos:").parentElement).toHaveTextContent("200");
    expect(screen.getByRole("timer")).toHaveTextContent("Tempo: 15s");

    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "3");
    expect(bar).toHaveAttribute("aria-valuemax", "10");
  });

  it("omits timer when timerVisible is false", () => {
    render(
      <ProgressHeader
        currentIndex={0}
        totalQuestions={10}
        score={0}
        secondsLeft={0}
        timerVisible={false}
        messages={messages}
      />
    );
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });
});
