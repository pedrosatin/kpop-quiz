# ADR 051. Set do dia exige só os jogos publicados

## Status

Aprovado em 2026-11-22. Complementa o [ADR 037](037-publicacao-parcial-do-dia.md) (publicação parcial e `daily-set.json`) e o item 7 do [ADR 050](050-normalizacao-identidade-e-persistencia-local.md) (celebração no `DailyNext`).

## Contexto

Com a publicação parcial, um dia pode sair sem um jogo (o Strands é o caso mais comum). O registro público `daily-set.json` (`kpop-daily-set-v1`) lista as omissões. No cliente, `isDailySetComplete`, `completedDailyGames`, a celebração, o evento GA4 `daily_set_complete` e o share do dia exigiam partida em todos os `DAILY_GAMES`, sem ler o registro. Quem terminava todos os jogos publicados num dia com omissão não fechava o set.

## Decisão

1. **Só os publicados contam.** O set do dia exige os jogos de `DAILY_GAMES` menos os omitidos no registro do dia. Um dia sem omissões continua exigindo os dez.
2. **Loader com a mesma regra de data dos artefatos diários.** `loadDailySetRequirement` lê `data/daily-set.json` e, se precisar, `data/next/daily-set.json` só quando a `reference_date` dessa cópia é o dia civil em `America/Sao_Paulo`. Prefere o registro principal quando ele já é de hoje.
3. **Falha segura.** Registro ausente, 404, JSON inválido, campos extras, jogo desconhecido, `reference_date` diferente de hoje ou erro de rede → exigir todos os `DAILY_GAMES` (omissões vazias).
4. **Share do dia.** O texto lista só os jogos publicados, na ordem das abas. Jogo omitido fica de fora: não há resultado para resumir, e marcar “não publicado” inventaria uma linha que o jogador não gerou.
5. **Sequência de sets.** Um dia com omissão e todos os publicados concluídos incrementa `dailySetsCompleted` e grava `lastDailySetDate` como qualquer outro set completo.
6. **Ids.** As chaves de `omitted` são as de `daily_set.GAMES` no Python (`quiz`, `grid`, `connections`, `name-guess`, `word-search`, `timeline`, `code-groups`, `crossword`, `strands`). O loader mapeia para `SeoRouteKey` (`code-groups` → `code`, `name-guess` → `nameGuess`, etc.). O mapa não entra no registro: não tem artefato diário omitível.

## Alternativas consideradas

- **Exigir sempre os dez:** manteria o set incompleto em todo dia parcial, contra a decisão do operador em 22/11/2026.
- **Marcar o omitido no share:** acrescentaria texto sem linha de resultado do jogador; omitir a entrada é o padrão do resumo (só corpos lembrados).

## Consequências

- `DailyNext` aplica primeiro a falha segura (exigir todos) no mesmo paint e só reaplica o plano quando o loader devolve omissões. Assim o caminho sem omissão permanece síncrono.
- Sem `daily-set.json` (conjuntos antigos ou falha de rede), o cliente volta ao comportamento anterior: exige todos.
- Reverter: voltar `isDailySetComplete` / `DailyNext` a comparar só com `DAILY_GAMES.length` e remover o loader.
