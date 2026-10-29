# Cruzadinha

## Jogo

As rotas `/pt-br/cruzadinha/` e `/en/crossword/` apresentam a grade do dia,
com 3 a 5 grupos de K-pop que se cruzam nas letras em comum, até 9×9, sem
repetir grupos da véspera. Cada pista traz um ou dois fatos do grupo, como o ano de formação, a
gravadora ou um integrante, e aponta para a revisão da Wikipédia que sustenta cada fato. O
jogador escolhe a palavra pela pista, digita por célula e confere a grade
quantas vezes quiser. "Verificar respostas" com tudo certo encerra a partida
como resolvida; "Revelar respostas" encerra na hora e mostra os nomes.

A tela segue o contrato dos jogos. O `.page-shell` leva o `GameIntro`. A grade
fica à esquerda e o painel lateral, com as pistas e a barra de ação, aparece a
partir de 60rem. No celular a barra `.game-actions` fica fixa no rodapé, com a
mensagem em uma região `aria-live`. O foco vai para o título do resultado só
quando a partida termina nesta visita (`useFocusOnChange`). O painel "Ver
fonte" mostra o trecho e o link de cada revisão, e um campo de texto aparece
quando o compartilhamento e a cópia falham. No celular o quadrado tem 3rem
(campo de 44px). Ao lado do painel ele cresce com `--play-max-h` até 3,5rem.

A cruzadinha entrou no ar como piloto `noindex` em `/pt-br/cruzadinha-piloto/`
e `/en/crossword-pilot/` e foi promovida segundo o checklist da
[ADR 023](decisions/023-promocao-de-piloto-a-jogo.md). As rotas antigas
respondem `301` no Cloudflare Pages pelo `web/public/_redirects`.

## Artefato diário

O runner diário (`kpop_scraping/daily_puzzles_runner.py`) publica
`web/public/data/crossword.daily.json`, um envelope `crossword-daily-v1`
(`schemas/crossword-daily-v1.json`) gerado por
`kpop_scraping/crossword_daily.py` com seed `kpop-crossword-daily`; o checksum
do envelope cobre a data. Com `--ahead`, o dia seguinte vai para
`web/public/data/next/`. Regras do gerador e da prova estão na
[ADR 024](decisions/024-cruzadinha-diaria-e-unicidade.md) e em
[Cruzadinha diária](crossword-daily.md).

Cada conjunto publicado traz também `crossword-publication.<data>.json`
(`kpop_scraping/crossword_publication.py`, versão
`kpop-crossword-publication-v1`): estado (`played` ou `omitted`), QIDs
publicados, checksum do artefato, identidade da base, histórico consumido e,
numa omissão, o motivo. Os registros ficam acumulados em `web/public/data/`,
como os de `grid-publication.<data>.json`, e o dia seguinte é gerado a partir
do registro confirmado da véspera, nunca de um arquivo ausente lido como dia
vazio.

### Política de falha

A falha omite somente a cruzadinha; os outros jogos do dia saem normalmente.

- Sem registro da véspera, o dia não gera grade e registra `omitted` com o
  motivo `missing previous-day crossword history`. Esse registro é histórico
  real (nada foi publicado), então o dia seguinte volta a gerar.
- Base ilegível ou erro do gerador: o dia registra `omitted` com o erro.
- Tentativas esgotadas: o envelope `status: omitted`, `puzzle: null` é
  publicado, e a página sabe que o dia foi omitido.
- Nenhuma grade anterior é reaproveitada nem ganha identidade nova. Um arquivo
  de dia anterior é removido de `data/` quando o dia sai sem grade.
- Um dia promovido de `next/` cuja grade foi preparada com um histórico que não
  bate mais com o registro confirmado da véspera (a véspera foi publicada de
  novo) é gerado outra vez com o histórico confirmado, ou omitido.

Antes do primeiro registro, o site servia o tabuleiro auditado todos os dias.
Enquanto não existe nenhum `crossword-publication.*.json` no diretório,
`crossword-pilot.json` válido vale como a partida da véspera (`source:
pilot`), e um conjunto antigo mantido ou promovido recebe esse registro. Depois
do primeiro registro, um registro ausente continua ausente. Perda de histórico
exige restaurar os arquivos ou declarar o registro à mão, validado por
`validate_record`.

### Verificação

`python -m kpop_scraping.web_publish --output-dir web/public/data --verify`
valida o envelope com as regras que não dependem da base (campos, checksum,
histórico, contagem de tentativas, geometria, numeração, forma da prova e
exclusão da véspera), exige o registro do dia com os mesmos QIDs, checksum,
base e histórico, valida todos os registros e recusa dois dias consecutivos
jogados com grupo em comum, inclusive entre `data/` e `next/`.
`--require-crossword` torna o arquivo obrigatório. O runner recalcula a
correspondência factual e a prova contra a base antes de gravar.

