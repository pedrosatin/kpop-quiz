# Política de coleta

## Fonte atual

A descoberta consulta `Category:K-pop music groups` na Wikipedia em inglês por meio de `list=categorymembers`. O detalhe das páginas usa `prop=extracts|info|pageprops|revisions`. `pageprops` fornece o QID e a marca de desambiguação. `info` identifica redirecionamentos sem segui-los.

O classificador consulta `wbgetentities` no Wikidata somente para obter a revisão da entidade e os valores diretos de `P31`.

A etapa de fatos (`--facts`, `--facts-limit` ou `--facts-report`) lê os grupos aceitos na ordem de `pageid`, até o limite informado. Ela consulta o Wikidata em cinco fases sequenciais:

1. grupos com o perfil `subject-v1`;
2. valores de `P527` com o mesmo perfil, classificados como pessoa quando `P31` contém `Q5`;
3. grupos fora do limite citados em `member_of`, com o perfil `subject-v1`, para conferir o outro lado do vínculo;
4. países, com o perfil `country-v1`, que inclui `P31`;
5. organizações, outros lugares, gêneros, idiomas e instrumentos, com o perfil `label-v1`.

Cada fase envia lotes de até 50 QIDs. `subject-v1` usa `props=info|labels|aliases|claims|sitelinks/urls`, `languages=pt|en|ko` e `sitefilter=enwiki|ptwiki|kowiki`. `country-v1` usa `props=info|labels|aliases|claims`. `label-v1` usa `props=info|labels|aliases`. Os três perfis pedem os mesmos idiomas. A amostra de 30 grupos precisou de seis lotes.

Um QID inexistente faz o Wikibase recusar o lote inteiro com `no-such-entity`. O cliente registra esse QID como ausente e repete o lote sem ele. Itens apagados chegam com `"missing": ""` e também entram como ausentes. Redirecionamentos preservam o QID pedido e o QID final.

## Regras HTTP

- Definir `User-Agent` com nome, versão e contato.
- Fazer requisições em série.
- Usar `maxlag=5` em jobs não interativos.
- Aplicar timeout de 30 segundos.
- Repetir até três vezes erros `maxlag`, HTTP 429, HTTP 500, 502, 503 e 504, timeouts e falhas de conexão.
- Esperar `2^tentativa` segundos ou o valor de `Retry-After`, o que for maior. `Retry-After` aceita segundos ou data HTTP. Um pedido de espera acima de 120 segundos encerra a execução sem aguardar.
- Não repetir outros erros HTTP 4xx.
- Consultar detalhes em lotes de até 20 páginas e enviar `exlimit` explicitamente. O módulo TextExtracts limita quantos resumos uma consulta retorna.
- Registrar falha da execução sem apagar uma coleta anterior válida.

