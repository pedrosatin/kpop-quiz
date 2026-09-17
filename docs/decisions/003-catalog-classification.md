# ADR 003 sobre classificação do catálogo

## Status

Aceito em 2026-09-12 após a revisão da Fatia 2.

## Contexto

A categoria da Wikipedia contém páginas de grupos, listas, desambiguações e redirecionamentos. O vínculo com o Wikidata também pode apontar para uma pessoa ou outro tipo de entidade. Aceitar todos os membros da categoria produziria entidades falsas e alternativas ruins nos quizzes.

O catálogo precisa repetir uma decisão sem duplicar linhas. Também precisa mostrar qual revisão da Wikipedia, qual QID e qual revisão do Wikidata sustentaram o resultado.

## Decisão

Adicionar uma migração SQLite com quatro estruturas. `catalog_entries` mantém uma linha por página. `catalog_runs` registra cada execução e sua falha. `wikidata_type_checks` registra o `lastrevid` da entidade e os valores diretos de `P31`. `collection_issues` registra páginas ausentes que não possuem uma revisão para classificação.

Cada página salva entra como `candidate`. O classificador rejeita listas pelo título, desambiguações por `pageprops`, redirecionamentos por `info` e QIDs ausentes ou inválidos. Para os demais candidatos, um adaptador do Wikidata consulta somente `claims|info`. A entrada recebe `accepted` se algum `P31` direto estiver na lista versionada de tipos musicais.

O classificador não percorre `P279`. A lista explícita evita aceitar uma classe genérica por uma inferência ampla. O relatório CSV mostra os `P31` rejeitados. Uma atualização da lista exige nova versão do classificador e um caso na fixture.

`pageprops` não entra no snapshot da revisão da Wikipedia. O vínculo com o Wikidata e a marca de desambiguação podem mudar sem alteração do texto. `catalog_entries.analyzed_wikidata_id` preserva o QID usado na decisão. Se a revisão ou algum metadado usado pelo classificador mudar, o repositório devolve a entrada a `candidate`.

## Alternativas consideradas

### Aceitar todos os membros da categoria

A categoria já contém uma página de lista entre os primeiros resultados. Essa opção foi rejeitada porque a descoberta não comprova o tipo da entidade.

### Consultar toda a entidade do Wikidata

A Fatia 3 criará entidades e afirmações com qualificadores e referências. Antecipar essa ingestão misturaria classificação e extração. O adaptador desta fase lê somente a revisão e `P31`.

### Percorrer a hierarquia de subclasses

Uma busca por `P279` reduziria falsos negativos. Ela também exigiria cache de classes, limite de profundidade e regras para ciclos. A fase atual registra falsos negativos no CSV e usa seis classes diretas conhecidas.

## Consequências

- Uma página de lista nunca entra como grupo aceito, mesmo que possua um QID de tipo musical.
- Repetir a classificação atualiza a observação do Wikidata e mantém uma decisão por página.
- Uma revisão nova ou metadados de classificação diferentes exigem outra classificação.
- Um tipo musical novo pode aparecer como rejeição até uma atualização versionada da lista.
- Páginas ausentes ficam em `collection_issues`, pois não existe revisão para ligar a uma decisão do catálogo.
