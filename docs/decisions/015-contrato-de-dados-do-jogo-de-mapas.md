# ADR-015. Contrato de dados do jogo de mapas

## Status

Accepted for the internal pilot; publication remains blocked

## Date

2026-09-22

## Contexto

O jogo de mapas terá desafio diário e modo livre. A resposta será um país selecionado no mapa. Os temas planejados são origem de grupos, local de nascimento de integrantes e cidades de turnês.

O modelo atual coleta `origin_country` de `P495` e `born_in` de `P19`. `born_in` pode apontar para cidade, bairro ou outro lugar, e a extração atual não guarda uma hierarquia geográfica para resolver esses valores a um país. A documentação do modelo descreve os predicados de turnê e apresentação. O pipeline ainda não os implementa.

Uma verificação exploratória de páginas oficiais encontrou agendas com data, cidade e local para várias regiões. A agenda da turnê mundial de BLACKPINK publicada no site da YG lista, por exemplo, Goyang, Los Angeles, Paris, Bangkok, Jacarta, Singapura e Tóquio. Avisos oficiais hospedados no Weverse também publicam itinerários extensos, como os de NCT 127 e Baekhyun. Essas páginas são candidatas para um piloto de cobertura. A política editorial, os termos de reutilização e a resolução dos locais seguem sem validação. Nenhum desses dados foi incorporado ao catálogo.

## Decisão proposta

MusicBrainz será usado somente para localizar candidatos a eventos, artistas e locais. A base oficial lista eventos entre seus dados centrais sob CC0 e representa participantes e local por relações. O projeto atualmente classifica MusicBrainz como fonte não confiável em `docs/source-policy.md`; seus registros não serão prova suficiente para publicar uma pergunta.

O coletor seguirá o limite publicado pela API de no máximo uma chamada por segundo e enviará um `User-Agent` identificável do projeto. O piloto deverá medir quantos grupos do catálogo têm eventos associados antes da escolha final da fonte.

Cada evento elegível também precisa de uma fonte primária revisada, como página oficial do grupo, agência, promotora ou local do show, que confirme o grupo, a data e o local. A chave da fonte precisa ser aprovada pela política versionada do projeto. Se não houver confirmação, o evento fica fora do conjunto jogável.

O piloto de cobertura deve começar por agendas mantidas por grupos ou agências e avisos oficiais de turnê publicados em plataformas como Weverse. Deve registrar URLs e uma pequena amostra de linhas, verificar termos e licença aplicáveis, e resolver cada cidade a país por identificador geográfico estável. Uma página acessível ou publicada por conta oficial não é, por si só, aprovação para coleta automatizada ou cópia persistente. Até a revisão exigida por `docs/source-policy.md`, esses domínios permanecem `unreviewed`.

O mapa de países usará a camada Natural Earth Admin 0. A página informa que há 258 países e descreve a separação entre países e unidades de mapa. Os limites padrão representam fronteiras de facto. Cada versão incorporada terá a versão do conjunto, a escala e o identificador da feição registrados. Entidades sem correspondência inequívoca ficam fora das perguntas.

`setlist.fm` não será usado como armazenamento de dados do jogo. Seus termos limitam o uso da API a projetos não comerciais sem autorização adicional e permitem somente cache por curto período, com chamadas diretas e atribuição obrigatória. Isso não atende à publicação estática e determinística usada pelo projeto.

## Contrato normalizado

O pipeline deve preservar IDs dos provedores e normalizar os fatos necessários para uma pergunta geográfica. Nomes são rótulos de exibição, nunca chaves de junção.

