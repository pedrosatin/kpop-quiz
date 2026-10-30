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

## Infobox da página da própria pessoa

A [ADR-027](decisions/027-evidencia-de-pessoa-pela-infobox.md) aceita a primeira
infobox da página da própria pessoa na Wikipedia em inglês como evidência de
`born_on` (`birth_date`) e `born_in` (`birth_place`), e só deles.

- **Responsável e tipo de dado**: a comunidade editora da Wikipedia. A infobox
  comprova data e local de nascimento da pessoa cuja página é; não comprova
  nacionalidade, idioma, instrumento nem vínculo com grupo.
- **Identidade**: `pageprops.wikibase_item` igual ao QID da pessoa, sem
  redirecionamento e sem desambiguação. Resumo, corpo, categorias e página de
  grupo não servem.
- **Licença e atribuição**: o wikitext é CC BY-SA 4.0. O projeto guarda o
  trecho, o `pageid` e o `revid`; quem exibir o trecho mantém o link da revisão
  (`oldid`), que leva ao histórico de autores.
- **Limites de uso**: leitura por API com `maxlag`, em sequência, timeout e
  `User-Agent` identificável. O sistema não copia o texto da página além do
  trecho citado (até 300 caracteres).
- **Cobertura**: pessoas com sitelink `enwiki`. Na amostra de 100 pessoas, 88
  tinham página própria; a infobox confirmou 50 de 52 datas e 68 de 80 locais.
  Divergências viram `wikipedia_value_differs`, e campos ilegíveis viram
  `wikipedia_value_ambiguous`.
- **Prioridade**: uma referência confiável do Wikidata continua valendo antes da
  infobox e não é rebaixada por ela.
- **Ativação**: a fonte vem desligada. Só `python main.py --person-evidence`, numa
  cópia do banco, a coleta e a aceita. O cron diário não a usa, e uma execução sem
  a opção preserva os fatos já aceitos sem aceitar fato novo (ADR-027, seções
  Ativação e Preservação sem a opção).
