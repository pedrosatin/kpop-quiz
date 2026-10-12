import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatsNavTrigger } from "./StatsNavTrigger";
import { getMessages } from "../../i18n/catalog";
import { act } from "preact/test-utils";

// Mock the StatsModal since we only want to test the trigger's logic
vi.mock("./StatsModal", () => {
  return {
    StatsModal: vi.fn(({ isOpen, initialTab, onClose }) => {
      if (!isOpen) return null;
      return (
        <div data-testid="mock-stats-modal">
          <span data-testid="mock-initial-tab">{initialTab}</span>
          <button data-testid="mock-close-btn" onClick={onClose}>Close</button>
        </div>
      );
    })
  };
});

describe("StatsNavTrigger", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the trigger button correctly", () => {
    // using "en" locale based on the catalog
    const messages = getMessages("en");
    render(<StatsNavTrigger locale="en" />);

    const button = screen.getByRole("button", { name: messages.statsOpenButton });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("id", "stats-open-nav-btn");

    expect(screen.getByText(messages.statsNavLabel)).toBeInTheDocument();
  });

  it("opens the modal with 'overall' tab when clicked", () => {
    const messages = getMessages("en");
    render(<StatsNavTrigger locale="en" />);

    const button = screen.getByRole("button", { name: messages.statsOpenButton });
    fireEvent.click(button);

    expect(screen.getByTestId("mock-stats-modal")).toBeInTheDocument();
    expect(screen.getByTestId("mock-initial-tab")).toHaveTextContent("overall");
  });

  it("opens the modal with 'overall' tab when kpop:open-stats event is dispatched without a specific tab", () => {
    render(<StatsNavTrigger locale="en" />);

    expect(screen.queryByTestId("mock-stats-modal")).not.toBeInTheDocument();

    act(() => {
        const event = new CustomEvent("kpop:open-stats");
        window.dispatchEvent(event);
    });

    expect(screen.getByTestId("mock-stats-modal")).toBeInTheDocument();
    expect(screen.getByTestId("mock-initial-tab")).toHaveTextContent("overall");
  });

  it("opens the modal with specific tab when kpop:open-stats event is dispatched with a detail tab", () => {
    render(<StatsNavTrigger locale="en" />);

    expect(screen.queryByTestId("mock-stats-modal")).not.toBeInTheDocument();

    act(() => {
        const event = new CustomEvent("kpop:open-stats", {
        detail: { tab: "name-guess" }
        });
        window.dispatchEvent(event);
    });

    expect(screen.getByTestId("mock-stats-modal")).toBeInTheDocument();
    expect(screen.getByTestId("mock-initial-tab")).toHaveTextContent("name-guess");
  });

  it("closes the modal when onClose is called", () => {
    render(<StatsNavTrigger locale="en" />);

    act(() => {
        // Open the modal first
        const event = new CustomEvent("kpop:open-stats");
        window.dispatchEvent(event);
    });

    expect(screen.getByTestId("mock-stats-modal")).toBeInTheDocument();

    // Click the mocked close button
    const closeBtn = screen.getByTestId("mock-close-btn");
    fireEvent.click(closeBtn);

    expect(screen.queryByTestId("mock-stats-modal")).not.toBeInTheDocument();
  });

  it("removes event listener on unmount", () => {
    const { unmount } = render(<StatsNavTrigger locale="en" />);

    // Spy on add/remove event listener
    const removeSpy = vi.spyOn(window, "removeEventListener");

    unmount();

    expect(removeSpy).toHaveBeenCalledWith("kpop:open-stats", expect.any(Function));
  });
});
