import { useEffect, useRef, useState } from 'preact/hooks';
import './crossword.css';
type Locale = 'pt-BR' | 'en';
type Entry = {
    qid: string;
    canonical_name: string;
    aliases: string[];
    answer: string;
    row: number;
    col: number;
    direction: 'across' | 'down';
    number: number;
    clue: Record<Locale, string>;
    matching_qids: string[];
    sources: {
        url: string;
        locator: string;
        snippet: string;
        statement_id: string;
    }[];
};
type Cell = {
    row: number;
    col: number;
    answer: string;
};
type Puzzle = {
    schema_version: string;
    mode: string;
    puzzle_id: string;
    dataset_version: string;
    reference_date: string;
    rows: number;
    cols: number;
    vocabulary: string[];
    entries: Entry[];
    cells: Cell[];
};
const normalize = (value: string) => value.normalize('NFKD').replace(/[^\x00-\x7f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const key = (r: number, c: number) => `${r}:${c}`;
const position = (e: Entry, i: number) => key(e.row + (e.direction === 'down' ? i : 0), e.col + (e.direction === 'across' ? i : 0));
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,canonical(v)]));
    return value;
}
async function parse(value: unknown): Promise<Puzzle> {
    const p = value as Puzzle;
    if (!p || p.schema_version !== 'crossword-pilot-v1' || p.mode !== 'pilot' || p.puzzle_id !== 'crossword-audited-01' || !/^[a-f0-9]{64}$/.test(p.dataset_version) || !/^\d{4}-\d{2}-\d{2}$/.test(p.reference_date) || !Number.isInteger(p.rows) || !Number.isInteger(p.cols) || p.rows < 1 || p.cols < 1 || p.rows > 9 || p.cols > 9 || !Array.isArray(p.entries) || p.entries.length < 3 || p.entries.length > 5 || !Array.isArray(p.cells) || !Array.isArray(p.vocabulary))
        throw Error('invalid puzzle');
    const parsedDate = new Date(`${p.reference_date}T00:00:00Z`);
    if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0,10)!==p.reference_date) throw Error('invalid date');
    const {dataset_version,...content} = p;
    const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(content))));
    if ([...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('')!==dataset_version) throw Error('checksum mismatch');
    const expected = new Map<string, string>();
    const owners = new Map<string, Entry[]>();
    const names = new Map<string, string>();
    const ids = new Set<string>();
    const starts = [...new Set(p.entries.map(e => key(e.row, e.col)))].sort((a, b) => { const [ar, ac] = a.split(':').map(Number) as [
        number,
        number
    ], [br, bc] = b.split(':').map(Number) as [
        number,
        number
    ]; return ar - br || ac - bc; });
    for (const e of p.entries) {
        if (!/^Q[1-9][0-9]*$/.test(e.qid) || ids.has(e.qid) || typeof e.canonical_name !== 'string' || !e.answer || normalize(e.canonical_name) !== e.answer || !Array.isArray(e.aliases) || !['across', 'down'].includes(e.direction) || !Number.isInteger(e.row) || !Number.isInteger(e.col) || e.number !== starts.indexOf(key(e.row, e.col)) + 1 || !e.clue || !['pt-BR', 'en'].every(l => typeof e.clue[l as Locale] === 'string' && e.clue[l as Locale].trim()) || !Array.isArray(e.matching_qids) || e.matching_qids.length !== 1 || e.matching_qids[0] !== e.qid || !Array.isArray(e.sources) || !e.sources.length)
            throw Error('invalid entry');
        ids.add(e.qid);
        for (const name of [e.canonical_name, ...e.aliases]) {
            if (typeof name !== 'string')
                throw Error('invalid alias');
            const n = normalize(name);
            if (n && names.has(n) && names.get(n) !== e.qid)
                throw Error('ambiguous alias');
            names.set(n, e.qid);
        }
        for (const source of e.sources) {
            const url = source.url.match(/^https:\/\/([a-z]{2,3}(?:-[a-z]+)?).wikipedia.org\/w\/index.php\?curid=([1-9][0-9]*)&oldid=([1-9][0-9]*)$/);
            const locator = source.locator.match(/^wikipedia:([a-z]{2,3}(?:-[a-z]+)?):pageid=([1-9][0-9]*):revid=([1-9][0-9]*)#(?:extract|wikitext)\[(\d+):(\d+)\]$/);
            if (!url || !locator || url.slice(1).join(':')!==locator.slice(1,4).join(':') || Number(locator[4])>=Number(locator[5]) || typeof source.snippet!=='string' || !source.snippet || typeof source.statement_id!=='string' || !source.statement_id.startsWith(e.qid+'$')) throw Error('invalid evidence');
        }
        for (let i = 0; i < e.answer.length; i++) {
            const cell = position(e, i), [r, c] = cell.split(':').map(Number) as [
                number,
                number
            ];
            if (r < 0 || r >= p.rows || c < 0 || c >= p.cols || (expected.has(cell) && (expected.get(cell) !== e.answer[i] || owners.get(cell)!.some(other => other.direction === e.direction))))
                throw Error('invalid crossing');
            expected.set(cell, e.answer[i]!);
            owners.set(cell, [...(owners.get(cell) ?? []), e]);
        }
    }
    const reached = new Set([p.entries[0]!.qid]);
    for (const _ of p.entries)
        for (const group of owners.values())
            if (group.some(e => reached.has(e.qid)))
                group.forEach(e => reached.add(e.qid));
    if (reached.size !== ids.size || JSON.stringify([...ids].sort()) !== JSON.stringify(p.vocabulary) || expected.size !== p.cells.length || new Set(p.cells.map(c => key(c.row, c.col))).size !== p.cells.length || p.cells.some(c => expected.get(key(c.row, c.col)) !== c.answer))
        throw Error('invalid board');
    return p;
}
const copy = {
    'pt-BR': { loading: 'Carregando cruzadinha…', error: 'Não foi possível carregar a cruzadinha. Tente novamente.', retry: 'Tentar novamente', check: 'Verificar respostas', reveal: 'Encerrar e ver respostas', wrong: 'Algumas respostas estão incompletas ou incorretas. Você pode continuar.', won: 'Cruzadinha concluída!', ended: 'Partida encerrada. Respostas reveladas.', sources: 'Respostas e fontes', across: 'Horizontal', down: 'Vertical', cell: 'Linha', column: 'coluna', rule: 'Preencha a grade com os nomes dos grupos. Escreva sem espaços, pontuação ou acentos e mantenha os números. Clique ou toque em uma pista para escolher a palavra. No teclado, use Tab para trocar de quadrado e as setas para mover. Você pode conferir as respostas quantas vezes quiser.' },
    en: { loading: 'Loading crossword…', error: 'The crossword could not be loaded. Try again.', retry: 'Try again', check: 'Check answers', reveal: 'Finish and see answers', wrong: 'Some answers are incomplete or incorrect. You can keep editing.', won: 'Crossword completed!', ended: 'Round ended. Answers revealed.', sources: 'Answers and sources', across: 'Across', down: 'Down', cell: 'Row', column: 'column', rule: 'Fill the squares with group names. Leave out spaces, punctuation and accents, but keep numbers. Click or tap a clue to choose a word. On a keyboard, use Tab to switch squares and the arrow keys to move. You can check your answers as often as you like.' }
};
export function CrosswordGame({ locale }: {
    locale: Locale;
}) {
    const t = copy[locale];
    const [p, setPuzzle] = useState<Puzzle | null>(null), [error, setError] = useState(false), [reload, setReload] = useState(0);
    const [values, setValues] = useState<Record<string, string>>({}), [active, setActive] = useState(0), [message, setMessage] = useState(''), [finished, setFinished] = useState(false);
    const inputs = useRef<Record<string, HTMLInputElement | null>>({});
    const result = useRef<HTMLDivElement | null>(null);
    useEffect(() => { if (finished) result.current?.focus(); }, [finished]);
    useEffect(() => {
        const abort = new AbortController();
        setError(false);
        setPuzzle(null);
        fetch(`${import.meta.env.BASE_URL.replace(/\/$/, '')}/data/crossword-pilot.json`, { signal: abort.signal }).then(r => { if (!r.ok)
            throw Error('missing'); return r.json(); }).then(async raw => { setPuzzle(await parse(raw)); setValues({}); setFinished(false); setMessage(''); }).catch(e => { if (e.name !== 'AbortError')
            setError(true); });
        return () => abort.abort();
    }, [reload]);
    if (error)
        return <section id="crossword" tabIndex={-1} class="crossword"><p role="alert">{t.error}</p><button class="btn btn-primary" onClick={() => setReload(reload + 1)}>{t.retry}</button></section>;
    if (!p)
        return <section id="crossword" tabIndex={-1} class="crossword" aria-busy="true"><p role="status">{t.loading}</p></section>;
    const selected = p.entries[active] ?? p.entries[0]!;
    const select = (i: number) => { const input = inputs.current[position(p.entries[i]!, 0)]; input?.focus(); input?.select(); setActive(i); };
    const check = () => { if (p.cells.every(c => values[key(c.row, c.col)] === c.answer)) {
        setFinished(true);
        setMessage(t.won);
    }
    else
        setMessage(t.wrong); };
    return <section id="crossword" tabIndex={-1} class="crossword" aria-label={locale === 'en' ? 'Crossword' : 'Cruzadinha'}>
    <p class="pilot-label">{locale === 'en' ? 'Use the clues to fill in the group names.' : 'Use as pistas para preencher os nomes dos grupos.'}</p>
    <details class="pilot-instructions"><summary>{locale === 'en' ? 'How to play' : 'Como jogar'}</summary><p id="crossword-rules">{t.rule}</p><p>{locale === 'en' ? 'The names and clues are the same every time you play. Some clues refer to past group lineups. Check the sources when you finish.' : 'Os nomes e as pistas são os mesmos em todas as partidas. Algumas pistas se referem a formações anteriores dos grupos. Veja as fontes ao terminar.'}</p></details>
    <div class="crossword-play">
    <div class="crossword-grid" style={{ gridTemplateColumns: `repeat(${p.cols}, minmax(0, 3rem))` }} aria-describedby="crossword-rules">
      {Array.from({ length: p.rows * p.cols }, (_, index) => {
            const r = Math.floor(index / p.cols), c = index % p.cols, k = key(r, c), cell = p.cells.find(x => x.row === r && x.col === c);
            if (!cell)
                return <span class="crossword-block" aria-hidden="true"/>;
            const starts = p.entries.find(e => e.row === r && e.col === c);
            const highlighted = Array.from({ length: selected.answer.length }, (_, i) => position(selected, i)).includes(k);
            const clues = p.entries.filter(e => Array.from({ length: e.answer.length }, (_, i) => position(e, i)).includes(k));
            return <label class={`crossword-cell ${highlighted ? 'selected' : ''}`}>
          {starts && <span aria-hidden="true">{starts.number}</span>}
          <input ref={el => { inputs.current[k] = el; }} aria-label={`${t.cell} ${r + 1}, ${t.column} ${c + 1}. ${clues.map(e => `${e.number} ${e.direction === 'across' ? t.across : t.down}`).join('; ')}`} value={finished ? cell.answer : values[k] ?? ''} disabled={finished} autoComplete="off" autoCapitalize="characters" spellcheck={false} inputMode="text" onFocus={event => { event.currentTarget.select(); if (!clues.includes(selected))
                setActive(p.entries.indexOf(clues[0]!)); }} onInput={event => {
                    const letters = normalize(event.currentTarget.value), offset = Array.from({ length: selected.answer.length }, (_, i) => position(selected, i)).indexOf(k);
                    const updates: Record<string, string> = {};
                    for (let i = 0; i < Math.max(1, letters.length) && offset + i < selected.answer.length; i++)
                        updates[position(selected, offset + i)] = letters[i] ?? '';
                    setValues({ ...values, ...updates });
                    setMessage('');
                    if (letters)
                        inputs.current[position(selected, Math.min(offset + letters.length, selected.answer.length - 1))]?.focus();
                }} onKeyDown={event => {
                    const delta: Record<string, [
                        number,
                        number
                    ]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
                    if (delta[event.key]) {
                        event.preventDefault();
                        const [dr, dc] = delta[event.key]!;
                        for (let step = 1; step < 10; step++) {
                            const rr = r + dr * step, cc = c + dc * step;
                            if (rr < 0 || rr >= p.rows || cc < 0 || cc >= p.cols)
                                break;
                            const next = inputs.current[key(rr, cc)];
                            if (next) {
                                next.focus();
                                break;
                            }
                        }
                    }
                }}/>
        </label>;
        })}
    </div>
    <ol class="crossword-clues">{p.entries.map((e, i) => <li><button class="btn btn-secondary" type="button" aria-pressed={active === i} onClick={() => select(i)} disabled={finished}>{e.number} {e.direction === 'across' ? t.across : t.down}: {e.clue[locale]} ({e.answer.length})</button></li>)}</ol>
    </div>
    <div class="crossword-actions"><button class="btn btn-primary" onClick={check} disabled={finished}>{t.check}</button><button class="btn btn-secondary" onClick={() => { setFinished(true); setMessage(t.ended); }} disabled={finished}>{t.reveal}</button><p role="status" aria-live="polite">{message}</p></div>
    {finished && <div class="crossword-result" data-testid="game-result" tabIndex={-1} ref={result} role="region" aria-labelledby="crossword-result-title"><h2 id="crossword-result-title">{t.sources}</h2><ol>{p.entries.map(e => <li><strong>{e.canonical_name}</strong>, {e.clue[locale]}<ul>{e.sources.map(s => <li><a href={s.url} target="_blank" rel="noopener noreferrer">Wikipedia · {locale === 'en' ? 'revision' : 'revisão'} {new URL(s.url).searchParams.get('oldid')}</a><p>{s.snippet}</p></li>)}</ul></li>)}</ol></div>}
  </section>;
}
