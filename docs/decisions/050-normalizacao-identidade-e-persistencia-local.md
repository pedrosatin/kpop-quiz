# ADR 050. Identidade canônica no cliente, normalização de nomes e persistência local

## Status

Aprovado em 2026-11-22. Complementa as [ADR 008](008-grade-de-intersecoes.md), [ADR 015](015-contrato-de-dados-do-jogo-de-mapas.md), [ADR 024](024-cruzadinha-diaria-e-unicidade.md), [ADR 026](026-catalogo-estatico-de-perguntas.md) e [ADR 030](030-partida-diaria-por-jogo-e-data.md) sobre contratos de dados no navegador.

## Contexto

Diversos módulos de `web/src/lib/`, `web/src/data/` e `web/src/components/` implementam invariantes entre cliente e artefatos Python que estavam explicados apenas em comentários:

- **Serialização canônica compatível com Python:** para validar `puzzle_id` e `grid_id` no cliente sem depender do formato textual recebido na rede, o algoritmo SHA-256 em JavaScript precisa reproduzir exatamente `json.dumps(..., sort_keys=True, ensure_ascii=True)` do Python, com chaves ordenadas, separadores padrão `", "` e `": "`, e escape `\uXXXX` para caracteres não-ASCII (`code-groups.ts`, `crossword.ts`).
- **Rótulos de exibição sem inferência de caixa:** ao exibir nomes de grupos e pessoas (`display-name.ts`), sufixos desambiguadores da Wikipédia em PT/EN podem ser removidos somente quando não produzem homônimo dentro do mesmo conjunto visível (em comparação case-insensitive `en-US`). Nomes sozinhos (como um tile isolado) preservam o rótulo completo; diferenças de caixa entre `canonical_name` e `label` não são normalizadas automaticamente porque estilizações oficiais como `izna` e `tripleS` dependem de caixa específica e só mudam via tabela revisada `display-label-overrides.json`.
- **Persistência resiliente e isolada em `localStorage`:** navegadores em modo privado, cota cheia de ~5 MiB ou ambiente SSR sem `window` lançam exceções ao ler ou gravar `window.localStorage`. Além disso, cada combinação de filtro do Quiz usa um slot identificado por hash FNV-1a das opções selecionadas (`Quiz/storage.ts`), estados de diálogo destrutivo (`ConfirmDialog`) nunca são persistidos e a Linha do Tempo (`timeline-game-state.ts`, `useTimelineGame.ts`, `timeline-utils.ts`) separa rascunho em edição de resultado submetido.
- **Geometria de seleção no Mapa e Caça-palavras:** a área de toque de países pequenos no mapa (`map-pilot-geometry.ts`) e a interpolação linear de células no Caça-palavras (`WordSearch/geometry.ts`) usam limiares geométricos fixos para manter precisão em telas estreitas e diagonais válidas em 8 direções.

## Decisão

