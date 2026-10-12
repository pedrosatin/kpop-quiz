import { useEffect, useRef, useState } from "preact/hooks";
import "./code-groups.css";

type Symbol = { qid: string; name: string; source: { revision_id: number; locator: string; url: string } };
type Puzzle = { schema_version: string; mode: string; puzzle_id: string; dataset_version: string; reference_date: string; seed: string; symbols: Symbol[]; secret: string[]; max_attempts: number };
type Guess = { ids: string[]; exact: number; misplaced: number };

async function validate(input: unknown): Promise<Puzzle> {
  const p = input as Puzzle;
  const expected = ["schema_version", "mode", "puzzle_id", "dataset_version", "reference_date", "seed", "symbols", "secret", "max_attempts"];
  if (!p || typeof p !== "object" || Object.keys(p).length !== expected.length || !expected.every(k => k in p)
    || p.schema_version !== "code-groups-pilot-v1" || p.mode !== "pilot" || p.max_attempts !== 10
    || ![p.puzzle_id, p.dataset_version, p.seed, p.reference_date].every(s => typeof s === "string" && s.trim())
    || !/^[a-f0-9]{64}$/.test(p.puzzle_id) || !/^[a-f0-9]{64}$/.test(p.dataset_version)
    || !/^\d{4}-\d{2}-\d{2}$/.test(p.reference_date)
    || !Number.isFinite(Date.parse(p.reference_date)) || new Date(p.reference_date).toISOString().slice(0,10) !== p.reference_date
    || !Array.isArray(p.symbols) || p.symbols.length !== 6) throw new Error("Invalid code pilot");
  for (const s of p.symbols) {
    if (!s || Object.keys(s).length !== 3 || typeof s.qid !== "string" || !/^Q[1-9][0-9]*$/.test(s.qid)
      || typeof s.name !== "string" || !s.name.trim() || !s.source || Object.keys(s.source).length !== 3
      || !Number.isSafeInteger(s.source.revision_id) || s.source.revision_id < 1 || s.source.locator !== "claims.P31"
      || s.source.url !== `https://www.wikidata.org/w/index.php?title=${s.qid}&oldid=${s.source.revision_id}`) throw new Error("Invalid group evidence");
  }
  const ids = new Set(p.symbols.map(s => s.qid));
  if (ids.size !== 6 || !Array.isArray(p.secret) || p.secret.length !== 4 || new Set(p.secret).size !== 4
    || !p.secret.every(id => ids.has(id))) throw new Error("Invalid secret");
  // Python identity uses sorted keys and the default JSON separators.
  function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(", ")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}: ${canonical((value as Record<string, unknown>)[key])}`).join(", ")}}`;
    return JSON.stringify(value).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4,"0")}`);
  }
  const content = canonical([p.schema_version,p.dataset_version,p.reference_date,p.seed,p.symbols,p.secret]);
  const digest = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(content));
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,"0")).join("");
  if (hash !== p.puzzle_id) throw new Error("Invalid puzzle identity");
  return p;
}

export function CodeGroups({ locale, artifactUrl }: { locale: "pt-BR" | "en"; artifactUrl: string }) {
  const en = locale === "en";
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selection, setSelection] = useState(["", "", "", ""]);
  const [history, setHistory] = useState<Guess[]>([]);
  const [message, setMessage] = useState("");
  const resultRef = useRef<HTMLElement>(null);
  const won = history.at(-1)?.exact === 4;
  const finished = won || history.length === 10;
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    fetch(artifactUrl, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Missing pilot");
      return validate(await response.json());
    }).then(setPuzzle).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [artifactUrl, retry]);
  useEffect(() => { if (finished) resultRef.current?.focus(); }, [finished]);
  if (failed) return <section id="code-groups" tabIndex={-1} class="code-pilot"><h1>{en ? "Group code" : "Código de grupos"}</h1><p role="alert">{en ? "The pilot could not be loaded. Try again." : "Não foi possível carregar o piloto. Tente novamente."}</p><button class="btn btn-primary" onClick={() => setRetry(retry + 1)}>{en ? "Retry" : "Tentar novamente"}</button></section>;
  if (!puzzle) return <section id="code-groups" tabIndex={-1} class="code-pilot" aria-busy="true"><h1>{en ? "Group code" : "Código de grupos"}</h1><p role="status">{en ? "Loading pilot…" : "Carregando piloto…"}</p></section>;
  const label = (id: string) => puzzle.symbols.find(s => s.qid === id)?.name ?? id;
  function submit(event: Event) {
    event.preventDefault();
    if (finished || !puzzle) return;
    if (selection.some(id => !id)) {
      setMessage(en ? "Choose all four groups. No attempt used." : "Escolha os quatro grupos. Nenhuma tentativa usada.");
      return;
    }
    if (new Set(selection).size !== 4) {
      setMessage(en ? "Choose four different groups. No attempt used." : "Escolha quatro grupos diferentes. Nenhuma tentativa usada.");
      return;
    }
    const exact = selection.filter((id, index) => id === puzzle.secret[index]).length;
    const misplaced = selection.filter(id => puzzle.secret.includes(id)).length - exact;
    const next = [...history, { ids: [...selection], exact, misplaced }];
    setHistory(next);
    setMessage(en ? `Attempt ${next.length}: ${exact} exact, ${misplaced} misplaced. ${10 - next.length} attempts remaining.`
      : `Tentativa ${next.length}: ${exact} exatos, ${misplaced} deslocados. ${10 - next.length} tentativas restantes.`);
  }
  return <section id="code-groups" tabIndex={-1} class="code-pilot" aria-labelledby="code-title">
    <h1 id="code-title">{en ? "Group code" : "Código de grupos"}</h1>
    <p class="code-pilot-label">{en ? "Experimental pilot · fixed sample" : "Piloto experimental · exemplo fixo"}</p>
    <p class="code-intro">{en ? "Find four different groups in the right order." : "Descubra quatro grupos diferentes na ordem certa."}</p>
    <details class="pilot-instructions"><summary>{en ? "How to play" : "Como jogar"}</summary>
      <p>{en ? "Choose four different groups among six symbols in ten attempts. Exact counts correct positions; misplaced counts correct groups in other positions. Feedback does not identify positions." : "Escolha quatro grupos diferentes entre seis símbolos em dez tentativas. Exatos conta posições corretas; deslocados conta grupos corretos em outras posições. O retorno não identifica as posições."}</p>
      <p>{en ? "Groups are symbols in a logic puzzle. Select any position to change its group, using touch or the arrow keys." : "Os grupos são símbolos de um desafio de lógica. Selecione uma posição para trocar o grupo, usando toque ou as setas do teclado."}</p>
    </details>
    <p data-testid="code-remaining">{en ? "Attempts remaining" : "Tentativas restantes"}: {10 - history.length}</p>
    <form onSubmit={submit}>
      <fieldset disabled={finished}><legend>{en ? "Your guess" : "Seu palpite"}</legend>
        <div class="code-slots">{selection.map((value, index) => <label key={index}>
          {en ? "Position" : "Posição"} {index + 1}
          <select value={value} onChange={event => { const next = [...selection]; next[index] = event.currentTarget.value; setSelection(next); setMessage(""); }}>
            <option value="">{en ? "Choose group" : "Escolha um grupo"}</option>
            {puzzle.symbols.map(s => <option value={s.qid} key={s.qid}>{s.name}</option>)}
          </select>
        </label>)}</div>
        <button class="btn btn-primary" type="submit">{en ? "Submit guess" : "Enviar palpite"}</button>
      </fieldset>
    </form>
    <p role="status" aria-live="polite" aria-atomic="true" class="code-feedback">{message}</p>
    <h2>{en ? "Guess history" : "Histórico de palpites"}</h2>
    <ol class="code-history">{history.map((guess, index) => <li key={index}>
      <span>{guess.ids.map(label).join(" / ")}</span>
      <strong>{en ? `${guess.exact} exact · ${guess.misplaced} misplaced` : `${guess.exact} exatos · ${guess.misplaced} deslocados`}</strong>
    </li>)}</ol>
    {finished && <section class="game-result code-result" data-testid="game-result" tabIndex={-1} ref={resultRef} aria-labelledby="code-result-title">
      <h2 id="code-result-title">{won ? (en ? "Code solved!" : "Código descoberto!") : (en ? "Attempts exhausted" : "Tentativas esgotadas")}</h2>
      <p>{en ? "Secret sequence" : "Sequência secreta"}: <strong>{puzzle.secret.map(label).join(" / ")}</strong></p>
      <p>{en ? "Attempts used" : "Tentativas usadas"}: {history.length}/10</p>
      <h3>{en ? "Group classification sources" : "Fontes da classificação dos grupos"}</h3>
      <ul>{puzzle.symbols.map(s => <li key={s.qid}><a href={s.source.url}>{s.name} · Wikidata</a> · {en ? "revision" : "revisão"} {s.source.revision_id}</li>)}</ul>
      <p>Wikidata · CC0</p>
    </section>}
  </section>;
}