As regras seguem a documentação oficial de [etiqueta da API](https://www.mediawiki.org/wiki/API%3AEtiquette/en) e [membros de categoria](https://www.mediawiki.org/wiki/API%3ACategorymembers/en).

## Qualidade

A categoria é um mecanismo de descoberta. O classificador `group-catalog-v1` aplica as regras nesta ordem:

1. título iniciado por `List of` ou `Lists of` recebe `list_page`;
2. página de desambiguação recebe `disambiguation_page`;
3. redirecionamento recebe `redirect_page`;
4. QID ausente ou inválido recebe `missing_or_invalid_wikidata_id`;
5. entidade ausente no Wikidata recebe `wikidata_entity_missing`;
6. `P31` fora da lista aceita recebe `incompatible_wikidata_instance`;
7. os demais candidatos recebem `accepted`.

O classificador aceita os tipos diretos grupo musical, boy band, girl group, conjunto musical, duo musical e banda de rock. A lista usa os QIDs `Q215380`, `Q216337`, `Q641066`, `Q2088357`, `Q9212979` e `Q5741069`. O CSV expõe os tipos rejeitados para que uma revisão amplie a lista sem aceitar classes genéricas por inferência.

Uma página ausente entre a descoberta e a consulta não possui revisão para análise. O coletor registra `missing_page` em `collection_issues` e não cria uma entrada no catálogo.

Parsers de infoboxes e tabelas devem operar sobre fixtures versionadas. Uma mudança de seletor exige teste com a página que causou a regressão. Valores temporais preservam precisão de dia, mês ou ano.

## Proveniência

Toda afirmação registra provedor, URL canônica, identificador da página, revisão, data de consulta e local da evidência. Se duas fontes divergirem, o sistema mantém as duas afirmações e marca o conflito.

## Snapshots

Cada página retornada pelo adaptador gera um JSON canônico. A serialização ordena chaves, usa UTF-8, remove espaços opcionais e rejeita valores numéricos que não pertençam ao JSON. O coletor calcula o SHA-256 desses bytes e só então os comprime com gzip.

O caminho segue `<provedor>/<idioma>/<pageid>/<revid>.json.gz` dentro do diretório configurado. O banco guarda o caminho relativo para permitir a movimentação conjunta do banco e da pasta. Se o caminho já existir, o coletor descomprime o arquivo, confere o hash e reaproveita o snapshot.

Uma revisão não pode mudar de conteúdo. Se a API ou o disco apresentar bytes diferentes para a mesma identidade, a execução falha e mantém o estado anterior no banco.

`pageprops` fica nas colunas estruturadas de `source_pages`, fora do snapshot da revisão. Esse campo pode mudar mesmo que o texto da Wikipedia mantenha o mesmo `revid`. Uma mudança no QID, na marca de desambiguação ou em outro metadado usado pelo classificador devolve a entrada ao estado `candidate`. `catalog_entries.analyzed_wikidata_id` registra o QID usado na decisão.

O exportador neutraliza texto externo iniciado por `=`, `+`, `-` ou `@` antes de gravá-lo no CSV. Essa regra impede que planilhas executem um título ou identificador como fórmula.

## Licenças

A Wikipedia publica texto sob CC BY-SA, conforme os [termos de uso da Wikimedia](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use). O Wikidata publica os dados estruturados do namespace principal sob CC0, conforme a [política de dados](https://www.wikidata.org/wiki/Wikidata:Data_access). O produto deve manter os links das revisões consultadas e a atribuição exigida para conteúdo da Wikipedia.

Os dados do Wikidata extraídos como fatos, rótulos e aliases seguem CC0 e não exigem atribuição. Trechos do resumo da Wikipedia gravados em `fact_evidence.snippet` seguem CC BY-SA 4.0. Qualquer exibição desses trechos precisa citar a Wikipedia, apontar para a revisão (`https://en.wikipedia.org/w/index.php?oldid=<revid>`) e manter a mesma licença.

Os clientes usam requisições sequenciais, `User-Agent`, timeout, `maxlag=5` e até três repetições. A validação atual cobre somente `P31` direto. Ela não percorre a hierarquia `P279` e pode rejeitar um grupo modelado apenas com uma subclasse desconhecida.

## Validação de fatos

O extrator `wikidata-facts-v2` ignora afirmações `deprecated`, `somevalue` e `novalue`. Um valor `preferred` torna `superseded` os valores `normal` da mesma propriedade e do mesmo sujeito. Datas precisam de precisão de ano, mês ou dia, calendário gregoriano e uma data civil válida. A data guarda somente os componentes da precisão declarada: `+2007-01-01T00:00:00Z` com precisão 9 vira `2007`.

`born_on` com precisão menor que dia recebe `insufficient_precision_for_age`. Um vínculo sem `P580` recebe `membership_start_unknown`. Um `P582` desconhecido recebe `end_date_unknown`. Mais de um `P580` ou `P582` na mesma afirmação gera `ambiguous_temporal_qualifiers`.

Valores diferentes de mesmo rank em predicados de valor único recebem `conflict` com `same_rank_values_differ`. Datas em que uma refina a outra não geram conflito. O validador compara `has_member` do grupo com `member_of` da pessoa. A ausência de um dos lados gera `membership_counterpart_unverified`. Datas incompatíveis geram `membership_period_mismatch`. Se apenas um lado informa `P580` ou `P582`, os dois fatos recebem `membership_period_unconfirmed`. Um `P582` ausente não comprova vínculo atual.

`P248` e `P854` identificam a origem de uma referência. O validador só aceita a referência quando a [política de fontes](source-policy.md) classifica a origem como `reliable`. Sem uma referência aceita, predicados do grupo e de vínculo procuram o nome ou a data no resumo da revisão da Wikipedia analisada pelo catálogo. A busca exige sujeito, relação e valor na mesma frase. Datas e lugares de formação precisam ligar o verbo ao grupo. Países usam uma lista revisada de nomes e gentílicos. Mudanças de integrante precisam nomear o grupo na frase sem outro referente possível. O fallback de `record_label` aceita somente `signed to` e `signed with`. A busca trata hífen como parte da palavra, conforme o [ADR 004](decisions/004-wikidata-facts-and-evidence.md). Atributos de pessoa exigem referência do Wikidata. Fatos sem evidência recebem `rejected` com `missing_evidence`, `unreliable_reference_source` ou `unreviewed_reference_source`.

## Relatório de cobertura

`facts-coverage.csv` tem uma linha por grupo aceito e predicado. Linhas `group` contam os fatos do grupo. Linhas `member` somam os fatos das pessoas ligadas ao grupo por `has_member` ou `member_of`. As colunas trazem totais por estado, número de sujeitos, sujeitos com fato aceito e `coverage`, com os valores `missing`, `no_accepted`, `partial` ou `covered`.

A coleta de 13 de setembro de 2026 usou `--limit 60 --facts-limit 30` e processou 30 grupos e 197 entidades em seis lotes. O resultado teve 100 fatos aceitos, 565 rejeitados, 95 em conflito e 3 substituídos. O banco guardou 763 fatos. A segunda execução repetiu as mesmas contagens. A política encontrou 20 chaves de origem em 49 fatos distintos; 12 fatos ficaram inelegíveis por origem ainda não revisada.
