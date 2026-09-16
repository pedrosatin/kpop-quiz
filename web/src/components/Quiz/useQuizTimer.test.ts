import { act, renderHook } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuizTimer } from "./useQuizTimer";

describe("useQuizTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts down seconds when active", async () => {
    const onExpire = vi.fn();
    const { result, rerender } = renderHook(
      ({ active }) => useQuizTimer({ active, initialSeconds: 20, onExpire }),
      { initialProps: { active: false } }
    );

    act(() => {
      result.current.setSecondsLeft(20);
    });
    rerender({ active: true });

    expect(result.current.secondsLeft).toBe(20);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(result.current.secondsLeft).toBe(19);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("does not restart 1s timeout when onExpire reference changes", async () => {
    let expireCallback = vi.fn();
    const { result, rerender } = renderHook(
      ({ onExpire }) => useQuizTimer({ active: true, initialSeconds: 20, onExpire }),
      { initialProps: { onExpire: expireCallback } }
    );

    act(() => {
      result.current.setSecondsLeft(20);
    });

    // Advance 600ms
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(result.current.secondsLeft).toBe(20);

    // Provide a new onExpire reference (simulating parent re-render due to selection or clues)
    expireCallback = vi.fn();
    rerender({ onExpire: expireCallback });

    // Advance remaining 400ms (total 1000ms from start)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    // It should have completed the second without restarting from 0ms!
    expect(result.current.secondsLeft).toBe(19);
  });

  it("calls latest onExpire when secondsLeft reaches zero", async () => {
    const onExpire = vi.fn();
    const { result } = renderHook(() =>
      useQuizTimer({ active: true, initialSeconds: 20, onExpire })
    );

    act(() => {
      result.current.setSecondsLeft(0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
