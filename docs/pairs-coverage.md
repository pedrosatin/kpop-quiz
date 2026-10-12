# Cobertura de pares

A CLI de cobertura lê o SQLite em modo somente leitura e verifica os snapshots locais pelo SHA256 registrado. A seleção usa quatro a seis grupos e pessoas com QIDs distintos. O relatório descreve as relações aceitas, os rosters descartados, o conjunto selecionado e o limite da busca.

```bash
python -m kpop_scraping.pairs_coverage_cli --database data/kpop.db --raw-root data/raw --output /tmp/pairs-coverage.json
python -m kpop_scraping.pairs_coverage_cli --database data/kpop.db --raw-root data/raw --verify /tmp/pairs-coverage.json
```

`--size` aceita 4, 5 ou 6. A geração e a verificação retornam código 0 para um relatório válido, inclusive `insufficient_coverage`. Erros de entrada ou divergência na reconstrução retornam 1. A saída deve ficar fora dos snapshots e não pode substituir o banco nem o relatório usado como entrada de verificação. A escrita usa substituição atômica.

O contrato `pairs-coverage-v1` tem `status`, `requested_pairs`, `semantics`, `report_id`, contagens, motivos de descarte, `selection_policy`, `search_complete`, `limitations` e `sample`. O identificador é o hash do conteúdo anterior à inclusão de `report_id`. A verificação reconstrói todo o relatório, inclusive o sample, a partir do banco e dos snapshots explícitos.

Um sample disponível contém `pairs`, `matrix`, `period` e `matching_count`. Cada par traz QID e nome da pessoa e do grupo, além de evidência aceita com revisão, local e URL. A matriz contém todas as combinações selecionadas, com estado `true` ou `false` e a citação do campo completo. Ausências em rosters não certificados continuam desconhecidas e impedem sua seleção.

A semântica é "listado no campo current_members da revisão citada de cada grupo". As revisões podem ter datas diferentes. Essa regra não afirma uma formação simultânea, uma formação atual ou todas as participações históricas da pessoa. A evidência negativa significa que a pessoa não está naquele campo explicitamente enumerado.

O parser aceita listas compostas inteiramente de links, marcadores, separadores e quebras de linha, com wrappers `plainlist`, `ubl`, `hlist` ou `unbulleted list`. Conteúdo desconhecido, nomes repetidos, campos duplicados, identidade não resolvida ou evidência ausente descartam o roster inteiro. Cada integrante deve resolver para uma pessoa única e ter um fato `has_member` aceito, sem conflito aberto, com evidência no mesmo campo e revisão. O carregamento reaproveita os filtros de fatos e evidências do gerador de quiz.

A busca testa no máximo 20.000 conjuntos de grupos. Cada grupo selecionado precisa ter um representante ausente dos outros rosters selecionados. Isso produz uma matriz diagonal e comprova matching único. A política descarta também alguns matchings únicos que exigiriam outra busca. `insufficient_coverage` descreve a política e os inputs usados, sem provar impossibilidade geral. O relatório informa se o limite de busca foi atingido.

Fixtures sintéticas exercitam o contrato e as falhas na CLI. A cobertura para liberar o piloto precisa ser medida separadamente no banco real, com `status=ready` e sample verificável.
