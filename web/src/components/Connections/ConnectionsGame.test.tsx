import { render, screen, fireEvent, cleanup } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import validPuzzleJson from "../../../public/data/connections.daily.json";
import { getMessages } from "../../i18n/catalog";
import type { ConnectionsPuzzle } from "../../lib/quiz-types";
import { ConnectionsGame } from "./ConnectionsGame";

const puzzle = validPuzzleJson as unknown as ConnectionsPuzzle;

describe("ConnectionsGame component integration", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders 16 tiles and controls in pt-BR", () => {
    const messages = getMessages("pt-BR");
    render(<ConnectionsGame locale="pt-BR" puzzle={puzzle} messages={messages} />);

    expect(screen.getByText("4 tentativas restantes")).toBeInTheDocument();
    expect(screen.getByText("Embaralhar")).toBeInTheDocument();
    expect(screen.getByText("Desmarcar tudo")).toBeInTheDocument();
    expect(screen.getByText("Enviar")).toBeInTheDocument();

    // Check that TWICE tile exists
    const twiceBtn = screen.getByRole("button", { name: /TWICE/ });
    expect(twiceBtn).toBeInTheDocument();
    expect(twiceBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("renders in English locale when specified", () => {
    const messages = getMessages("en");
    render(<ConnectionsGame locale="en" puzzle={puzzle} messages={messages} />);

    expect(screen.getByText("4 mistakes remaining")).toBeInTheDocument();
    expect(screen.getByText("Shuffle")).toBeInTheDocument();
    expect(screen.getByText("Deselect all")).toBeInTheDocument();
    expect(screen.getByText("Submit")).toBeInTheDocument();
  });

  it("allows selecting and deselecting tiles via click", () => {
    const messages = getMessages("pt-BR");
    render(<ConnectionsGame locale="pt-BR" puzzle={puzzle} messages={messages} />);

    const twiceBtn = screen.getByRole("button", { name: /TWICE/ });
    expect(twiceBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(twiceBtn);
    expect(twiceBtn).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(twiceBtn);
    expect(twiceBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("deselects all selected items when clicking Desmarcar tudo", () => {
    const messages = getMessages("pt-BR");
    render(<ConnectionsGame locale="pt-BR" puzzle={puzzle} messages={messages} />);

    const twiceBtn = screen.getByRole("button", { name: /TWICE/ });
    const itzyBtn = screen.getByRole("button", { name: /ITZY/ });

    fireEvent.click(twiceBtn);
    fireEvent.click(itzyBtn);
    expect(twiceBtn).toHaveAttribute("aria-pressed", "true");
    expect(itzyBtn).toHaveAttribute("aria-pressed", "true");

    const deselectBtn = screen.getByText("Desmarcar tudo");
    fireEvent.click(deselectBtn);

    expect(twiceBtn).toHaveAttribute("aria-pressed", "false");
    expect(itzyBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("shows solved category banner when correct 4 items are submitted", () => {
    const messages = getMessages("pt-BR");
    render(<ConnectionsGame locale="pt-BR" puzzle={puzzle} messages={messages} />);

    const twiceBtn = screen.getByRole("button", { name: /TWICE/ });
    const itzyBtn = screen.getByRole("button", { name: /ITZY/ });
    const skzBtn = screen.getByRole("button", { name: /Stray Kids/ });
    const wgBtn = screen.getByRole("button", { name: /Wonder Girls/ });

    fireEvent.click(twiceBtn);
    fireEvent.click(itzyBtn);
    fireEvent.click(skzBtn);
    fireEvent.click(wgBtn);

    const submitBtn = screen.getByText("Enviar");
    fireEvent.click(submitBtn);

    expect(screen.getByText("Grupos da JYP Entertainment")).toBeInTheDocument();
    expect(screen.getByText(/Todos os grupos foram formados e gerenciados pela JYP/)).toBeInTheDocument();
  });

  it("shows proximity banner when guess is one away", () => {
    const messages = getMessages("pt-BR");
    render(<ConnectionsGame locale="pt-BR" puzzle={puzzle} messages={messages} />);

    // 3 JYP + 1 SM
    const twiceBtn = screen.getByRole("button", { name: /TWICE/ });
    const itzyBtn = screen.getByRole("button", { name: /ITZY/ });
    const skzBtn = screen.getByRole("button", { name: /Stray Kids/ });
    const exoBtn = screen.getByRole("button", { name: /EXO/ });

    fireEvent.click(twiceBtn);
    fireEvent.click(itzyBtn);
    fireEvent.click(skzBtn);
    fireEvent.click(exoBtn);

    const submitBtn = screen.getByText("Enviar");
    fireEvent.click(submitBtn);

    expect(screen.getByText("Falta 1...")).toBeInTheDocument();
    expect(screen.getByText("3 tentativas restantes")).toBeInTheDocument();
  });
});
