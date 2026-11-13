# ADR 032 sobre o rebuild com tentativas limitadas e fallback em passo separado

## Status

Aprovado em 2026-11-13. Muda o passo "Rebuild database from Wikipedia and Wikidata" de `daily-puzzles-cron.yml`, acrescenta o passo "Restore cached database" e define os códigos de saída de `python main.py`. Os passos de geração, verificação e publicação continuam como estavam.

## Contexto

O job diário reconstrói `data/kpop.db` a partir da Wikipedia e do Wikidata antes de gerar os jogos. Quando a reconstrução falha, o job restaura o banco que veio do cache e publica o dia com os fatos da execução anterior.

As três tentativas, as duas esperas de 10 minutos e a restauração ficavam no mesmo passo, com `timeout-minutes: 120`. Uma tentativa que não terminasse consumia o tempo do passo inteiro. O GitHub encerrava o passo antes da restauração, o job falhava e o dia ficava sem publicação.

O laço repetia qualquer falha. `python main.py` saía com o código 1 para um erro de rede e também para um erro de integridade de snapshot, de validação ou de limite de candidatos do WDQS. Esses três últimos se repetem enquanto a entrada for a mesma, e cada repetição custava 10 minutos de espera sem chance de sucesso.

Em 8 das 10 execuções agendadas anteriores a 2026-11-13, as três tentativas terminaram em `maxlag` do Wikidata e o dia saiu do banco em cache. A restauração é o caminho mais usado do passo.

## Decisão

### Dois passos

1. "Rebuild database from Wikipedia and Wikidata" chama `scripts/rebuild_database.py rebuild`, com `id: rebuild`, `continue-on-error: true` e `timeout-minutes: 120`.
2. "Restore cached database" chama `scripts/rebuild_database.py restore-cache` com a condição `steps.rebuild.outcome == 'failure'`.

`outcome` é o resultado do passo antes do `continue-on-error`. Ele vale `failure` para código de saída diferente de zero e para o timeout do passo. A função `failure()` não serve como condição, porque ela lê o estado do job e o `continue-on-error` mantém o job com sucesso. O job precisa terminar com sucesso por dois motivos. Os passos de "Generate daily puzzles" em diante não têm condição própria e só rodam com o job nesse estado. O deploy do `pages.yml` só publica quando o workflow conclui com sucesso.

### Limites das tentativas

O script roda o coletor no máximo 3 vezes, com 10 minutos de espera entre duas tentativas. Cada tentativa tem 30 minutos. Passado esse tempo, o script envia SIGTERM e, 30 segundos depois, SIGKILL. O pior caso soma três tentativas de 30,5 minutos e duas esperas, 111,5 minutos, abaixo dos 120 do passo. Um teste lê o `timeout-minutes` do workflow e falha se a soma deixar de caber.

Os limites vêm das variáveis de ambiente `REBUILD_MAX_ATTEMPTS`, `REBUILD_ATTEMPT_TIMEOUT_SECONDS`, `REBUILD_RETRY_WAIT_SECONDS` e `REBUILD_KILL_GRACE_SECONDS`. O workflow não define nenhuma delas. Os testes as usam para rodar em segundos.

### Códigos de saída do coletor

`kpop_scraping/exit_codes.py` nomeia os códigos de `python main.py`.

| Código | Constante | Quando |
|---|---|---|
| 0 | `EXIT_OK` | O banco foi atualizado |
| 75 | `EXIT_TRANSIENT` | Um cliente desistiu de uma condição que passa com o tempo: falha de rede, `maxlag`, HTTP 429 ou 5xx, `Retry-After` acima do limite do cliente |
| 65 | `EXIT_DETERMINISTIC` | Qualquer outra falha tratada: `SnapshotIntegrityError`, `ValueError` de validação, resposta que o parser recusa, limite de candidatos do WDQS |