| Campo | Regra |
| --- | --- |
| `subject_wikidata_id` | QID do grupo ou integrante do catálogo. |
| `predicate` | `origin_country`, `born_in` ou `announced_performance_city`. |
| `value_provider` e `value_id` | Provedor e ID estável do país, local ou evento. Para MusicBrainz, guardar MBID; para Wikidata, QID. |
| `event_mbid` | MBID do evento candidato. Obrigatório para `announced_performance_city`. |
| `artist_musicbrainz_mbid` | MBID do artista ligado ao QID do grupo. A associação precisa de revisão e não pode depender só de nome. |
| `event_date`, `event_type` e `schedule_status` | Data completa em `YYYY-MM-DD`, tipo `concert` e estado `listed`. `listed` significa que a fonte oficial mostrava a entrada na data da revisão. Não afirma que o show ocorreu. |
| `billing_role` | `headliner` ou `co_headliner`. Atrações de apoio ou sem posição confirmada são inelegíveis. |
| `place_mbid` e `city_area_mbid` | MBIDs do local e da cidade, quando disponíveis. A cidade precisa resolver a um país sem ambiguidade. |
| `tour_mbid` | MBID da turnê, opcional. Só preencher quando a fonte relacionar explicitamente o evento à turnê. |
| `country_wikidata_id` | QID do país resolvido por relação geográfica explícita. Obrigatório para perguntas jogáveis. |
| `country_iso_3166_1` | Código ISO 3166-1 alpha-2 validado contra o país resolvido. |
| `map_dataset` e `map_feature_id` | Nome e versão do conjunto de geometrias, mais identificador da feição correspondente. |
| `source_url` e `source_locator` | URL da evidência e localizador da data/cidade dentro da página. A validação do host não verifica o conteúdo da página. |
| `source_checked_at` | Data ISO em que a entrada da agenda foi conferida manualmente. |
| `content_sha256` | Hash da resposta consultada. Só guardar se a licença e os termos da fonte permitirem. Não guardar cópia do conteúdo sem autorização. |
| `status` | `candidate`, `accepted`, `rejected` ou `conflict`, com motivo para estados diferentes de `accepted`. |

Regras específicas:

1. `origin_country` só entra no mapa quando QID, código ISO e feição de país apontam para a mesma entidade.
2. `born_in` só entra quando o local tem país pai explícito e aceito. O pipeline não infere país por nome, capital ou coordenada aproximada. Valores conflitantes ou sem hierarquia ficam fora do jogo.
3. `announced_performance_city` exige uma entrada de agenda com MBID, artista associado por identificador estável, data completa, local, cidade resolvida e país. O estado `listed` registra a publicação da data e não confirma a realização. Associações ambíguas e apresentações em que o grupo aparece apenas como atração de apoio não entram no MVP.
4. O nome da turnê é opcional. Se a fonte não vincular o show a uma turnê específica, a pergunta descreve uma apresentação, sem atribuir nome de turnê.
5. Cada pergunta publicada referencia um fato aceito, sua evidência e a versão do conjunto de geometrias. A seleção do país no mapa compara o ID normalizado da resposta, não o ponto aproximado do toque.

## Consequências

Antes da publicação, cada tema precisa de uma medição reproduzível da cobertura e da distribuição de países no catálogo elegível. Nascimento de integrantes requer referências aceitas e resolução hierárquica de lugares. Para turnês, a próxima etapa é um piloto pequeno com agendas oficiais, revisão de termos e fonte, associação identificada entre grupo e evento, e resolução de cidade para país. O uso de MusicBrainz permanece restrito à descoberta de candidatos.

O conjunto diário deve ser gerado a partir de fatos aceitos e versão fixa das geometrias. O modo livre usa o mesmo conjunto elegível, com seleção de tema. Ambos mantêm a regra de resposta exata por país.

Esta aceitação fixa o contrato semântico e o escopo do piloto interno. Não aprova YG, Weverse ou MusicBrainz como fontes persistentes, nem autoriza coletor ou publicação. O resultado do piloto e as condições para reabrir a implementação estão em [Piloto do jogo de mapas](../map-game-pilot.md).

## Etapa de cobertura offline

O comando `python -m kpop_scraping.geo_coverage --database <banco.sqlite> --output <relatorio.json>` lê um banco existente em modo somente leitura e resume grupos com fatos processados, distribuição de `origin_country` aceitos e valores `born_in` aceitos. O relatório não resolve cidades a países e não consulta fontes externas. Essa medição precede qualquer coletor de agendas ou conjunto de perguntas.

## Escopo inicial do piloto de turnês

