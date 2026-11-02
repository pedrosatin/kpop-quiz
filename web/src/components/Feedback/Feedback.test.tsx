import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Feedback } from "./Feedback";
const reply = (status: number, body: object) => ({ status, json: async () => body });
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("quiz feedback", () => {
  it("does nothing without a key and remembers dismissal", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const view = render(<Feedback locale="en" site="" />);
    expect(screen.queryByText("Did you enjoy this game?")).toBeNull();
    view.rerender(<Feedback locale="en" site="k_test" />);
    fireEvent.click(await screen.findByText("Dismiss"));
    view.unmount(); render(<Feedback locale="en" site="k_test" />);
    expect(screen.queryByText("Did you enjoy this game?")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("sends only generic metadata and retries a failed comment with the same nonce and vote", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply(201, {ok:true,id:"vote-id"})).mockRejectedValueOnce(new Error()).mockResolvedValueOnce(reply(200,{ok:true,id:"vote-id"}));
    vi.stubGlobal("fetch", fetcher);
    render(<Feedback locale="pt-BR" site="k_test" />);
    fireEvent.click(await screen.findByText("Gostei"));
    const input = await screen.findByLabelText("Comentário opcional");
    fireEvent.input(input, { target: { value: "Comentário" } });
    fireEvent.click(screen.getByText("Enviar comentário"));
    await screen.findByRole("alert");
    expect((input as HTMLTextAreaElement).value).toBe("Comentário");
    fireEvent.click(screen.getByText("Enviar comentário"));
    await screen.findByText("Obrigado pela resposta!");
    expect(localStorage.getItem("ponder-feedback-dismissed")).toBe("1");
    expect(fetcher).toHaveBeenCalledTimes(3);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://tbbc.app/api/rating");
    expect(options.credentials).toBe("omit"); expect(options.referrerPolicy).toBe("no-referrer");
    expect(JSON.parse(options.body)).toEqual({site:"k_test",vote:1,section:"quiz-result",app:"ponder-club",lang:"pt-BR"});
    expect(fetcher.mock.calls[1]![0]).toBe("https://tbbc.app/api/rating/vote-id");
    expect(fetcher.mock.calls[1]![1].body).toBe(fetcher.mock.calls[2]![1].body);
  });
  it.each([ ["pt-BR", "Gostei", "Comentário opcional"], ["en", "Yes", "Optional comment"] ] as const)("focuses the optional comment after a vote in %s", async (locale, vote, label) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(201, {ok:true,id:"vote-id"})));
    render(<Feedback locale={locale} site="k_test" />);
    const button = await screen.findByText(vote);
    button.focus(); fireEvent.click(button);
    const input = await screen.findByLabelText(label);
    await waitFor(() => expect(document.activeElement).toBe(input));
  });
  it("does not steal focus when the player moves elsewhere while the vote is pending", async () => {
    let resolve!: (value: unknown) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise(r => { resolve = r; })));
    render(<><button>Elsewhere</button><Feedback locale="en" site="k_test" /></>);
    const vote = await screen.findByText("Yes"); vote.focus(); fireEvent.click(vote);
    const elsewhere = screen.getByText("Elsewhere"); elsewhere.focus();
    resolve(reply(201, {ok:true,id:"vote-id"}));
    await screen.findByLabelText("Optional comment");
    expect(document.activeElement).toBe(elsewhere);
  });
  it("suppresses the next prompt after a confirmed vote even without a comment", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(201, {ok:true,id:"vote-id"})));
    const view = render(<Feedback locale="en" site="k_test" />);
    fireEvent.click(await screen.findByText("Yes"));
    await screen.findByLabelText("Optional comment");
    view.unmount();
    render(<Feedback locale="en" site="k_test" />);
    expect(screen.queryByText("Did you enjoy this game?")).toBeNull();
  });
  it("does not confirm an invalid response or retry votes automatically", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply(201,{ok:true})); vi.stubGlobal("fetch",fetcher);
    render(<Feedback locale="en" site="k_test" />);
    fireEvent.click(await screen.findByText("No"));
    await screen.findByRole("alert");
    expect(screen.queryByLabelText("Optional comment")).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("aborts and ignores a response when the result is left", async () => {
    let resolve!: (value: unknown) => void;
    const fetcher = vi.fn().mockImplementation(() => new Promise(r => { resolve = r; })); vi.stubGlobal("fetch",fetcher);
    const view = render(<Feedback locale="en" site="k_test" />);
    fireEvent.click(await screen.findByText("Yes"));
    const signal = fetcher.mock.calls[0]![1].signal as AbortSignal;
    view.unmount(); expect(signal.aborted).toBe(true);
    resolve(reply(201,{ok:true,id:"late"}));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  });
});
