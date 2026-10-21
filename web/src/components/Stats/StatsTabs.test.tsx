import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatsTabs } from "./StatsTabs";

describe("StatsTabs component", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders all 9 tabs correctly", () => {
    render(<StatsTabs activeTab="overall" onSelect={vi.fn()} locale="en" />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(9);

    const expectedLabels = [
      "Overall",
      "Quiz",
      "Grid",
      "Connections",
      "Guess",
      "Word search",
      "Timeline",
      "Code",
      "Crossword",
    ];

    expectedLabels.forEach((label, index) => {
      expect(tabs[index]).toHaveTextContent(label);
    });
  });

  it("marks the active tab correctly and sets tabIndex appropriately", () => {
    render(<StatsTabs activeTab="overall" onSelect={vi.fn()} locale="en" />);

    const overallTab = screen.getByRole("tab", { name: "Overall" });
    const quizTab = screen.getByRole("tab", { name: "Quiz" });

    // Active tab
    expect(overallTab).toHaveAttribute("aria-selected", "true");
    expect(overallTab).toHaveClass("is-active");
    expect(overallTab).toHaveAttribute("tabindex", "0");

    // Inactive tab
    expect(quizTab).toHaveAttribute("aria-selected", "false");
    expect(quizTab).not.toHaveClass("is-active");
    expect(quizTab).toHaveAttribute("tabindex", "-1");
  });

  it("calls onSelect with the correct id when a tab is clicked", () => {
    const onSelectMock = vi.fn();
    render(<StatsTabs activeTab="overall" onSelect={onSelectMock} locale="en" />);

    const gridTab = screen.getByRole("tab", { name: "Grid" });
    fireEvent.click(gridTab);

    expect(onSelectMock).toHaveBeenCalledTimes(1);
    expect(onSelectMock).toHaveBeenCalledWith("grid");
  });
});