### Página

`loadCrosswordPuzzle()` em `web/src/data/crossword.ts` lê `data/` e, se ali não
houver o dia de hoje, `data/next/`. Só a grade datada de hoje joga. Sem ela, a
página mostra "A cruzadinha de hoje ainda não foi publicada"; com o dia
omitido, "Não há cruzadinha hoje"; com arquivo inválido, o erro de carga com
nova tentativa. `validateCrosswordDaily()` espelha `validate_published()` e
reaproveita as regras de domínio da grade de `validateCrosswordPuzzle()`.

### Tabuleiro auditado

`web/public/data/crossword-pilot.json` segue o contrato `crossword-pilot-v1`
(`schemas/crossword-pilot-v1.json`). A página não o carrega mais. Ele continua
publicado como história do lançamento e como fixture dos testes web e e2e, que
o embrulham num envelope diário de hoje (`web/src/test/crossword-daily-fixture.ts`).
`validate()` em `kpop_scraping/crossword_cli.py` e `validateCrosswordPuzzle()`
rejeitam os mesmos casos, lidos de `tests/fixtures/crossword_invalid_cases.json`.

```bash
python -m kpop_scraping.crossword_cli --verify web/public/data/crossword-pilot.json
```

## Persistência, estatísticas e compartilhamento

### Progresso

O progresso fica no `localStorage`, na chave `kpop-crossword-<dataset_version>`
(checksum do envelope do dia), com as letras digitadas, o número de
verificações e o estado (`playing`, `won` ou `revealed`). O jogo descarta um
registro com quadrado fora da grade, com mais de um caractere por quadrado ou
com vitória que as letras não resolvem. Ao carregar, ele apaga os registros de
outros dias, e uma grade nova começa limpa.

### Estatísticas

A partida concluída entra uma única vez, marcada por
`kpop-match-recorded-crossword-crossword-<dataset_version>`, com a data local do
dia em que o jogador terminou. Resolver conta como vitória, e revelar conta como
partida sem vitória. "Jogar novamente" limpa o progresso, mas não conta de novo.
A aba "Cruzadinha" / "Crossword" aparece na janela de estatísticas.

### GA4

O jogo envia `game_start` na primeira ação, `game_complete` no fim da partida
jogada nesta visita e `share` no compartilhamento, só com consentimento. Ele não
repete eventos ao restaurar uma partida salva.

### Compartilhamento

O texto traz "K-pop Crossword" com a data da grade, o veredito ("Resolvida em
N verificações." ou "X de Y palavras certas antes de encerrar.") e um quadrado
por palavra na ordem das pistas (🟩 palavra certa, ⬜ o resto). Não leva
respostas, e o link usa `utm_campaign=crossword`.

## Arquivos

- `kpop_scraping/crossword_daily.py` gera e valida o envelope diário;
  `kpop_scraping/crossword_publication.py` guarda e confere o histórico;
  `kpop_scraping/daily_puzzles_runner.py` publica os dois.
- `kpop_scraping/crossword_cli.py` seleciona e verifica o tabuleiro auditado.
- `schemas/crossword-daily-v1.json` e `schemas/crossword-pilot-v1.json` são os
  contratos versionados.
- `web/src/data/crossword.ts` valida e carrega o artefato do dia.
- `web/src/components/Crossword/crossword-save.ts` guarda e valida o progresso.
- `web/src/components/Crossword/useCrosswordGame.ts` guarda o estado, as
  estatísticas e os eventos de GA4.
- `web/src/components/Crossword/CrosswordGameContent.tsx` renderiza a grade, as
  pistas e a barra de ação; `CrosswordResult.tsx` renderiza o resultado, o
  compartilhamento e as fontes; `CrosswordGame.tsx` cuida dos estados de
  carregando e erro.
- `web/src/styles/games/crossword.css` tem o estilo do jogo.

Os testes em `web/src/components/Crossword/CrosswordGame.test.tsx` cobrem
digitação, verificação, vitória, revelação, retomada, registros inválidos,
estatísticas, GA4, compartilhamento, fontes, reinício, erro de carga, dia
omitido, grade de outro dia e grade publicada antes em `next/`.
`tests/test_daily_crossword_publication.py` cobre o runner: histórico,
omissões, primeira execução, promoção e verificação.
`web/e2e/crossword.spec.ts` e `web/e2e/pilot-visual-a11y.spec.ts` cobrem os
fluxos nos dois idiomas, temas, viewports, teclado, texto a 200% e
acessibilidade.
