# Cruzadinha

## Jogo

As rotas `/pt-br/cruzadinha/` e `/en/crossword/` apresentam uma grade de 6×3
com três grupos de K-pop (BTS, BtoB e SISTAR) que se cruzam nas letras em
comum. Cada pista traz um ou dois fatos do grupo, como o ano de formação, a
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

## Artefato

`web/public/data/crossword-pilot.json` segue o contrato `crossword-pilot-v1`
(`schemas/crossword-pilot-v1.json`, sem campos extras). O nome do arquivo, o
`mode: "pilot"` e o `puzzle_id: "crossword-audited-01"` continuam os mesmos
porque o tabuleiro é o mesmo que foi auditado; o gerador diário vai publicar
outro arquivo e outro contrato.

O schema cobre a estrutura. As regras de domínio (impressão SHA-256 em
`dataset_version`, limites da grade, numeração, cruzamentos, conexão, colisão
de aliases, pista que serve a um só grupo, URL da revisão igual ao localizador,
células derivadas das entradas) ficam em dois validadores alinhados:

- `validate()` em `kpop_scraping/crossword_cli.py`;
- `validateCrosswordPuzzle()` em `web/src/data/crossword.ts`.

Os dois rejeitam os mesmos casos, lidos de uma fixture compartilhada,
`tests/fixtures/crossword_invalid_cases.json`, em `tests/test_crossword_schema.py`
e `web/src/data/crossword.test.ts`, e os dois testes conferem que as
constantes e os conjuntos de campos de cada validador batem com o schema.

```bash
python -m kpop_scraping.crossword_cli --database data/kpop.db --output web/public/data/crossword-pilot.json --reference-date 2026-10-12
python -m kpop_scraping.crossword_cli --verify web/public/data/crossword-pilot.json
```

## Persistência, estatísticas e compartilhamento de uma partida fixa

O ADR 023 pede progresso retomável, estatísticas e compartilhamento, mas foi
escrito para jogos diários, em que a data identifica a rodada. Na cruzadinha
a rodada é o tabuleiro, então a identidade é a impressão do conteúdo.

### Progresso

O progresso fica no `localStorage`, na chave `kpop-crossword-<dataset_version>`,
com as letras digitadas, o número de verificações e o estado (`playing`, `won`
ou `revealed`). O jogo descarta um registro com quadrado fora da grade, com mais
de um caractere por quadrado ou com vitória que as letras não resolvem. Ao
carregar, ele apaga os registros de outros tabuleiros, e um tabuleiro novo
começa limpo.

### Estatísticas

A partida concluída entra uma única vez, marcada por
`kpop-match-recorded-crossword-crossword-<dataset_version>`, com a data local do
dia em que o jogador terminou. A data de referência do artefato, 2026-10-12,
quebraria a sequência geral, que compara dias consecutivos. Resolver conta como
vitória, e revelar conta como partida sem vitória. "Jogar novamente" limpa o
progresso, mas não conta de novo. A aba "Cruzadinha" / "Crossword" aparece na
janela de estatísticas.

### GA4

O jogo envia `game_start` na primeira ação, `game_complete` no fim da partida
jogada nesta visita e `share` no compartilhamento, só com consentimento. Ele não
repete eventos ao restaurar uma partida salva.

### Compartilhamento

O texto traz "K-pop Crossword", o veredito ("Resolvida em N verificações." ou
"X de Y palavras certas antes de encerrar.") e um quadrado por palavra na ordem
das pistas (🟩 palavra certa, ⬜ o resto). Não leva data, número do dia nem
respostas, e o link usa `utm_campaign=crossword`.

## Arquivos

- `kpop_scraping/crossword_cli.py` seleciona e verifica o tabuleiro.
- `schemas/crossword-pilot-v1.json` é o contrato versionado.
- `web/src/data/crossword.ts` valida e carrega o artefato.
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
estatísticas, GA4, compartilhamento, fontes, reinício e erro de carga.
`web/e2e/crossword.spec.ts` e `web/e2e/pilot-visual-a11y.spec.ts` cobrem os
fluxos nos dois idiomas, temas, viewports, teclado, texto a 200% e
acessibilidade.
