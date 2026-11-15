import { act, render, renderHook } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { getMessages } from "../../i18n/catalog";
import { WordSearchShareNote, useShareNote, type ShareNote } from "./word-search-share-note";

const pt = getMessages("pt-BR");

function renderNote(note: ShareNote | null) {
  const view = render(<WordSearchShareNote note={note} messages={pt} />);
  return {
    paragraph: () => view.container.querySelector("p"),
    rerender: (next: ShareNote | null) =>
      view.rerender(<WordSearchShareNote note={next} messages={pt} />),
  };
}

describe("useShareNote", () => {
  it("counts every share, copied or failed", () => {
    const { result } = renderHook(() => useShareNote());
    expect(result.current.shareNote).toBeNull();

    act(() => result.current.onCopied());
    expect(result.current.shareNote).toEqual({ kind: "copied", n: 1 });
    act(() => result.current.onShareFailed());
    expect(result.current.shareNote).toEqual({ kind: "shareFailed", n: 2 });
    act(() => result.current.onCopied());
    expect(result.current.shareNote).toEqual({ kind: "copied", n: 3 });
  });
});

describe("WordSearchShareNote", () => {
  it("says nothing before a share", () => {
    expect(renderNote(null).paragraph()).toBeNull();
  });

  it("puts a new paragraph in place of the old one on a second copy", () => {
    const view = renderNote({ kind: "copied", n: 1 });
    const first = view.paragraph();
    expect(first).toHaveTextContent(pt.copiedToClipboard);

    view.rerender({ kind: "copied", n: 2 });

    const second = view.paragraph();
    expect(second).toHaveTextContent(pt.copiedToClipboard);
    expect(second).not.toBe(first);
    expect(first).not.toBeInTheDocument();
  });

  it("puts a new paragraph in place of the old one on a second failure", () => {
    const view = renderNote({ kind: "shareFailed", n: 1 });
    const first = view.paragraph();
    expect(first).toHaveTextContent(pt.shareFailed);

    view.rerender({ kind: "shareFailed", n: 2 });

    const second = view.paragraph();
    expect(second).toHaveTextContent(pt.shareFailed);
    expect(second).not.toBe(first);
  });

  it("keeps the paragraph when the same note renders again", () => {
    const view = renderNote({ kind: "copied", n: 1 });
    const first = view.paragraph();

    view.rerender({ kind: "copied", n: 1 });

    expect(view.paragraph()).toBe(first);
  });
});
