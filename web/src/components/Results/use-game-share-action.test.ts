import { act, renderHook } from "@testing-library/preact";
import { afterEach, expect, it, vi } from "vitest";
import { useGameShareAction } from "./use-game-share-action";

afterEach(() => vi.unstubAllGlobals());
it("allows one share at a time and releases the lock after cancellation", async () => {
  let cancel!: (reason: unknown) => void;
  const share = vi.fn(() => new Promise<void>((_resolve, reject) => { cancel = reject; }));
  vi.stubGlobal("navigator", { share });
  const { result } = renderHook(() => useGameShareAction());
  let pending!: Promise<void>;
  act(() => { pending = result.current.handleShare("result"); });
  await result.current.handleShare("result");
  expect(share).toHaveBeenCalledTimes(1);
  await act(async () => { cancel({ name: "AbortError" }); await pending; });
  act(() => { pending = result.current.handleShare("result"); });
  expect(share).toHaveBeenCalledTimes(2);
  await act(async () => { cancel({ name: "AbortError" }); await pending; });
});
