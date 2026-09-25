# Política de fontes das referências

## Estados

`sources-v2` classifica cada origem como `reliable`, `unreliable` ou `unreviewed`.
Somente `reliable` pode sustentar um fato. Uma referência com origem desconhecida
recebe `unreviewed_reference_source`; uma origem negada recebe
`unreliable_reference_source`. Os dois motivos tornam o fato inelegível para quiz.

O extrator cria a chave `wikidata:<QID>` a partir de `P248`. Para `P854`, ele
reduz a URL ao domínio registrável e cria `domain:<domínio>`. A linha em
`fact_evidence` guarda a chave que autorizou o aceite. `references_json` mantém
todas as chaves e seus estados.

A normalização de `P854` aceita somente URLs com esquema `http` ou `https` e
hostname DNS ASCII válido. Endereços IP e URLs sem esquema geram a chave
`invalid:P854`, classificada como `unreviewed`. Um `P248` malformado gera
`invalid:P248`. Essas chaves impedem que outra origem válida da mesma referência
autorize o fato. O projeto não baixa a Public Suffix List. Por isso, `sources.py` mantém uma lista
local e curta de sufixos revisados. Um sufixo fora dessa lista permanece
`unreviewed`; o normalizador não reduz `example.co.in` a `co.in` nem
`project.github.io` a `github.io`.

A lista local pode ficar desatualizada quando uma fonte usa outro sufixo ou
quando a política de um domínio muda. Toda chave `domain:` passa de novo pela
validação de sufixo antes da consulta às listas de aceite e negação. Assim, uma
entrada futura em `RELIABLE_SOURCES` não autoriza uma chave obtida por colapso
incorreto. A inclusão de outro sufixo exige caso de teste com um domínio
registrável e, quando aplicável, com provedores de hospedagem que compartilham o
mesmo sufixo.

## Cobertura da amostra

A execução de 13 de setembro de 2026 coletou 60 páginas da categoria e processou
os primeiros 30 grupos aceitos. Entre 763 fatos, 49 apontaram para uma origem em
`P248` ou `P854`. A fixture
`tests/fixtures/reference_source_coverage.json` registra as 20 chaves observadas e
a quantidade de fatos por chave.

As origens mais frequentes foram ČSFD, com 12 fatos, `naver.com`, com 5,
`4min.co.kr`, com 4, `after--school.jp`, com 4, e `kpopsingers.com`, com 4.
A política negou ČSFD, IMDb, Discogs, MusicBrainz, Wikipédia, Wikidata, sites de
fãs e catálogos derivados. Sites oficiais já revisados e veículos com edição
identificada ficaram na lista de aceite. Doze fatos continuaram inelegíveis por
origem não revisada nessa execução.

## Inclusão de uma fonte

Uma alteração na lista exige estes registros:

1. chave normalizada e quantidade de fatos observada em uma amostra reproduzível;
2. responsável pelo conteúdo, política editorial e tipo de dado que a fonte pode
   comprovar;
3. licença, atribuição exigida e limites de uso quando o sistema copiar conteúdo;
4. fixture com o estado esperado e teste de regressão;
5. nova versão de `SOURCE_POLICY_VERSION` se a mudança alterar a elegibilidade de
   fatos já armazenados.

Uma fonte permanece `unreviewed` até cumprir os itens acima. O processo não
promove domínios apenas porque parecem oficiais ou aparecem muitas vezes.

## Agendas oficiais de turnê

As regras acima tratam das referências de fatos do Wikidata. O jogo de mapas usa
outra fonte, a agenda oficial de turnê publicada pelo artista ou pela agência.
A agenda da YG da DEADLINE WORLD TOUR está aprovada para data, cidade e local de
cada show. O projeto guarda só esses fatos e o localizador da entrada, e cada
pergunta leva o link da agenda. Um evento só entra no jogo depois do cruzamento
com o MusicBrainz e com o `P17` do Wikidata, descrito na
[ADR-015](decisions/015-contrato-de-dados-do-jogo-de-mapas.md) e em
[Piloto do jogo de mapas](map-game-pilot.md).
