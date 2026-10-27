import { render } from "preact";
import { useEffect } from "preact/hooks";
import { expect, it, vi } from "vitest";
import { drainRenderFrame } from "./drain-render-frame";

it("finishes native after-paint work before the DOM environment is removed", async () => {
  const effect = vi.fn();
  const cancel = vi.spyOn(globalThis, "cancelAnimationFrame");
  const container = document.createElement("div");
  function Probe() {
    useEffect(effect, []);
    return null;
  }

  try {
    // Deliberately bypass act: async component updates can use the native scheduler.
    render(<Probe />, container);
    expect(effect).not.toHaveBeenCalled();
    render(null, container);
    await drainRenderFrame();
    // Unmount drops the effect but does not cancel Preact's fallback timeout.
    // The real frame must cancel that timeout before jsdom closes its window.
    expect(cancel).toHaveBeenCalled();
    expect(effect).not.toHaveBeenCalled();
  } finally {
    render(null, container);
    cancel.mockRestore();
  }
});

it("runs mounted effects rather than discarding pending work", async () => {
  const effect = vi.fn();
  const container = document.createElement("div");
  function Probe() {
    useEffect(effect, []);
    return null;
  }

  try {
    render(<Probe />, container);
    expect(effect).not.toHaveBeenCalled();
    await drainRenderFrame();
    expect(effect).toHaveBeenCalledTimes(1);
  } finally {
    render(null, container);
  }
});
