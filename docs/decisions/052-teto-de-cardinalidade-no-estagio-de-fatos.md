# ADR 052. Teto de cardinalidade no estágio de fatos do rebuild

## Status

Aprovado em 2026-11-22. Complementa as [ADR 034](034-descoberta-de-lancamentos-trunca-sem-abortar.md), [ADR 032](032-rebuild-com-fallback-em-passo-separado.md) e [ADR 049](049-limites-e-seguranca-da-coleta.md). Origem: ticket de auditoria `auditoria-seguranca/35` (escopo de endurecimento, ticket auditoria 35).

## Contexto

O estágio `--facts` percorre todos os `has_member` dos grupos aceitos, busca a entidade de cada membro e usa todos os nomes en/pt/romanização na evidência de texto e de infobox. Não havia teto agregado de membros por grupo ou por run, de nomes na evidência nem de bytes de wikitext lidos para o infobox. O estágio de lançamentos já corta em `MAX_CANDIDATES_PER_GROUP=100` e segue ([ADR 034](034-descoberta-de-lancamentos-trunca-sem-abortar.md)); o de fatos não tinha equivalente. Uma edição grande no Wikidata ou na Wikipedia eleva o custo do job compartilhado até o timeout e a restauração do rebuild ([ADR 032](032-rebuild-com-fallback-em-passo-separado.md)).

Medição offline em 2026-11-22, sobre cópia de `data/kpop.db` e, para páginas de pessoa, a cópia de evidência com wikitext aceito (sem rede):

| Grandeza | Máximo | p99 |
| --- | ---: | ---: |
| Membros `has_member` por grupo | 26 | 13 |
| Membros distintos no catálogo (proxy do run completo) | 1.254 | — |
| Nomes en/pt/romanização por pessoa (`matching_names`) | 25 | 13 |
| Bytes UTF-8 do wikitext (grupo ou pessoa) | 287.103 | ~255.000 |

## Decisão

Constantes em `kpop_scraping/fact_limits.py`, com folga de cerca de 3–4× sobre o máximo medido:

| Constante | Valor | Folga sobre o máximo |
| --- | ---: | ---: |
| `MAX_MEMBERS_PER_GROUP` | 100 | ~3,8× |
| `MAX_MEMBERS_PER_RUN` | 5.000 | ~4,0× |
| `MAX_MATCHING_NAMES` | 100 | 4,0× |
| `MAX_INFOBOX_WIKITEXT_BYTES` | 1.048.576 (1 MiB) | ~3,7× |

Ao estourar um teto, o estágio registra o corte (`FactRunTotals.truncations`, aviso em stderr / `::warning` no Actions, linha em `fact_issues`) e continua. O rebuild não falha por causa do corte.

- **Membros por grupo:** entre os `has_member` do grupo, mantém os 100 QIDs mais baixos na ordem `(len(qid), qid)` da [ADR 034](034-descoberta-de-lancamentos-trunca-sem-abortar.md) e remove o restante dos candidatos daquele predicado neste run.
- **Membros por run:** entre os QIDs distintos que restaram, mantém os 5.000 mais baixos na mesma ordem antes de `_process_members`, e remove dos sujeitos os candidatos `has_member` dos QIDs cortados (o mesmo tratamento do corte por grupo), para que a validação não os rejeite como `value_entity_missing`.
- **Nomes na evidência:** `matching_names` já ordena por tamanho decrescente; o teto corta o restante da tupla usada em `ValidationContext.names`.
- **Wikitext de infobox:** se o wikitext da página passar de 1 MiB em UTF-8, a evidência de infobox dessa página fica sem texto (extract e demais regras seguem). Truncar no meio quebraria o parser do infobox.

### Preservação do estado publicado sob o corte

Os QIDs cortados pelo teto de grupo ou de run entram num conjunto `preserved_member_qids` do run. `save_facts` recebe esse conjunto e `_delete_removed_statements` deixa intactas as linhas `has_member` cujo `value_wikidata_id` está nele. `mark_stale_facts` recebe o mesmo conjunto e não marca como `stale` (`subject_not_listed_by_group`) as pessoas cujo QID foi só cortado pelo teto. O aviso e a linha em `fact_issues` continuam. Um QID que sumiu de verdade do Wikidata (não aparece mais nos candidatos e por isso não entra no conjunto cortado) segue sendo apagado e, se couber, marcado como antes.

Essa passagem do conjunto no run evita migração e colunas `last_kept` enquanto o corte só atua acima dos máximos medidos. Se um grupo passar a viver permanentemente acima de 100 membros, vale revisitar o padrão da ADR 034.

No catálogo medido (máximos 26 membros por grupo, 1.254 membros distintos, 25 nomes por pessoa, 287.103 bytes de wikitext) e sob os tetos 100 / 5.000 / 100 / 1 MiB, o reprocesso offline antes/depois na cópia de auditoria deixou o conjunto de fatos aceitos e rejeitados idêntico, com zero cortes.

## Alternativas consideradas

- **Abortar o run no estouro:** devolveria o poder de derrubar o rebuild diário a qualquer editor do Wikidata, o mesmo problema que a ADR 034 removeu nos lançamentos.
- **Descartar o grupo inteiro:** perderia os membros legítimos que o corte por QID mantém.
- **Migração com colunas de descarte (como na ADR 034):** desnecessária enquanto o corte só atua acima de máximos ainda distantes do catálogo real; o conjunto de QIDs cortados no run e o registro em `fact_issues` bastam para operação e para não apagar o publicado. Se um grupo passar a viver permanentemente acima de 100 membros, vale revisitar a marcação de obsoletos com `last_kept`.

## Consequências

- Um fan-out extremo de P527, aliases ou wikitext deixa de empurrar o rebuild compartilhado até o timeout sem aviso.
- Grupos ou páginas acima do teto deixam de processar, naquele run, os membros, nomes ou evidência de infobox cortados; o estado aceito já publicado desses membros permanece, e o aviso aparece no log e no resumo `Fact caps: …`.
- Testes em `tests/test_fact_limits.py` fixam o corte sintético, a preservação em dois runs, a exclusão de um QID realmente removido do Wikidata e a folga sobre os máximos medidos.
