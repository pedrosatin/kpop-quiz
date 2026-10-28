import { useEffect, useRef, useState } from "preact/hooks";
import type { Locale } from "../../lib/quiz-types";

const API = "https://tbbc.app/api/rating";
const STORAGE = "ponder-feedback-dismissed";
const copy = {
  "pt-BR": { question: "Você gostou desta partida?", yes: "Gostei", no: "Não gostei", dismiss: "Dispensar", notice: "A TBBC recebe e armazena sua resposta. Não inclua dados pessoais no comentário.", comment: "Comentário opcional", send: "Enviar comentário", skip: "Concluir sem comentário", thanks: "Obrigado pela resposta!", voteError: "Não foi possível confirmar o voto. Você pode tentar novamente, mas isso pode registrar um voto duplicado.", commentError: "Não foi possível confirmar o comentário. Tente novamente." },
  en: { question: "Did you enjoy this game?", yes: "Yes", no: "No", dismiss: "Dismiss", notice: "TBBC receives and stores your response. Please don't include personal information in your comment.", comment: "Optional comment", send: "Send comment", skip: "Finish without a comment", thanks: "Thanks for your feedback!", voteError: "We couldn't confirm your vote. You can try again, but this may record a duplicate vote.", commentError: "We couldn't confirm your comment. Please try again." },
};

export function Feedback({ locale, site = import.meta.env.PUBLIC_TBBC_SITE_KEY || "" }: { locale: Locale; site?: string }) {
  const t = copy[locale];
  const [visible, setVisible] = useState(false);
  const [id, setId] = useState("");
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const request = useRef<AbortController | null>(null);
  const attempt = useRef<{ comment: string; nonce: string } | null>(null);
  useEffect(() => {
    try { setVisible(Boolean(site) && localStorage.getItem(STORAGE) !== "1"); } catch { setVisible(Boolean(site)); }
    return () => { const current = request.current; request.current = null; current?.abort(); };
  }, [site]);
  function dismiss() {
    try { localStorage.setItem(STORAGE, "1"); } catch { /* storage is optional */ }
    setVisible(false);
  }
  async function send(path: string, body: object, status: number, accept: (id: string) => void, failure: string) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    setPending(true); setError("");
    try {
      const response = await fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal, body: JSON.stringify(body) });
      const reply = await response.json();
      if (controller.signal.aborted || response.status !== status || reply?.ok !== true || typeof reply.id !== "string" || !reply.id.trim() || (path && reply.id !== id)) throw new Error("unconfirmed");
      if (request.current === controller) accept(reply.id);
    } catch {
      if (request.current === controller) setError(failure);
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) { request.current = null; setPending(false); }
    }
  }
  function vote(vote: 1 | -1) {
    if (id) return;
    void send("", { site, vote, section: "quiz-result", app: "ponder-club", lang: locale === "pt-BR" ? "pt-BR" : "en" }, 201, (receivedId) => { setId(receivedId); try { localStorage.setItem(STORAGE, "1"); } catch { /* optional */ } }, t.voteError);
  }
  function comment() {
    const text = value.trim();
    if (!id || !text || pending) return;
    if (attempt.current?.comment !== text) attempt.current = { comment: text, nonce: crypto.randomUUID() };
    void send(`/${encodeURIComponent(id)}`, attempt.current, 200, () => { setDone(true); try { localStorage.setItem(STORAGE, "1"); } catch { /* optional */ } }, t.commentError);
  }
  if (!visible || !site) return null;
  return <section class="feedback" aria-label={t.question}>
    {done ? <p role="status">{t.thanks}</p> : <>
      <h3>{t.question}</h3><p>{t.notice}</p>
      {!id ? <div class="btn-row"><button class="btn btn-secondary" disabled={pending} onClick={() => vote(1)}>{t.yes}</button><button class="btn btn-secondary" disabled={pending} onClick={() => vote(-1)}>{t.no}</button><button class="btn btn-secondary" disabled={pending} onClick={dismiss}>{t.dismiss}</button></div> : <><label for="feedback-comment">{t.comment}</label><textarea id="feedback-comment" maxLength={1000} value={value} onInput={(event) => setValue(event.currentTarget.value)} disabled={pending} /><div class="btn-row"><button class="btn btn-secondary" disabled={pending || !value.trim()} onClick={comment}>{t.send}</button><button class="btn btn-secondary" disabled={pending} onClick={dismiss}>{t.skip}</button></div></>}
      {error && <p role="alert">{error}</p>}
    </>}
  </section>;
}
