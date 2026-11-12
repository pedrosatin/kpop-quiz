import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatsTabs, revealSelectedTab } from "./StatsTabs";

describe("StatsTabs component", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders all 10 tabs correctly", () => {
    render(<StatsTabs activeTab="overall" onSelect={vi.fn()} locale="en" />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(10);

    const expectedLabels = [
      "Overall",
      "Quiz",
      "Grid",
      "Connections",
      "Guess",
      "Word search",
      "Timeline",
      "Map",
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

  describe("revealSelectedTab", () => {
    function listWithSelected(tabLeft: number, tabRight: number) {
      const list = document.createElement("div");
      const tab = document.createElement("button");
      tab.setAttribute("aria-selected", "true");
      list.append(tab);
      list.getBoundingClientRect = () => ({ left: 0, right: 300 }) as DOMRect;
      tab.getBoundingClientRect = () => ({ left: tabLeft, right: tabRight }) as DOMRect;
      list.scrollLeft = 50;
      return list;
    }

    it("scrolls right to show a tab past the right edge", () => {
      const list = listWithSelected(320, 420);
      revealSelectedTab(list);
      expect(list.scrollLeft).toBe(170);
    });

    it("scrolls left to show a tab before the left edge", () => {
      const list = listWithSelected(-30, 40);
      revealSelectedTab(list);
      expect(list.scrollLeft).toBe(20);
    });

    it("leaves a visible tab alone", () => {
      const list = listWithSelected(100, 200);
      revealSelectedTab(list);
      expect(list.scrollLeft).toBe(50);
    });

    it("does nothing without a selected tab", () => {
      const list = document.createElement("div");
      expect(() => revealSelectedTab(list)).not.toThrow();
    });
  });
});
