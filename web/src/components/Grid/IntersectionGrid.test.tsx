import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntersectionGrid } from "./IntersectionGrid";
import { getMessages } from "../../i18n/catalog";
import validGridJson from "../../tests/fixtures/grid.daily.json";

const ptMessages = getMessages("pt-BR");

describe("IntersectionGrid orchestrator component", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(validGridJson)))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows loading state then reveals 3x3 board with row and col criteria", async () => {
    render(<IntersectionGrid locale="pt-BR" messages={ptMessages} />);

    expect(screen.getByText(ptMessages.loading)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("grid", { name: "Grade de interseções" })).toBeInTheDocument();
    });

    expect(screen.getByText("9 palpites restantes")).toBeInTheDocument();
    expect(screen.getByText("0 de 9 casas certas")).toBeInTheDocument();

    expect(screen.getByText("Estreou nos anos 2010")).toBeInTheDocument();
    expect(screen.getByText("Estreou nos anos 2000")).toBeInTheDocument();
    expect(screen.getByText("4 integrantes")).toBeInTheDocument();
    expect(screen.getByText("JYP Entertainment")).toBeInTheDocument();
    expect(screen.getByText("SM Entertainment")).toBeInTheDocument();
    expect(screen.getByText("YG Entertainment")).toBeInTheDocument();
  });

  it("handles fetch error and allows retrying", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 }))
    );

    render(<IntersectionGrid locale="pt-BR" messages={ptMessages} />);

    await waitFor(() => {
      expect(screen.getByText(ptMessages.artifactMissing)).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole("button", { name: ptMessages.retry });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(validGridJson)))
    );

    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByRole("grid", { name: "Grade de interseções" })).toBeInTheDocument();
    });
  });

  it("opens entity picker when clicking an empty cell and closes it", async () => {
    render(<IntersectionGrid locale="pt-BR" messages={ptMessages} />);

    await waitFor(() => {
      expect(screen.getByRole("grid")).toBeInTheDocument();
    });

    const cellBtn = screen.getAllByRole("button", { name: /Linha 1/ })[0]!;
    fireEvent.click(cellBtn);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Escolha um grupo")).toBeInTheDocument();

    const closeBtn = screen.getByLabelText("Fechar");
    fireEvent.click(closeBtn);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("submits a correct guess and updates board and score", async () => {
    render(<IntersectionGrid locale="pt-BR" messages={ptMessages} />);

    await waitFor(() => {
      expect(screen.getByRole("grid")).toBeInTheDocument();
    });

    // Cell (0, 0): 2010s + JYP -> TWICE is valid
    const cell00 = screen.getAllByRole("button", { name: /Linha 1/ })[0]!;
    fireEvent.click(cell00);

    const dialog = screen.getByRole("dialog");
    const twiceOption = within(dialog).getByText("TWICE");
    fireEvent.click(twiceOption);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    expect(screen.getByText("8 palpites restantes")).toBeInTheDocument();
    expect(screen.getByText("1 de 9 casas certas")).toBeInTheDocument();
    expect(screen.getByText("TWICE")).toBeInTheDocument();
  });

  it("submits an incorrect guess and marks cell as failed", async () => {
    render(<IntersectionGrid locale="pt-BR" messages={ptMessages} />);

    await waitFor(() => {
      expect(screen.getByRole("grid")).toBeInTheDocument();
    });

    // Cell (0, 0): 2010s + JYP -> SHINee is invalid (SM)
    const cell00 = screen.getAllByRole("button", { name: /Linha 1/ })[0]!;
    fireEvent.click(cell00);

    const dialog = screen.getByRole("dialog");
    const shineeOption = within(dialog).getByText("SHINee");
    fireEvent.click(shineeOption);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    expect(screen.getByText("8 palpites restantes")).toBeInTheDocument();
    expect(screen.getByText("0 de 9 casas certas")).toBeInTheDocument();
    expect(screen.getByText("SHINee")).toBeInTheDocument();
  });

  it("enforces uniqueness: forbids using already chosen group in another cell", async () => {
    render(<IntersectionGrid locale="pt-BR" messages={ptMessages} />);

    await waitFor(() => {
      expect(screen.getByRole("grid")).toBeInTheDocument();
    });

    // Cell (0, 0): choose TWICE (correct)
    const cell00 = screen.getAllByRole("button", { name: /Linha 1/ })[0]!;
    fireEvent.click(cell00);
    const dialog1 = screen.getByRole("dialog");
    fireEvent.click(within(dialog1).getByText("TWICE"));

    await waitFor(() => {
      expect(screen.getByText("1 de 9 casas certas")).toBeInTheDocument();
    });

    // Cell (0, 1): try to pick TWICE again
    const cell01 = screen.getAllByRole("button", { name: /Linha 1.*Coluna 2/ })[0]!;
    fireEvent.click(cell01);

    const dialog2 = screen.getByRole("dialog");
    const twiceOption = within(dialog2).getByText("TWICE");
    fireEvent.click(twiceOption);

    // Should NOT close dialog and should display uniqueness error
    expect(screen.getByRole("alert")).toHaveTextContent("TWICE: este grupo já está em outra casa.");
    expect(screen.getByText("8 palpites restantes")).toBeInTheDocument();
  });

  it("finishes game when all 9 guesses are consumed", async () => {
    render(<IntersectionGrid locale="pt-BR" messages={ptMessages} />);

    await waitFor(() => {
      expect(screen.getByRole("grid")).toBeInTheDocument();
    });

    // Make 9 incorrect guesses
    for (let i = 0; i < 9; i++) {
      const cell = screen.getAllByRole("button", { name: /Linha 1.*Coluna 1/ })[0]!;
      fireEvent.click(cell);
      const dialog = screen.getByRole("dialog");
      // Guess SHINee (incorrect for cell 0,0)
      fireEvent.click(within(dialog).getByText("SHINee"));
    }

    await waitFor(() => {
      expect(screen.getByText("Fim da partida")).toBeInTheDocument();
    });

    expect(screen.getByText("0 de 9 casas certas com 9 palpites")).toBeInTheDocument();
  });
});
