# ADR 004 sobre fatos do Wikidata e evidência

## Status

Aprovado em 2026-09-13.

## Contexto

O catálogo aceita grupos pelo QID e por `P31`. A geração de perguntas precisa de fatos tipados sobre grupos e integrantes, com a fonte de cada valor. O Wikidata oferece valores estruturados, rank, qualificadores e referências. Muitas afirmações citam apenas "importado da Wikipédia" (`P143`), o que não identifica uma fonte externa.

A amostra de 30 grupos também mostrou divergências reais. Integrantes do After School têm início em 2008 no `P527` do grupo e em 2009 no `P463` da pessoa. Algumas pessoas têm cidade e bairro como dois `P19` de mesmo rank.

## Decisão

### Snapshot por QID, revisão e perfil

Cada entidade retornada por `wbgetentities` gera um JSON canônico em `wikidata/<perfil>/<QID>/<lastrevid>.json.gz`. `wikidata_entity_snapshots` guarda QID, `lastrevid`, perfil, caminho e SHA-256. O perfil entra na identidade porque os filtros `props`, `languages` e `sitefilter` mudam o conteúdo da mesma revisão.

O perfil `subject-v1` pede `info|labels|aliases|claims|sitelinks/urls` em pt, en e ko, com links de enwiki, ptwiki e kowiki. Grupos e integrantes usam esse perfil. O perfil `label-v1` pede apenas `info|labels|aliases` e serve para organizações, lugares, gêneros, idiomas e instrumentos. Um país como `Q884` tem centenas de afirmações que o extrator não usa.

Um novo perfil exige outro nome. Conteúdo diferente para o mesmo QID, revisão e perfil encerra a execução com falha de integridade, como no ADR 002.

### Fato por afirmação

`facts` tem uma linha por ID de afirmação do Wikidata. A linha guarda predicado, propriedade, rank, valor tipado, precisão, calendário, validade (`P580` e `P582`), qualificadores, resumo das referências, estado, motivo e marcas de qualidade. Repetir a extração atualiza a linha pelo ID da afirmação e remove afirmações que saíram da revisão atual do sujeito.

Afirmações `deprecated`, `somevalue` e `novalue` não viram fatos. Quando uma propriedade tem valor `preferred`, os valores `normal` do mesmo sujeito recebem `superseded`. Essa é a regra de afirmações verdadeiras do Wikidata.

### Aceite

Um fato recebe `accepted` quando passa por todas as regras abaixo:

1. o valor tem tipo, precisão mínima de ano e calendário gregoriano;
2. a entidade do valor existe e tem o tipo esperado (`person` para `has_member`, `group` para `member_of`);
3. predicados de valor único (`formed_on`, `origin_country`, `formed_in`, `born_on`, `born_in`) têm um só valor no rank vencedor;
4. o vínculo entre grupo e pessoa existe nos dois lados e tem períodos compatíveis;
5. existe evidência.

Datas compatíveis são refinamentos, como `2015` e `2015-10-20`. O sistema mantém o valor com evidência e maior precisão e marca o outro como `superseded`. Valores incompatíveis recebem `conflict` e continuam no banco com a evidência encontrada. A ausência da afirmação correspondente gera `membership_counterpart_unverified`. Um limite presente em apenas um lado gera `membership_period_unconfirmed`. A falta de `P582` não comprova vínculo atual.

### Evidência

`P248` e `P854` identificam a origem citada. O primeiro vira `wikidata:<QID>`; o segundo vira `domain:<domínio registrável>`. A referência só sustenta o fato quando todas as origens identificadas nela constam como `reliable` em `sources-v2`. Origens negadas geram `unreliable_reference_source`. Origens ainda não avaliadas geram `unreviewed_reference_source`. O localizador aponta para `claims/<propriedade>/<ID da afirmação>/references/<hash>` dentro do snapshot da entidade, e `fact_evidence.source_key` guarda a origem aceita. A [política de fontes](../source-policy.md) descreve a amostra e o processo de inclusão.

Sem referência suficiente, o validador procura o valor no resumo da revisão da Wikipedia já coletada para o grupo. Ele não lê infobox nem wikitext. A busca exige nome inteiro e contexto na mesma frase:

- data de formação no formato da precisão declarada, em uma cláusula que liga o grupo a "formed", "founded", "established" ou "created";
- lugar de formação em cláusula que liga o grupo ao verbo de formação;
- país de origem por nome ou gentílico da lista revisada, sem usar os demais aliases do Wikidata como equivalentes geográficos;
- gravadora somente em construção explícita com `signed to` ou `signed with`;
- gênero em frase que descreve o grupo ou cita gêneros, sem aceitar títulos como "K-pop Star";
- integrante em lista de composição, ou em entrada e saída que nomeiam o grupo na mesma frase sem outro referente possível, com nome inteiro e inicial maiúscula.

As regras não usam a frase anterior. Sujeito, relação e valor precisam aparecer na mesma frase e na mesma cláusula. Uma oração relativa não pode fornecer data, lugar, país, gênero ou gravadora ao grupo da oração principal. Papéis como gerente e produtor não comprovam vínculo como integrante. Os bloqueadores de estreia e dissolução valem somente no trecho entre o verbo de formação e o valor procurado. Assim, uma frase pode provar formação em 2012 e citar dissolução em 2016 sem atribuir 2016 à formação.

A fixture editorial contém 273 casos extraídos da amostra real. Após a revisão de `formed by` para `P264`, ela marca 135 casos como prova e 138 como insuficientes. `text-evidence-v3` não aceita nenhum caso negativo e deixa 34 positivos sem aceite. O teste fixa os 34 IDs para que uma mudança de cobertura apareça na revisão do diff.

O localizador registra `pageid`, `revid` e o intervalo em pontos de código Unicode dentro de `extract`. `fact_evidence.snippet` guarda a frase, com até 300 caracteres.

Atributos de pessoa (`born_on`, `born_in`, `citizenship`, `speaks_language`, `plays_instrument`) só aceitam referência do Wikidata. O projeto ainda não coleta páginas de integrantes, e a página do grupo não comprova esses atributos.

## Alternativas consideradas

### Aceitar referências `P143`

Aumentaria a cobertura. `P143` indica a wiki de origem sem revisão nem trecho, e o fato ficaria sem local verificável. A alternativa foi rejeitada.

### Parser de infobox

Infoboxes concentram formação, gravadora e integrantes. O parser exigiria novos snapshots de wikitext, regras por template e fixtures de regressão. A fatia usa o resumo já preservado e registra a cobertura menor.

### Resolver conflitos pela hierarquia de lugares

Uma consulta a `P131` resolveria cidade e bairro como o mesmo local. Ela exigiria percorrer entidades de lugar com limite de profundidade. Os casos ficam como `conflict` para revisão.

## Consequências

- Todo fato `accepted` tem ao menos uma linha em `fact_evidence`. A execução falha se essa verificação encontrar exceções.
- Fatos `conflict`, `rejected` e `superseded` ficam registrados e não servem para perguntas.
- A busca textual prova menção em frase com contexto. Nenhuma das fontes atuais comprova automaticamente os qualificadores `P580` e `P582`; fatos com período recebem `validity_not_evidenced`.
- Duas execuções com `text-evidence-v3` processaram os mesmos 30 grupos, 197 entidades e 763 fatos em 6 lotes por execução. Cada uma terminou com 100 fatos aceitos, 565 rejeitados, 95 em conflito e 3 substituídos.
- O Wikidata publica dados sob CC0. O trecho da Wikipedia segue CC BY-SA e precisa manter o link da revisão ao ser exibido.
