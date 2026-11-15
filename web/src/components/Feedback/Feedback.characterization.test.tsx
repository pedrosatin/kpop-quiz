import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "../../lib/quiz-types";
import { Feedback } from "./Feedback";

// Pins the rendered DOM of every widget state and the exact rating requests,
// so splitting the component can be checked against the code it replaces.

const reply = (status: number, body: unknown) => ({ status, json: async () => body });

type Pending = { resolve: (value: unknown) => void; reject: (reason: unknown) => void };

/** A fetch whose responses the test releases one call at a time. */
function heldFetch() {
  const pending: Pending[] = [];
  const fetcher = vi.fn().mockImplementation(
    (_url: string, init: RequestInit) =>
      new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
        init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, call: (index: number) => pending[index]! };
}

function describeFocus(): string {
  const element = document.activeElement;
  if (!element || element === document.body) return "body";
  const id = element.id ? `#${element.id}` : "";
  return `${element.tagName.toLowerCase()}${id} ${JSON.stringify(element.textContent)}`;
}

/** The widget as the player meets it: markup, focus and the typed comment. */
function capture(container: Element) {
  const textarea = container.querySelector("textarea");
  return { html: container.innerHTML, focus: describeFocus(), comment: textarea ? textarea.value : null };
}

const labels = {
  "pt-BR": { yes: "Gostei", no: "Não gostei", comment: "Comentário opcional", send: "Enviar comentário", thanks: "Obrigado pela resposta!", lang: "pt-BR" },
  en: { yes: "Yes", no: "No", comment: "Optional comment", send: "Send comment", thanks: "Thanks for your feedback!", lang: "en" },
} as const;

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("feedback characterization", () => {
  it.each(["pt-BR", "en"] as const)("renders every state the same way in %s", async (locale: Locale) => {
    const l = labels[locale];
    const { call } = heldFetch();
    const { container } = render(<Feedback locale={locale} site="k_test" />);

    const yes = await screen.findByText(l.yes);
    expect(capture(container)).toMatchSnapshot("01 initial");

    yes.focus();
    fireEvent.click(yes);
    await waitFor(() => expect(screen.getByText(l.yes)).toBeDisabled());
    expect(capture(container)).toMatchSnapshot("02 voting");

    call(0).resolve(reply(500, { ok: false }));
    await screen.findByRole("alert");
    expect(capture(container)).toMatchSnapshot("03 vote error");

    fireEvent.click(screen.getByText(l.yes));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(capture(container)).toMatchSnapshot("04 vote retry");

    call(1).resolve(reply(201, { ok: true, id: "vote-id" }));
    const input = (await screen.findByLabelText(l.comment)) as HTMLTextAreaElement;
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(capture(container)).toMatchSnapshot("05 voted");

    fireEvent.input(input, { target: { value: "  Adorei  " } });
    await waitFor(() => expect(screen.getByText(l.send)).not.toBeDisabled());
    expect(capture(container)).toMatchSnapshot("06 commenting");

    fireEvent.click(screen.getByText(l.send));
    await waitFor(() => expect(input).toBeDisabled());
    expect(capture(container)).toMatchSnapshot("07 sending");

    call(2).reject(new TypeError("Failed to fetch"));
    await screen.findByRole("alert");
    expect(capture(container)).toMatchSnapshot("08 comment error");

    fireEvent.click(screen.getByText(l.send));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(capture(container)).toMatchSnapshot("09 comment retry");

    call(3).resolve(reply(200, { ok: true, id: "vote-id" }));
    await screen.findByText(l.thanks);
    expect(capture(container)).toMatchSnapshot("10 sent");
  });

  it("renders nothing without a site key or after a dismissal", async () => {
    const view = render(<Feedback locale="en" site="" />);
    expect(view.container.innerHTML).toBe("");
    view.rerender(<Feedback locale="en" site="k_test" />);
    fireEvent.click(await screen.findByText("Dismiss"));
    expect(view.container.innerHTML).toBe("");
  });

  it.each(["pt-BR", "en"] as const)("finishes without a comment in %s and remembers it", async (locale: Locale) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(201, { ok: true, id: "vote-id" })));
    const view = render(<Feedback locale={locale} site="k_test" />);
    fireEvent.click(await screen.findByText(labels[locale].yes));
    await screen.findByLabelText(labels[locale].comment);
    fireEvent.click(screen.getByText(locale === "en" ? "Finish without a comment" : "Concluir sem comentário"));
    expect(view.container.innerHTML).toBe("");
    expect(localStorage.getItem("ponder-feedback-dismissed")).toBe("1");
  });

  it.each([
    ["pt-BR", 1, "Gostei"],
    ["en", -1, "No"],
  ] as const)("posts the %s vote %i and its comment with the same request as before", async (locale, vote, button) => {
    const uuid = vi.spyOn(crypto, "randomUUID");
    uuid.mockReturnValueOnce("00000000-0000-4000-8000-000000000001").mockReturnValueOnce("00000000-0000-4000-8000-000000000002");
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(reply(201, { ok: true, id: "vote id/1" }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(reply(503, { ok: false }))
      .mockResolvedValueOnce(reply(200, { ok: true, id: "vote id/1" }));
    vi.stubGlobal("fetch", fetcher);
    render(<Feedback locale={locale} site="k_test" />);

    fireEvent.click(await screen.findByText(button));
    const input = await screen.findByLabelText(labels[locale].comment);
    expect(localStorage.getItem("ponder-feedback-dismissed")).toBe("1");
    fireEvent.input(input, { target: { value: "  Adorei  " } });
    fireEvent.click(screen.getByText(labels[locale].send));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByText(labels[locale].send));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    await screen.findByRole("alert");
    fireEvent.input(input, { target: { value: "Amei" } });
    fireEvent.click(screen.getByText(labels[locale].send));
    await screen.findByText(labels[locale].thanks);

    const init = (body: string) => ({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: expect.any(AbortSignal),
      body,
    });
    const first = '{"comment":"Adorei","nonce":"00000000-0000-4000-8000-000000000001"}';
    expect(fetcher.mock.calls).toStrictEqual([
      ["https://tbbc.app/api/rating", init(`{"site":"k_test","vote":${vote},"section":"quiz-result","app":"ponder-club","lang":"${labels[locale].lang}"}`)],
      ["https://tbbc.app/api/rating/vote%20id%2F1", init(first)],
      ["https://tbbc.app/api/rating/vote%20id%2F1", init(first)],
      ["https://tbbc.app/api/rating/vote%20id%2F1", init('{"comment":"Amei","nonce":"00000000-0000-4000-8000-000000000002"}')],
    ]);
    expect(uuid).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["a different status", reply(200, { ok: true, id: "vote-id" })],
    ["ok other than true", reply(201, { ok: "true", id: "vote-id" })],
    ["no id", reply(201, { ok: true })],
    ["a blank id", reply(201, { ok: true, id: "  " })],
    ["a numeric id", reply(201, { ok: true, id: 7 })],
    ["a null body", reply(201, null)],
    ["a body that is not JSON", { status: 201, json: async () => { throw new SyntaxError("Unexpected token"); } }],
  ])("does not confirm a vote reply with %s", async (_case, response) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    render(<Feedback locale="en" site="k_test" />);
    fireEvent.click(await screen.findByText("Yes"));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't confirm your vote. You can try again, but this may record a duplicate vote.");
    expect(screen.queryByLabelText("Optional comment")).toBeNull();
    expect(localStorage.getItem("ponder-feedback-dismissed")).toBeNull();
  });

  it.each([
    ["the vote status", reply(201, { ok: true, id: "vote-id" })],
    ["another id", reply(200, { ok: true, id: "other-id" })],
    ["ok false", reply(200, { ok: false, id: "vote-id" })],
  ])("does not confirm a comment reply with %s", async (_case, response) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(201, { ok: true, id: "vote-id" })).mockResolvedValueOnce(response));
    render(<Feedback locale="pt-BR" site="k_test" />);
    fireEvent.click(await screen.findByText("Gostei"));
    fireEvent.input(await screen.findByLabelText("Comentário opcional"), { target: { value: "Adorei" } });
    fireEvent.click(screen.getByText("Enviar comentário"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível confirmar o comentário. Tente novamente.");
    expect(screen.queryByText("Obrigado pela resposta!")).toBeNull();
  });

  it("gives up on a vote after ten seconds", async () => {
    const { fetcher } = heldFetch();
    render(<Feedback locale="en" site="k_test" />);
    const yes = await screen.findByText("Yes");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(yes);
    const signal = fetcher.mock.calls[0]![1].signal as AbortSignal;
    vi.advanceTimersByTime(9999);
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(signal.aborted).toBe(true);
    vi.useRealTimers();
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't confirm your vote.");
    expect(screen.getByText("Yes")).not.toBeDisabled();
  });

  it("keeps the send button off for a blank comment", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply(201, { ok: true, id: "vote-id" }));
    vi.stubGlobal("fetch", fetcher);
    render(<Feedback locale="en" site="k_test" />);
    fireEvent.click(await screen.findByText("Yes"));
    fireEvent.input(await screen.findByLabelText("Optional comment"), { target: { value: "   " } });
    await waitFor(() => expect(screen.getByText("Send comment")).toBeDisabled());
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