A primeira amostra será a agenda oficial da DEADLINE WORLD TOUR de BLACKPINK. A página da YG lista várias datas e cidades, e a série da turnê no MusicBrainz contém eventos com IDs, datas, artista principal e locais. MusicBrainz serve apenas para localizar candidatos. A revisão manual compara cada data e cidade com a agenda da YG.

A pergunta do jogo será: "Em qual país a agenda oficial listou uma apresentação de BLACKPINK em YYYY-MM-DD?" A resposta descreve o que a agenda publicou e não afirma que a apresentação ocorreu. Cada data é um evento separado, inclusive quando há várias apresentações na mesma cidade.

A amostra será montada sem crawler e sem cópias de páginas. Cada registro candidato terá os IDs estáveis do evento e das entidades geográficas, a URL oficial e um localizador que permita revisar a data e a cidade. Hash e data de consulta só serão guardados se os termos da fonte permitirem. A fonte permanece `unreviewed` para coleta automatizada e publicação até a revisão da política. O relatório de piloto não será usado como conjunto jogável.

O relatório contará candidatos localizados, datas confirmadas na agenda oficial, países distintos, cidades sem resolução inequívoca, datas repetidas por cidade e associações de artista não revisadas. A cobertura observada decidirá se outra turnê ou grupo entra na amostra.

O levantamento de 24 de setembro de 2026 encontrou 33 datas em 16 destinos na agenda da YG e 31 eventos candidatos na série MusicBrainz. Os 31 registros foram comparados com a agenda por data e local; duas datas não têm candidato correspondente: 28 de novembro de 2025 em Singapura e 26 de janeiro de 2026 em Hong Kong. O crosswalk Natural Earth 5.1.1 relaciona os países a feições por `WIKIDATAID`. A hierarquia geográfica resolve Hong Kong para China (`Q148`, `CN`, feição `CHN`) e Taiwan para a feição `TWN`. O protótipo PT/EN está implementado, com 10 perguntas por rodada, ligações para evidência e rotas `noindex`. `noindex` e a ausência no sitemap não impedem acesso direto: as páginas e os candidatos integram o build estático. A fonte YG permanece `unreviewed` para coleta e publicação. Detalhes, artefatos e limitações estão em [Piloto do jogo de mapas](../map-game-pilot.md).

## Revisão de fontes e contrato de candidatos

A revisão de fontes não encontrou licença que autorize a coleta automatizada e a persistência de agendas da YG ou do Weverse. O site institucional da YG declara que todo o conteúdo da empresa é protegido por direitos autorais. A lei sul-coreana também prevê direitos de produtores de bases de dados; esta ADR não determina se a agenda se enquadra nesses direitos ou se um uso específico os violaria. Para membros, os termos integrados atuais do Weverse, vigentes desde 1º de junho de 2026, limitam o uso de conteúdo ao escopo pessoal e não comercial e restringem cópia, publicação e compartilhamento sem permissão. Eles não esclarecem a extração de campos factuais de avisos públicos. Os dois domínios seguem `unreviewed` para agendas; a permissão para referenciar uma fonte Wikidata não autoriza coletar sua agenda.

`kpop_scraping/tour_events.py` valida registros sem rede ou banco. Novos registros de agenda exigem `schedule_status="listed"`, `source_locator` e `source_checked_at`; o formato legado `event_status` permanece apenas para os fixtures sintéticos existentes. A validação exige associação revisada entre QID e MBID, artista relacionado ao evento, local ligado a uma única cidade, resolução única da cidade para país, data válida e papel de atração principal ou co-principal. O resultado mantém `status=candidate`; o validador não aceita fatos nem aprova fontes. As URLs dos fixtures usam `example.com`. A validação do host não confere o conteúdo da página. A implementação não autoriza ingestão de YG, Weverse ou MusicBrainz.

`kpop_scraping/country_crosswalk.py` implementa o crosswalk offline país→feição. Ele relaciona QIDs revisados a `WIKIDATAID` das feições Natural Earth e retorna o identificador `ADM0_A3`; para feições sem QID válido, usa ISO 3166-1 alpha-2 com `ISO_A2`. Nomes não participam das junções. Identificadores ausentes ou associados a mais de uma feição ficam sem correspondência. O artefato registra versão, escala e quantidade de feições, além de receber um hash canônico. A suíte contém casos sintéticos e uma amostra reduzida com três associações reais.

