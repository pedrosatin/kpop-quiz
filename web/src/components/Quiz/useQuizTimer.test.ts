import { act, renderHook } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuizTimer } from "./useQuizTimer";

describe("useQuizTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts down from an absolute deadline when active", async () => {
    const onExpire = vi.fn();
    const deadlineMs = Date.now() + 20_000;
    const { result, rerender } = renderHook(
      ({ active }) => useQuizTimer({ active, deadlineMs, onExpire }),
      { initialProps: { active: false } },
    );

    rerender({ active: true });
    expect(result.current.secondsLeft).toBe(20);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(result.current.secondsLeft).toBe(19);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("keeps the original deadline when the parent re-renders", async () => {
    let expireCallback = vi.fn();
    const deadlineMs = Date.now() + 20_000;
    const { result, rerender } = renderHook(
      ({ onExpire }) => useQuizTimer({ active: true, deadlineMs, onExpire }),
      { initialProps: { onExpire: expireCallback } },
    );

    expect(result.current.secondsLeft).toBe(20);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(result.current.secondsLeft).toBe(20);

    expireCallback = vi.fn();
    rerender({ onExpire: expireCallback });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    expect(result.current.secondsLeft).toBe(19);
  });

  it("calls onExpire once when the deadline has passed", async () => {
    const onExpire = vi.fn();
    const deadlineMs = Date.now() - 500;
    renderHook(() => useQuizTimer({ active: true, deadlineMs, onExpire }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(onExpire).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
