import { fireEvent, render } from "@testing-library/preact";
import { useRef, useState } from "preact/hooks";
import { describe, expect, it, vi } from "vitest";
import { useFocusOnChange } from "./use-focus-on-change";

function Harness({ initialActive = false }: { initialActive?: boolean }) {
  const [active, setActive] = useState(initialActive);
  const [step, setStep] = useState(0);
  const [, setRenders] = useState(0);
  const target = useRef<HTMLButtonElement>(null);
  useFocusOnChange(target, active, step);
  return (
    <>
      <button type="button" onClick={() => setActive(true)}>answer</button>
      <button type="button" onClick={() => setActive(false)}>reset</button>
      <button type="button" onClick={() => setStep((value) => value + 1)}>step</button>
      <button type="button" onClick={() => setRenders((value) => value + 1)}>bump</button>
      <button type="button" ref={target}>next</button>
    </>
  );
}

describe("useFocusOnChange", () => {
  it("leaves focus alone while inactive", () => {
    const { getByText } = render(<Harness />);
    getByText("step").focus();
    fireEvent.click(getByText("step"));
    expect(document.activeElement).toBe(getByText("step"));
  });

  it("focuses the target when it turns active", () => {
    const { getByText } = render(<Harness />);
    getByText("answer").focus();
    fireEvent.click(getByText("answer"));
    expect(document.activeElement).toBe(getByText("next"));
  });

  it("focuses again when the step changes while active", () => {
    const { getByText } = render(<Harness initialActive />);
    expect(document.activeElement).toBe(getByText("next"));
    getByText("step").focus();
    fireEvent.click(getByText("step"));
    expect(document.activeElement).toBe(getByText("next"));
  });

  it("does not steal focus back after it turns inactive", () => {
    const { getByText } = render(<Harness initialActive />);
    getByText("reset").focus();
    fireEvent.click(getByText("reset"));
    expect(document.activeElement).toBe(getByText("reset"));
  });

  it("leaves focus alone on a re-render with the same active and step", () => {
    const { getByText } = render(<Harness initialActive />);
    expect(document.activeElement).toBe(getByText("next"));
    getByText("answer").focus();
    // Neither click changes active or step, but "bump" forces a re-render.
    fireEvent.click(getByText("answer"));
    fireEvent.click(getByText("bump"));
    expect(document.activeElement).toBe(getByText("answer"));
  });

  it("focuses without scrolling", () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    try {
      render(<Harness initialActive />);
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    } finally {
      focus.mockRestore();
    }
  });
});