Os dois códigos de falha são `EX_TEMPFAIL` e `EX_DATAERR` do `sysexits.h`. Eles diferem de 1, que o Python usa para exceção não tratada, de 2, que o argparse usa, e de 124, 137 e 143, que indicam timeout e sinais.

O cliente marca o erro no ponto em que desiste, com `MediaWikiError(..., transient=True)`, e o CLI converte a marca no código 75. Um cliente que passe a esperar mais pelo `maxlag` e desista ao fim de um orçamento de tempo levanta o erro com a mesma marca e sai com o mesmo código.

### O que o script repete

Só o código 75 leva a outra tentativa. O código 65, o código 1, qualquer outro código e a tentativa encerrada pelo timeout terminam o passo na hora.

Falha de rede e `maxlag` encerram a tentativa pelo próprio cliente, que tem timeout de 30 segundos por requisição e limite de novas tentativas, e saem com 75. Uma reconstrução bem-sucedida leva de 1 a 2 minutos. Uma tentativa que chega aos 30 minutos está fora desses dois casos, e repeti-la somaria até 40,5 minutos por vez antes da publicação.

O passo sai com o código da última tentativa, ou com 124 quando o timeout a encerrou, e grava o motivo na saída `failure` do passo.

### Restauração

O passo de restauração apaga os snapshots brutos mais novos que a cópia `data/kpop.db.cached`, porque o banco restaurado não os referencia. Apaga também os arquivos `-journal`, `-wal` e `-shm` ao lado do banco. Uma tentativa encerrada no meio de uma transação deixa o journal em disco, e o SQLite o aplicaria ao banco restaurado na abertura seguinte. Depois o passo move a cópia para `data/kpop.db` e emite o aviso `Database not refreshed` com o motivo. Sem cópia em cache, o passo falha e o job não publica.

## Alternativas consideradas

### Manter a restauração no passo do rebuild

O timeout por tentativa já limitaria uma tentativa que não termina. A restauração continuaria dependente de o shell do passo chegar até ela. O timeout do passo ou um erro no laço a pulariam. Em passo separado, quem avalia a condição é o runner.

### Usar `if: failure()` no passo de restauração

O passo de rebuild ficaria sem `continue-on-error`. O job terminaria como falho em todo dia publicado a partir do cache, os passos seguintes precisariam de condição própria e o deploy, que exige sucesso, não rodaria.

### Escrever o laço em shell com `timeout` dentro do YAML

O laço ficaria sem teste. O script tem testes com um coletor simulado em `tests/test_rebuild_database.py` e importa os códigos de saída do mesmo módulo que o CLI.

### Repetir a tentativa encerrada pelo timeout

Três tentativas de 30 minutos cabem no passo. No pior caso, a publicação a partir do cache sairia 81 minutos mais tarde, e a tentativa encerrada pelo timeout não está entre os erros que o cliente classifica como transitórios.

### Classificar a falha pelo texto da mensagem

O script leria a linha `Pipeline failed` e procuraria `maxlag`. Uma mudança de redação mudaria a classificação sem falhar nenhum teste. A marca fica no ponto em que o cliente desiste.

## Consequências

- Uma tentativa que não termina atrasa a publicação em até 30,5 minutos, e o dia sai do banco em cache.
- Um erro determinístico publica a partir do cache depois de uma tentativa. Antes eram três tentativas e 20 minutos de espera.
- O passo de rebuild aparece com falha tolerada e o job termina com sucesso. O aviso `Database not refreshed` no resumo da execução indica que o banco não foi atualizado e traz o motivo.
- Uma exceção que o CLI não trata sai com o código 1 e não é repetida, mesmo quando a causa é temporária. Para ser repetido, o erro precisa ser marcado como transitório na origem.
- Os códigos 65 e 75 passam a ser contrato de `python main.py`. O script e os testes leem as constantes de `kpop_scraping/exit_codes.py`.
- O script roda com o `python3` do runner e depende só da biblioteca padrão.
