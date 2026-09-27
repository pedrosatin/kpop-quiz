# ADR 019 sobre evidência da infobox

## Status

Aprovado em 2026-09-27.

## Contexto

A [ADR-004](004-wikidata-facts-and-evidence.md) aceita uma afirmação do Wikidata quando uma referência confiável a sustenta ou quando o resumo da revisão da Wikipedia do grupo a confirma numa frase com contexto. Com essa regra, o banco de 27 de setembro de 2026 tinha 5 fatos `record_label` aceitos em 414 e 477 fatos `has_member` aceitos em 1386. A maior parte das rejeições tinha o motivo `missing_evidence`: 386 de gravadora e 389 de integrante.

Com tão pouca cobertura, a grade de interseções ficou sem solução. A regra da [ADR-008](008-grade-de-intersecoes.md) proíbe a mesma categoria nos dois eixos. Gravadora quase não tinha grupos, e o cruzamento de décadas com contagem de integrantes tinha casas vazias. A busca do gerador é exaustiva, então nenhuma seed produzia grade, e os dias 27 e 28 de setembro saíram sem `grid.daily.json`.

A infobox do artigo lista gravadoras e integrantes em campos próprios. Um levantamento com o wikitext das mesmas revisões já coletadas, em 552 páginas de grupo, encontrou a `Infobox musical artist` em 549. Ele confirmou 286 das 386 gravadoras e 276 dos 389 integrantes rejeitados por falta de evidência, com correspondência exata de item. Na validação de ponta a ponta em 27 de setembro de 2026, a extração alcançou 295 fatos de gravadora e 723 fatos de integrante aceitos (com 1170 evidências sustentadas por wikitext), e 30 de 30 dias consecutivos geraram grade válida.

## Decisão

### Snapshot do wikitext

A extração de fatos baixa o wikitext da revisão do grupo que o catálogo já analisou, pelo `revid`, em lotes de até 50, em sequência e com `maxlag`. O conteúdo vira um snapshot próprio em `wikipedia-wikitext/<idioma>/<pageid>/<revid>.json.gz`, com `pageid`, `revid`, `contentmodel` e `wikitext`. A tabela `source_revision_wikitext` guarda caminho e SHA-256. O snapshot do resumo não muda, como exige a [ADR-002](002-immutable-revision-snapshots.md). A mesma revisão com outro conteúdo encerra a execução com falha de integridade. Uma revisão com texto oculto fica sem wikitext.

### Regra da infobox

O parser lê só a primeira `Infobox musical artist` da página. Um item de lista é um argumento de `hlist`, `flatlist`, `plainlist`, `ubl` e equivalentes, ou um trecho separado por `<br>`, quebra de linha, marcador ou vírgula fora de links e templates. Referências, comentários, tags e outros templates saem do item antes da comparação, assim como uma nota final entre parênteses, como `(2015–2020)`.

O item prova o valor quando é o próprio valor: o alvo de um link, o texto de um link ou texto simples, comparados por igualdade com o nome canônico ou um alias da entidade, sem diferenciar maiúsculas. Um item com texto além do link, ou com dois links, não prova nada. Um nome contido num item maior não prova nada.

- `record_label` usa o campo `label`.
- `has_member` e `member_of` usam `current_members`, `members` e `past_members`.

A regra do resumo continua tendo prioridade. A infobox só é consultada quando a frase não prova o valor. O localizador registra `pageid`, `revid` e o intervalo do item em pontos de código Unicode no wikitext (`#wikitext[início:fim]`). `fact_evidence.snippet` guarda o campo e o item, como `label = [[JYP Entertainment|JYP]]`. `EVIDENCE_RULES_VERSION` passa a `text-evidence-v5`.

### Fora desta decisão

`years_active` não prova `formed_on`. O campo marca o início das atividades, não a formação, e prova só o ano. A linha do tempo usa a data completa de formação, então um ano da infobox não sustenta a data do Wikidata. No levantamento, 20 grupos tinham o primeiro ano de `years_active` diferente do ano de formação, 3 deles em outra década. Gênero, origem e atributos de pessoa continuam como na ADR-004.

## Alternativas consideradas

### Aceitar referências `P143`

Continua rejeitada pelo motivo da ADR-004: "importado da Wikipédia" não aponta revisão nem trecho.

### Criar fatos a partir da infobox

A infobox seria uma segunda fonte de fatos, com identidade própria. A identidade de um fato hoje é o ID da afirmação do Wikidata, e o jogo depende do QID do valor. Usar a infobox só como evidência de afirmações existentes mantém esse modelo. A alternativa foi rejeitada.

### Afrouxar a ortogonalidade da grade

Voltaria a publicar grades com a mesma categoria nos dois eixos, que a ADR-008 rejeita por ambiguidade. A alternativa foi rejeitada.

## Consequências

- Cada extração completa baixa o wikitext uma vez por revisão nova, cerca de 12 requisições para o catálogo atual.
- Nomes com outra romanização não correspondem: `Yoo Ho-suk` na infobox não prova `Yoo Ho-seok` no Wikidata. Esses fatos continuam rejeitados.
- O wikitext segue CC BY-SA, como o resumo. O trecho exibido mantém o link da revisão.
- O painel de fontes da grade descreve o localizador como "caracteres X a Y do código da página".
