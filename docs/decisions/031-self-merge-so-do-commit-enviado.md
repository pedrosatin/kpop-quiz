# ADR 031 sobre o self-merge só do commit que o job enviou

## Status

Aprovado em 2026-11-13. Muda o passo "Publish via pull request" de `daily-puzzles-cron.yml` e de `map-pilot-refresh.yml`. O ruleset da `master`, o merge por squash e os passos de geração continuam como estavam.

## Contexto

Os dois workflows publicam dados gerados na `master`. O ruleset da `master` só aceita mudança por pull request. Por isso o job envia o commit para uma branch de automação (`automation/daily-puzzles` ou `automation/map-pilot-refresh`), abre um PR e faz o merge com o `GITHUB_TOKEN`. Quando o workflow termina, o `pages.yml` roda por `workflow_run` e publica o site a partir da `master`.

O passo escolhia o PR com `gh pr list --head <branch> --json number --jq '.[0].number'` e passava esse número ao `gh pr merge`. `gh pr list --head` filtra só pelo nome da branch de head e devolve PRs de qualquer repositório, forks incluídos. O repositório é público, e o ruleset exige 0 aprovações e nenhum status check. Um PR aberto de um fork, numa branch com o nome da branch de automação, podia ser o primeiro da lista e receber o merge do job. A auditoria de segurança de novembro de 2026 rodou o passo literal contra um `gh` simulado e o PR do fork foi mergeado.

O merge também não informava o commit esperado. Um push na branch entre a listagem e o merge entrava na `master` sem ter sido gerado pelo job.

## Decisão

O job só faz merge do commit que ele mesmo enviou. A regra fica em `scripts/publish_via_pr.py`, que os dois workflows chamam depois do `git push` com o SHA de `git rev-parse HEAD`.

### Seleção do PR

O script lista os PRs abertos da branch de automação para a base, com `--limit 100`. O padrão do `gh` é 30, e forks com o mesmo nome de branch poderiam tirar o PR do próprio repositório da primeira página. Um PR conta como do próprio repositório quando cumpre as quatro condições:

- `isCrossRepository` é `false`;
- o repositório de head, lido de `headRepositoryOwner.login` e `headRepository.name`, é o repositório atual, sem diferenciar maiúsculas de minúsculas;
- `headRefName` é a branch de automação;
- `baseRefName` é a base.

Entre esses, o script escolhe o PR cujo `headRefOid` é o SHA enviado. A posição na lista não participa da escolha.

### Sem PR do próprio repositório

O script abre o PR e lista de novo com o mesmo filtro até o PR aparecer. Um PR de outra origem nunca é reaproveitado.

### PR do próprio repositório com outro head

O GitHub atualiza o head de um PR aberto logo depois do push, e a listagem pode mostrar o head anterior. Quando existe PR do próprio repositório com outro head, o script lista de novo, até 5 vezes, com 3 segundos de intervalo. Se o head não chegar ao SHA enviado, outro push alcançou a branch ou o GitHub ainda não aplicou o push, e o passo falha sem abrir PR nem fazer merge.

### Merge

O script chama `gh pr merge <número> --squash --delete-branch --match-head-commit <SHA enviado>`. O GitHub recusa o merge quando o head do PR é outro commit. Antes de qualquer chamada ao `gh`, o script recusa um SHA que não tenha 40 dígitos hexadecimais, porque `--match-head-commit` vazio não restringe o merge.

### Falha

Toda falha encerra o passo com código diferente de zero. Antes do merge, nada entra na `master`. Se o `gh` falhar depois do merge (remoção da branch, tempo esgotado), os dados já estão na `master` e o deploy, que exige o workflow concluído com sucesso, espera a execução seguinte. A branch e o PR ficam abertos quando a falha vem antes do merge. A execução seguinte envia um commit novo com `--force` e reaproveita o PR quando o head dele chega ao novo SHA.

## Alternativas consideradas

### Filtrar com `--jq` dentro de cada workflow

O filtro caberia numa expressão `jq`, repetida nos dois arquivos YAML e sem teste. O script concentra o critério e tem testes com um `gh` simulado em `tests/test_publish_via_pr.py`.

### Usar a URL que o `gh pr create` imprime

O número do PR criado sairia da URL. O script lista de novo e aplica o mesmo filtro, e assim o PR criado e o PR reaproveitado passam pelo mesmo critério.

### Exigir status check ou aprovação na `master`

Um PR aberto com o `GITHUB_TOKEN` não dispara workflows, e um check obrigatório travaria o self-merge. Essa proteção depende de trocar o token por um GitHub App e não faz parte desta decisão.

## Consequências

- Um PR de fork com o nome da branch de automação fica aberto e sem merge. O job abre o próprio PR e faz o merge dele.
- Um push na branch de automação entre a listagem e o merge faz o passo falhar. A publicação daquele dia espera a execução seguinte ou um `workflow_dispatch`.
- O job de publicação usa o `python3` do runner. O script depende só da biblioteca padrão e roda a partir do checkout da `master`, nunca do conteúdo do PR.
- A regra cobre o que o job mergeia. Quem tem permissão de escrita no repositório continua podendo enviar commits para a branch de automação e fazer merge por conta própria.
