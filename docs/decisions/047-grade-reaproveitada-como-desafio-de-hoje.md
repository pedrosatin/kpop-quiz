# ADR 047. Grade reaproveitada como desafio de hoje

## Status

Aprovado em 2026-11-22. Complementa a [ADR 030](030-partida-diaria-por-jogo-e-data.md) no caso em que o runner publica a Grade de um dia anterior.

## Contexto

Quando a geração da Grade do dia falha, o runner pode reaproveitar o tabuleiro de um dia anterior. O registro `grid-publication.<hoje>.json` traz `reference_date` igual a hoje e `grid_reference_date` anterior, com o mesmo `grid_id`. O primeiro caso publicado foi 13/11/2026 reaproveitando a Grade de 12/11 (`b23c47d6`).

O loader admite esse tabuleiro e devolve o artefato com a `reference_date` de origem. A partida diária, o save (`kpop-grid-<grid_id>`), o texto de compartilhar e `completedDailyGames` usavam essa data de origem. Quem faltava no dia de origem e jogava no dia do reaproveitamento via a sequência estendida sobre o dia em que faltou, a aba da Grade não aparecia como concluída no dia de hoje, e o compartilhamento mostrava a data antiga. Quem já tinha terminado o tabuleiro no dia de origem via o mesmo save restaurado e contado de novo só por abrir a página.

A ADR 030 identifica a partida por jogo e `reference_date` e não trata o reaproveitamento.

## Decisão

A Grade reaproveitada conta como o desafio diário de hoje.

1. O loader carimba `challengeDate` com a data de publicação (`today` passado a `loadIntersectionGrid`, em geral `dailyReferenceDate()`). A `reference_date` do artefato permanece a de origem, porque a admissão e a identidade do tabuleiro dependem dela.
2. O registro diário (`gridDailyRound`, `useRecordDailyMatch`, `useDailyMatchDone`, analytics) usa `challengeDate`, não `grid.reference_date`.
3. O texto de compartilhar e o `DailyNext` usam `challengeDate`.
4. O save separa por data de desafio:
   - Dia sem reaproveitamento (`grid.reference_date === challengeDate`): a chave continua `kpop-grid-<grid_id>`, para preservar partidas em andamento gravadas no formato anterior ao deploy.
   - Dia com reaproveitamento (`grid.reference_date < challengeDate`): a chave é `kpop-grid-<grid_id>-<challengeDate>`. O save do dia de origem não é lido nem escrito nesse dia.

Os outros jogos diários seguem a ADR 030 sem mudança: o hook compartilhado `useRecordDailyMatch` recebe a data que cada jogo monta.

## Alternativas consideradas

### Tratar o dia reaproveitado como dia sem Grade

Equivalente a `grid_id: null` no registro de publicação. Removeria o desafio do dia em vez de oferecê-lo com a data correta. Rejeitada pelo operador em 19/11/2026 (opção b).

### Só mudar a data do registro e manter a chave `kpop-grid-<grid_id>`

O tabuleiro concluído no dia de origem seria restaurado no dia do reaproveitamento e `useRecordDailyMatch` contaria a data de hoje sem jogada nova.

### Reescrever `reference_date` do artefato para hoje

Quebraria a admissão (`grid.reference_date === authority.grid_reference_date`) e a conferência de identidade com o registro de origem.

## Consequências

- Quem joga a Grade reaproveitada em 13/11 grava a partida em 13/11. A sequência não preenche 12/11.
- Quem terminou em 12/11 e só abre a página em 13/11 não altera `played` nem vê o tabuleiro restaurado.
- `completedDailyGames("2026-11-13")` inclui a Grade depois de jogar em 13/11.
- O compartilhamento mostra o número do desafio de 13/11.
- Partidas em andamento no dia sem reaproveitamento sobrevivem ao deploy que introduz a chave datada.
- O cron, os artefatos e os schemas de publicação não mudam.
