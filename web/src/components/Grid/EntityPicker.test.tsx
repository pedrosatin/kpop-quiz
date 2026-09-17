import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { EntityPicker } from "./EntityPicker";
import { getMessages } from "../../i18n/catalog";
import type { CandidateEntity } from "../../lib/quiz-types";

const ptMessages = getMessages("pt-BR");

const sampleCandidates: CandidateEntity[] = [
  {
    id: "Q21461452",
    canonical_name: "TWICE",
    names: { "pt-BR": "TWICE", en: "TWICE" },
  },
  {
    id: "Q25056705",
    canonical_name: "BLACKPINK",
    names: { "pt-BR": "BLACKPINK", en: "BLACKPINK" },
  },
  {
    id: "Q243884",
    canonical_name: "SHINee",
    names: { "pt-BR": "SHINee", en: "SHINee" },
  },
];

describe("EntityPicker component", () => {
  it("renders search field, criteria hint, and candidate list", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <EntityPicker
        candidatePool={sampleCandidates}
        usedEntityIds={new Set()}
        rowLabel="Estreou nos anos 2010"
        colLabel="JYP Entertainment"
        onSelectCandidate={onSelect}
        onClose={onClose}
        locale="pt-BR"
        messages={ptMessages}
      />
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Selecione o grupo musical")).toBeInTheDocument();
    expect(screen.getByText(/Estreou nos anos 2010 ∩ JYP Entertainment/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Buscar grupo...")).toBeInTheDocument();
    expect(screen.getByText("TWICE")).toBeInTheDocument();
    expect(screen.getByText("BLACKPINK")).toBeInTheDocument();
    expect(screen.getByText("SHINee")).toBeInTheDocument();
  });

  it("filters candidates by search query ignoring case and accents", () => {
    render(
      <EntityPicker
        candidatePool={sampleCandidates}
        usedEntityIds={new Set()}
        onSelectCandidate={vi.fn()}
        onClose={vi.fn()}
        locale="pt-BR"
        messages={ptMessages}
      />
    );

    const input = screen.getByPlaceholderText("Buscar grupo...");
    fireEvent.input(input, { target: { value: "black" } });

    expect(screen.getByText("BLACKPINK")).toBeInTheDocument();
    expect(screen.queryByText("TWICE")).not.toBeInTheDocument();
    expect(screen.queryByText("SHINee")).not.toBeInTheDocument();
  });

  it("shows no matches message when filter has no results", () => {
    render(
      <EntityPicker
        candidatePool={sampleCandidates}
        usedEntityIds={new Set()}
        onSelectCandidate={vi.fn()}
        onClose={vi.fn()}
        locale="pt-BR"
        messages={ptMessages}
      />
    );

    const input = screen.getByPlaceholderText("Buscar grupo...");
    fireEvent.input(input, { target: { value: "Desconhecido" } });

    expect(screen.getByText("Nenhum grupo encontrado.")).toBeInTheDocument();
  });

  it("shows used badge and aria-disabled for already used candidates", () => {
    render(
      <EntityPicker
        candidatePool={sampleCandidates}
        usedEntityIds={new Set(["Q21461452"])}
        onSelectCandidate={vi.fn()}
        onClose={vi.fn()}
        locale="pt-BR"
        messages={ptMessages}
      />
    );

    expect(screen.getByText("Já utilizado")).toBeInTheDocument();
    const twiceOption = screen.getByText("TWICE").closest("li");
    expect(twiceOption).toHaveAttribute("aria-disabled", "true");
  });

  it("displays uniqueness error banner when uniquenessError prop is passed", () => {
    render(
      <EntityPicker
        candidatePool={sampleCandidates}
        usedEntityIds={new Set(["Q21461452"])}
        uniquenessError="TWICE"
        onSelectCandidate={vi.fn()}
        onClose={vi.fn()}
        locale="pt-BR"
        messages={ptMessages}
      />
    );

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent("TWICE: Este grupo já foi utilizado nesta partida.");
  });

  it("calls onSelectCandidate on click and on Enter key", () => {
    const onSelect = vi.fn();
    render(
      <EntityPicker
        candidatePool={sampleCandidates}
        usedEntityIds={new Set()}
        onSelectCandidate={onSelect}
        onClose={vi.fn()}
        locale="pt-BR"
        messages={ptMessages}
      />
    );

    fireEvent.click(screen.getByText("TWICE"));
    expect(onSelect).toHaveBeenCalledWith(sampleCandidates[0]);

    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(sampleCandidates[1]);
  });

  it("closes when close button is clicked or Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <EntityPicker
        candidatePool={sampleCandidates}
        usedEntityIds={new Set()}
        onSelectCandidate={vi.fn()}
        onClose={onClose}
        locale="pt-BR"
        messages={ptMessages}
      />
    );

    const closeBtn = screen.getByLabelText("Fechar seletor");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);

    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
