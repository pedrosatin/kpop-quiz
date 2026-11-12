import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { EntityPicker, type EntityPickerProps } from "./EntityPicker";
import { getMessages } from "../../i18n/catalog";
import type { CandidateEntity } from "../../lib/quiz-types";

const ptMessages = getMessages("pt-BR");

function renderPicker(props: Partial<EntityPickerProps> = {}) {
  return render(
    <EntityPicker
      candidatePool={sampleCandidates}
      usedEntityIds={new Set()}
      onSelectCandidate={vi.fn()}
      onClose={vi.fn()}
      locale="pt-BR"
      messages={ptMessages}
      {...props}
    />
  );
}

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
        rowLabel="Formado nos anos 2010"
        colLabel="JYP Entertainment"
        onSelectCandidate={onSelect}
        onClose={onClose}
        locale="pt-BR"
        messages={ptMessages}
      />
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Escolha um grupo")).toBeInTheDocument();
    expect(screen.getByText("Formado nos anos 2010 e JYP Entertainment")).toBeInTheDocument();
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

    expect(screen.getByText("Usado em outra casa")).toBeInTheDocument();
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
    expect(alert).toHaveTextContent("TWICE: este grupo já está em outra casa.");
  });

  it("keeps space for a uniqueness error before one is shown", () => {
    const { container } = render(
      <EntityPicker
        candidatePool={sampleCandidates}
        usedEntityIds={new Set()}
        onSelectCandidate={vi.fn()}
        onClose={vi.fn()}
        locale="pt-BR"
        messages={ptMessages}
      />
    );

    expect(container.querySelector(".picker-alert-region")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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

    const closeBtn = screen.getByLabelText("Fechar");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);

    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("keeps Tab inside the dialog", () => {
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

    const dialog = screen.getByRole("dialog");
    const search = screen.getByRole("combobox");
    const close = screen.getByLabelText("Fechar");
    expect(search).toHaveFocus();

    // Close comes first in the dialog, the search field last.
    fireEvent.keyDown(search, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(search).toHaveFocus();

    // Focus that escaped to the page is pulled back in.
    document.body.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("points the search field at the highlighted option", () => {
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

    const search = screen.getByRole("combobox", { name: ptMessages.gridPickerSearchLabel });
    expect(search).toHaveAttribute("aria-expanded", "true");
    expect(search).toHaveAttribute("aria-autocomplete", "list");
    expect(search).toHaveAttribute("aria-controls", screen.getByRole("listbox").id);
    // Nothing is highlighted until the player moves or names a group.
    expect(search).not.toHaveAttribute("aria-activedescendant");
    expect(screen.queryByRole("option", { selected: true })).not.toBeInTheDocument();
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(search).toHaveAttribute("aria-activedescendant", "candidate-opt-Q21461452");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(search).toHaveAttribute("aria-activedescendant", "candidate-opt-Q25056705");
    expect(screen.getByRole("option", { name: "BLACKPINK" })).toHaveAttribute("aria-selected", "true");
  });

  it("ignores Enter on Close and a held Enter", () => {
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

    fireEvent.keyDown(screen.getByLabelText("Fechar"), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter", repeat: true });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("sends nothing on Enter with an empty search", () => {
    const onSelect = vi.fn();
    renderPicker({ onSelectCandidate: onSelect });

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("sends the group a search names on Enter, and nothing for a vague search", () => {
    const onSelect = vi.fn();
    const pool: CandidateEntity[] = [
      { id: "Q1", canonical_name: "Super Five", names: { "pt-BR": "Super Five", en: "Super Five" } },
      { id: "Q2", canonical_name: "IVE", names: { "pt-BR": "IVE", en: "IVE" } },
      { id: "Q3", canonical_name: "Olive", names: { "pt-BR": "Olive", en: "Olive" } },
    ];
    renderPicker({ candidatePool: pool, onSelectCandidate: onSelect });
    const search = screen.getByRole("combobox");

    // Every name contains "v" and none is named by it.
    fireEvent.input(search, { target: { value: "v" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();

    // "ive" is in three names but is the whole name of one.
    fireEvent.input(search, { target: { value: "ive" } });
    expect(search).toHaveAttribute("aria-activedescendant", "candidate-opt-Q2");
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith(pool[1]);

    // The only match is named.
    fireEvent.input(search, { target: { value: "oli" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith(pool[2]);
  });

  it("forgets the arrow highlight when the search changes", () => {
    const onSelect = vi.fn();
    renderPicker({ onSelectCandidate: onSelect });
    const search = screen.getByRole("combobox");

    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(search).toHaveAttribute("aria-activedescendant", "candidate-opt-Q21461452");
    fireEvent.input(search, { target: { value: "i" } });
    expect(search).not.toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("marks in words the groups tried in this cell and those used in another", () => {
    renderPicker({
      usedEntityIds: new Set(["Q21461452"]),
      // TWICE was tried here and is now in another cell: that note wins.
      triedEntityIds: new Set(["Q21461452", "Q243884"]),
    });

    const twice = screen.getByRole("option", { name: /TWICE/ });
    const shinee = screen.getByRole("option", { name: /SHINee/ });
    const blackpink = screen.getByRole("option", { name: /BLACKPINK/ });
    expect(twice).toHaveTextContent("TWICEUsado em outra casa");
    expect(shinee).toHaveTextContent("SHINeeJá tentado aqui");
    expect(shinee).toHaveAttribute("aria-disabled", "true");
    expect(blackpink).toHaveTextContent(/^BLACKPINK$/);
    expect(blackpink).toHaveAttribute("aria-disabled", "false");
  });

  it("fits the backdrop to the visual viewport, above a phone keyboard", () => {
    const listeners = new Map<string, () => void>();
    const viewport = {
      height: 508,
      offsetTop: 0,
      addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("visualViewport", viewport);

    const { unmount } = render(
      <EntityPicker
        candidatePool={sampleCandidates}
        usedEntityIds={new Set()}
        onSelectCandidate={vi.fn()}
        onClose={vi.fn()}
        locale="pt-BR"
        messages={ptMessages}
      />
    );

    const backdrop = screen.getByRole("dialog").parentElement!;
    expect(backdrop.style.getPropertyValue("--picker-vv-height")).toBe("508px");

    viewport.height = 400;
    viewport.offsetTop = 30;
    listeners.get("resize")!();
    expect(backdrop.style.getPropertyValue("--picker-vv-height")).toBe("400px");
    expect(backdrop.style.getPropertyValue("--picker-vv-top")).toBe("30px");

    unmount();
    expect(viewport.removeEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
    vi.unstubAllGlobals();
  });
});
