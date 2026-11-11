import { render, screen } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { noteDailyBoard } from "../../data/daily-artifact";
import { StaleDailyNotice } from "./StaleDailyNotice";

describe("StaleDailyNotice", () => {
  it("names the board's date in each locale", () => {
    const board = noteDailyBoard({}, "2026-11-10", "2026-11-11");
    const { unmount } = render(<StaleDailyNotice board={board} locale="pt-BR" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Este é o desafio de 10 de nov. de 2026. O de hoje ainda não saiu.",
    );
    unmount();
    render(<StaleDailyNotice board={board} locale="en" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "This is the challenge from Nov 10, 2026. Today's is not out yet.",
    );
  });

  it("renders nothing for today's board", () => {
    const board = noteDailyBoard({}, "2026-11-11", "2026-11-11");
    const { container } = render(<StaleDailyNotice board={board} locale="pt-BR" />);
    expect(container).toBeEmptyDOMElement();
  });
});
