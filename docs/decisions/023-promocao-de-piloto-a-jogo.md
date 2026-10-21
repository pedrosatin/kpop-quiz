# ADR 023. Critérios de promoção de piloto a jogo

## Status

Aceita

## Data

2026-10-19

## Contexto

O repositório tem dois pilotos ativos fora do menu de jogos: a cruzadinha
(`/pt-br/cruzadinha-piloto/`, `/en/crossword-pilot/`) e o código de grupos
(`/pt-br/codigo-piloto/`, `/en/code-pilot/`), ambos com `noindex`, textos
bilíngues inline fora do catálogo e sem publicação diária, estatísticas,
persistência ou compartilhamento. O jogo de mapas passou por promoções na
prática ([PR #78](https://github.com/pedrosatin/kpop-quiz/pull/78) para a
pipeline, #83 para a exposição pública), mas os critérios nunca foram
documentados: a promoção foi executada caso a caso, sem ADR que defina quando
um piloto está pronto. A fatia "graduação dos pilotos" (`.scratch/graduacao-pilotos/`)
especifica a promoção dos dois pilotos atuais e a escolha editorial foi
incluir estatísticas locais, persistência e compartilhamento nos graduados —
o mapa ficou de fora dessas três por decisão da época (os testes de
`MapPilotGame` afirmam explicitamente que o jogo não toca nas estatísticas).

## Decisão

Um piloto é promovido a jogo quando atende a todos os critérios abaixo. Os
critérios formalizam o que a graduação do mapa praticou, mais as adições
decididas em 2026-10-19.

### Checklist de promoção

1. **Rotas finais sem "piloto"** nos dois idiomas, com redirect das rotas antigas
   (`301` das rotas `-piloto`/`-pilot`), já que eram `noindex` e o custo de SEO é
   zero — o objetivo é evitar 404 nos links de README, PRs e e2e.
2. **`BaseLayout`** com banner de consentimento (pré-requisito do GA4),
   `SeoRouteKey` do jogo em `seo-routes.ts` e chaves de texto no `catalog.ts`
   (nenhum texto bilíngue inline em ternário).
3. **Menu**: o jogo aparece em `PlatformOverview` via `SEO_ROUTES` — não há
   manutenção manual de menu.
4. **SEO completo**: sitemap (via `SEO_ROUTES`), `llms.txt` + resumos em
   `web/public/llms/`, cartões OG 1200×630 por rota (ADR 021), GameAbout/FAQ e
   skipLinks; invariantes e testes de rotas (`seo-routes.test.ts`, `llms.test.ts`,
   `robots.test.ts`, `platform-overview.test.ts`, `seo:verify`) atualizados.
5. **GA4 com consentimento**: `AnalyticsGame` incluído, eventos de início,
   conclusão e compartilhamento (ADR 017), sem replay de eventos com progresso
   salvo.
6. **Estatísticas locais, persistência e compartilhamento** (decisão de
   2026-10-19, vale para os graduados a partir de agora): jogo em
   `ALL_GAME_IDS` + `StatsTabs`, progresso no `localStorage` retomável e share
   com `seoShareUrl` (`utm_campaign=<jogo>`).
7. **Pipeline de dados**: artefato diário gerado pelo
   `daily_puzzles_runner.py`, publicado em `next/` com troca atômica e
   verificação em `web_publish.py` (flag `--require-*` correspondente), entrada
   no manifest e no cron "Publish daily puzzles". Gerador determinístico por
   seed de data, com schema versionado em `schemas/`. A falha do gerador segue
   política explícita documentada (bloqueia o dia ou publish parcial).
8. **Fontes e evidência**: cada resposta aponta fonte registrada na política
   (`docs/source-policy.md`); resultado lista fontes com revisão e URL.
9. **Acessibilidade**: e2e e auditoria visual/a11y no padrão dos jogos
   publicados; estados obrigatórios (carregando, vazio, erro de manifesto,
   versão incompatível, offline, atualização disponível).
10. **Testes**: unit tests do componente em `web/src` (não só e2e) e testes
    Python do gerador no padrão dos jogos diários.
11. **Documentação**: doc de jogo no padrão de `docs/map-game-pilot.md`,
    README/roadmap atualizados (o README declara os pilotos como fixos e fora
    do menu — a graduação contradiz esse texto e exige a atualização).

### Conformidade dos pilotos atuais na abertura

| Critério | Cruzadinha | Código |
|---|---|---|
| 1. Rotas + redirect | Falta | Falta |
| 2. BaseLayout + catalog | Falta (layout próprio) | Falta |
| 3. Menu | Falta | Falta |
| 4. SEO/llms/OG/about | Falta | Falta |
| 5. GA4 | Falta (sem banner) | Falta |
| 6. Stats/share/persistência | Falta | Falta |
| 7. Pipeline diário | Falta (seleção fixa auditada à mão) | Parcial (gerador determinístico por data pronto; falta runner/publication) |
| 8. Fontes/evidência | Atende | Atende |
| 9. A11y/e2e | Parcial (e2e sim; unit tests não) | Parcial |
| 10. Testes unitários web | Falta | Falta |
| 11. Docs/README/roadmap | Falta | Falta |

### Requisitos de processo

A promoção é feita por fatia de tickets em `.scratch/`, uma por vez, com
subagent dedicado quando o ticket é de implementação; nenhum critério fica
implícito. Se um critério não fizer sentido para uma mecânica (ex.: cadência
diária impossível), a exceção é registrada na ADR de promoção correspondente
como emenda, nunca silenciada no checklist.

## Alternativas consideradas

### Manter critérios implícitos (padrão do mapa)

Cada graduação repetiria a arqueologia do que o mapa fez, com risco de os dois
pilotos graduar de formas diferentes e de o README continuar contradizendo o
menu. Rejeitado porque o custo do ADR é único e pequeno.

### Promoção sem retirar "piloto" da rota

Manteria as URLs e evitaria redirects, mas perpetuaria o status de exemplo fixo
e o `noindex`, que é exatamente o que a graduação quer eliminar.

### Exigir stats/persistência como critério universal

Faria os dois pilotos obrigatoriamente iguais aos seis jogos diários e
diferiria do mapa (que ficou sem stats). Decidido: vale como padrão para
graduações novas a partir de 2026-10-19; o mapa permanece como está, sem
obrigação retroativa.

## Emendas

### Cruzadinha graduada com partida fixa (2026-10-20)

A cruzadinha foi graduada antes do gerador diário. Os critérios 1 a 6 e 8 a
11 valem como estão. O critério 7 fica como exceção registrada: não há
artefato diário, runner nem flag `--require-*`; o jogo serve o tabuleiro fixo
auditado (`crossword-pilot.json`, `crossword-pilot-v1`). A parte do critério
que não depende da cadência foi cumprida: o schema versionado está em
`schemas/crossword-pilot-v1.json`, com o validador Python e o web rodando a
mesma lista de casos de rejeição. A exceção cai quando a fatia do gerador
diário publicar o artefato do dia pelo runner.

O critério 6 foi escrito para jogos diários, em que a data identifica a
rodada. Para uma partida fixa:

- a chave de progresso é a impressão do tabuleiro
  (`kpop-crossword-<dataset_version>`), não a data;
- a partida conta uma vez por tabuleiro nas estatísticas, com a data local do
  dia em que terminou, para não quebrar a sequência geral com a data de
  referência do artefato;
- o compartilhamento não traz data nem número do dia.

Detalhes em [Cruzadinha](../crossword-game.md).