O teste de regressão `tests/fixtures/natural_earth_511_country_sample.json` preserva três associações reais de identificadores sem incluir geometrias. A propriedade `P297` de `Q836` inclui `MM` e o código antigo `BU`; a seleção de `MM` segue o histórico publicado pela ISO, que registra a mudança de Burma (`BU`) para Myanmar (`MM`) em 1989. A revisão usou os códigos como identificadores geográficos, sem alterar a política que impede fatos do Wikidata de sustentar respostas de quiz.

O crosswalk valida a correspondência dos códigos ISO revisados com IDs `ADM0_A3`. Ele não inspeciona geometrias nem determina se o catálogo tem diversidade suficiente para partidas diárias.

A página da camada Natural Earth Admin 0 informa a contagem de 258 países, apresenta a versão 5.1.1 na escala 1:10m e explica que as fronteiras padrão representam o controle de facto. A página de termos declara os dados vetoriais e raster como domínio público. O crosswalk valida o formato sintático de ISO 3166-1 alpha-2. Ele não consulta um registro ISO oficial. O chamador deve fornecer somente países com código revisado. Países sem código ou com feição ausente ou ambígua permanecem fora do conjunto elegível.

## Fontes

- [MusicBrainz Database e licenças](https://musicbrainz.org/doc/MusicBrainz_Database)
- [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API)
- [MusicBrainz API: exemplo de evento, artista e local](https://musicbrainz.org/doc/MusicBrainz_API/Examples)
- [Termos de uso da API setlist.fm](https://www.setlist.fm/help/terms)
- [Natural Earth Admin 0: Countries](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/)
- [Natural Earth GeoJSON, tag v5.1.1](https://github.com/nvkelso/natural-earth-vector/blob/v5.1.1/geojson/ne_10m_admin_0_countries.geojson)
- [Natural Earth terms of use](https://www.naturalearthdata.com/about/terms-of-use/)
- [Natural Earth vector data source](https://github.com/nvkelso/natural-earth-vector)
- [Wikidata property P297](https://www.wikidata.org/wiki/Property:P297)
- [Wikidata Q252](https://www.wikidata.org/wiki/Q252), [Q836](https://www.wikidata.org/wiki/Q836) e [Q884](https://www.wikidata.org/wiki/Q884)
- [ISO glossary for ISO 3166](https://www.iso.org/glossary-for-iso-3166.html)
- [ISO 3166-1 Newsletter VI-9, Myanmar](https://www.iso.org/iso/newsletter_vi-9_fiji-myanmar_and_other_minor_corrections-incl_bulgaria_corrected_2011-07-14_e_.pdf)
- [ISO 3166-2 Newsletter II-1, Indonesia](https://www.iso.org/iso/iso_3166-2_newsletter_ii-1_corrected_2010-02-19.pdf)
- [ISO 3166-2 Newsletter I-1, Korea, Republic of](https://www.iso.org/iso/iso_3166-2_newsletter_i-1_en.pdf)
- [Agenda oficial da turnê mundial de BLACKPINK, YG Entertainment](https://artist.ygfamily.com/ARTISTS/BLACKPINK/concert/2025TOUR/index2.html)
- [Site institucional da YG Entertainment](https://www.ygfamily.com/en/main)
- [Termos integrados atuais do Weverse](https://cdn-contents.wemember.io/public/terms-documents/latest/weverse-1:en.html)
- [Aviso do Weverse sobre os termos integrados com vigência em janeiro de 2026](https://weverse.io/notice/33087)
- [Aviso oficial da turnê NCT 127 no Weverse](https://weverse.io/nct127/notice/23429)
- [Aviso oficial da turnê de Baekhyun no Weverse](https://weverse.io/baekhyun/notice/26863)
- [ADR 004: fatos do Wikidata e evidências](004-wikidata-facts-and-evidence.md)
- [Política de fontes](../source-policy.md)
