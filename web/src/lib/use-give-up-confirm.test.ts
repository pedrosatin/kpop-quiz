import { act, renderHook } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { useGiveUpConfirm } from "./use-give-up-confirm";

describe("useGiveUpConfirm", () => {
  it("opens on request and shuts on close without giving up", () => {
    const { result } = renderHook(() => useGiveUpConfirm());
    const giveUp = vi.fn();
    expect(result.current.confirmGiveUpOpen).toBe(false);

    act(() => result.current.requestGiveUp());
    expect(result.current.confirmGiveUpOpen).toBe(true);

    act(() => result.current.closeGiveUpConfirm());
    expect(result.current.confirmGiveUpOpen).toBe(false);
    act(() => result.current.confirmGiveUp(giveUp));
    expect(giveUp).not.toHaveBeenCalled();
  });

  it("shuts the dialog before the game gives up", () => {
    const { result } = renderHook(() => useGiveUpConfirm());
    act(() => result.current.requestGiveUp());
    const { confirmGiveUp } = result.current;
    // A give-up that confirms again finds the dialog shut.
    const giveUp = vi.fn(() => confirmGiveUp(giveUp));

    act(() => confirmGiveUp(giveUp));

    expect(giveUp).toHaveBeenCalledTimes(1);
    expect(result.current.confirmGiveUpOpen).toBe(false);
  });

  it("gives up once for two confirms in the same tick", () => {
    const { result } = renderHook(() => useGiveUpConfirm());
    const giveUp = vi.fn();
    act(() => result.current.requestGiveUp());

    act(() => {
      result.current.confirmGiveUp(giveUp);
      result.current.confirmGiveUp(giveUp);
    });

    expect(giveUp).toHaveBeenCalledTimes(1);
  });

  it("ignores a confirm in the same tick as a close", () => {
    const { result } = renderHook(() => useGiveUpConfirm());
    const giveUp = vi.fn();
    act(() => result.current.requestGiveUp());

    act(() => {
      result.current.closeGiveUpConfirm();
      result.current.confirmGiveUp(giveUp);
    });

    expect(giveUp).not.toHaveBeenCalled();
    expect(result.current.confirmGiveUpOpen).toBe(false);
  });

  // ConfirmDialog reruns its focus effect when onCancel changes.
  it("keeps the same callbacks across renders", () => {
    const { result, rerender } = renderHook(() => useGiveUpConfirm());
    const first = result.current;
    act(() => result.current.requestGiveUp());
    rerender();

    expect(result.current.requestGiveUp).toBe(first.requestGiveUp);
    expect(result.current.closeGiveUpConfirm).toBe(first.closeGiveUpConfirm);
    expect(result.current.confirmGiveUp).toBe(first.confirmGiveUp);
  });
});