1. **Serialização JSON canônica no cliente:** `canonical` em `code-groups.ts` serializa objetos com chaves ordenadas recursivamente, separadores padrão `", "` / `": "` e escape `\uXXXX` (`[\u007f-\uffff]`), enquanto `crossword.ts` usa separadores compactos `","` / `":"` e UTF-8 bruto (`canonical_json`); ambos espelham exatamente o respectivo gerador Python, e `code-groups.ts` exige `Number.isSafeInteger` no ID de revisão do Wikidata.
2. **Seleção do artefato diário (`daily-artifact.ts`):** a virada diária entre `data/` e `data/next/` usa a data de referência em `America/Sao_Paulo` formatada via `en-CA` (`YYYY-MM-DD`) e permanece fixa durante o carregamento da página.
3. **Desambiguação segura de rótulos (`display-name.ts`):** `resolveDisplayLabels` remove apenas sufixos editoriais conhecidos quando não há colisão no conjunto exibido; `alignLoneLabel` mantém o rótulo completo em contextos isolados; sobrescritas de grafia exigem correspondência exata com o campo `published` em `display-label-overrides.json`.
4. **Wrapper `localStorage` sem exceções (`local-storage.ts`):** `readLocalStorage`, `getLocalStorageItem`, `setLocalStorageItem`, `removeLocalStorageItem` e `listLocalStorageKeys` convertem exceções e ausência de `window` em `{ status: "unavailable" }`, `null`, `false` ou `[]`, deixando esquema e validação com cada jogo (`player-stats.ts`, `code-groups-save.ts`, `crossword-save.ts`, `map-pilot-save.ts`, `Quiz/storage.ts`). Estados transitórios de confirmação (`ConfirmDialog`) permanecem apenas em memória.
5. **Rascunho vs envio e geometria fixa:** saves locais validam versões e campos estritos antes de restaurar progresso, descartando silenciosamente entradas corrompidas sem impedir o jogo do dia.
6. **Jogos graduados nas estatísticas (`player-stats.ts`):** `LATER_GAME_IDS` (mapa, código, cruzadinha, strands) permite importar um arquivo exportado antes do jogo existir; entradas ausentes viram estatísticas zeradas em vez de rejeitar o arquivo inteiro.
7. **Set do dia no mesmo paint do `DailyNext`:** ao montar, o componente inclui o jogo da rota atual em `completedDailyGames` antes de testar o set completo, porque o caminho do mapa (save) pode ainda não ter gravado `lastPlayedDate` nesse frame. Quais jogos entram no set (e a leitura de `daily-set.json`) estão no [ADR 051](051-set-do-dia-com-jogo-omitido.md).
8. **Quiz diário concluído e idioma cruzado:** a tela de diário concluído só mostra o resultado salvo quando ele casa com a sessão publicada na tela; save de outro idioma, de tabuleiro anterior da mesma data ou ausente cai no card compartilhado `DailyDone`. Rounds em andamento no outro idioma ficam no slot daquele idioma — começar aqui não os apaga (`QuizScreen.tsx`, `saved-rounds.ts`).
9. **Identidade do Strands no cliente:** `strands-loader.ts` espelha `canonical_json` do Python (chaves ordenadas, separadores compactos, UTF-8 bruto) ao recomputar `puzzle_id`, no mesmo espírito do item 1 para código e cruzadinha.
10. **Cópia estática do `GameAbout`:** o HTML servido sob cada jogo (`game-about.ts` + `GameAbout.astro`) descreve regras, fontes e FAQ antes de qualquer island; os fatos precisam acompanhar o cron 15:00 UTC, a virada em São Paulo e os geradores em `kpop_scraping/` (incluindo `strands_cli.py`).
11. **Ciclo de vida das métricas (`game-analytics.ts`):** a deduplicação de início e conclusão não depende do consentimento, porque uma atividade nunca é reenviada depois. Um save restaurado marca o jogo como iniciado só até o jogador reiniciar; a rodada seguinte na mesma visita começa e conta de novo. A rodada (`round`) é capturada quando começa, porque gravar o resultado sobrescreve a data da última partida e marca o tabuleiro do dia como jogado. O jogo grava as estatísticas num efeito do mesmo commit, antes ou depois do efeito das métricas conforme o jogo; por isso a leitura que depende delas espera o commit seguinte. A virada do dia segue `America/Sao_Paulo`, como as datas dos tabuleiros.

## Alternativas consideradas

- **Usar `JSON.stringify` padrão para verificar hashes:** falharia sempre que chaves ou caracteres Unicode diferissem da formatação `ensure_ascii=True` do Python.
- **Normalizar caixa automaticamente entre idiomas:** corromperia nomes estilizados como `izna` ou `tripleS`.

## Consequências

- A verificação de integridade dos artefatos diários no cliente continua independente de formatação de whitespace ou ordenação original no arquivo JSON publicado.
- Qualquer alteração no algoritmo de ID em Python exige atualização sincronizada do serializador canônico correspondente em `web/src/`.
