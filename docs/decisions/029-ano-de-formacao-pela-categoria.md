# ADR 029 sobre ano de formação pela categoria da revisão

## Status

Aprovado em 2026-11-10. Altera a regra de `formed_on` da [ADR-004](004-wikidata-facts-and-evidence.md) e o trecho "Fora desta decisão" da [ADR-019](019-evidencia-da-infobox.md) só para a categoria descrita aqui. `years_active` continua sem provar formação.

## Contexto

A ADR-004 aceita o `formed_on` (P571) com referência confiável do Wikidata ou com uma frase do resumo em que o grupo é sujeito de "formed", "founded", "established" ou "created" seguido da data. No banco de 19 de outubro de 2026, só 87 dos 552 grupos tinham `formed_on` aceito. Dos 323 rejeitados, 306 eram `missing_evidence`: o P571 cita só `P143` ("importado da Wikipédia") e o resumo diz "formed by JYP Entertainment." sem ano.

Com isso, as casas de década da grade quase não tinham grupos de JYP e YG. Big Bang, GOT7, Wonder Girls, DAY6 e 2AM ficavam de fora. No artigo deles, a única menção datada da formação é a categoria `Musical groups established in AAAA`. Numa amostra de 105 grupos com wikitext e P571, essa categoria tinha o mesmo ano do P571 em 103. As exceções foram 2NB (P571 2006, categoria 2008) e Dreamcatcher (P571 2016, categoria 2014, ano da formação anterior como MINX).

## Decisão

### Regra da categoria

Um P571 com precisão de ano é aceito quando o wikitext da mesma revisão que o catálogo analisou tem o link `[[Category:Musical groups established in AAAA]]` com o mesmo ano. Vale só o link escrito no wikitext, fora de comentários. Uma chave de ordenação (`|BigBang`) não muda nada. Categoria que um template acrescenta não aparece no wikitext e não conta.

- A categoria prova só o ano. Um P571 com precisão de mês ou dia continua precisando de referência confiável ou da frase do resumo, mesmo quando o ano coincide (ITZY, `2019-02-12`, categoria 2019).
- Só vale a mesma revisão cujo resumo e infobox já servem de evidência. Outra revisão, outro idioma ou a página de categoria não contam.
- Todas as categorias desse tipo na revisão precisam ter o ano do P571.

A regra só é consultada sem referência confiável do Wikidata. O localizador segue o da [ADR-019](019-evidencia-da-infobox.md): `wikipedia:<idioma>:pageid=<pageid>:revid=<revid>#wikitext[início:fim]`, com o intervalo do link em pontos de código Unicode. `fact_evidence.snippet` guarda o link, como `[[Category:Musical groups established in 2006]]`. `EVIDENCE_RULES_VERSION` passa a `text-evidence-v9`. `EXTRACTOR_VERSION` e `SOURCE_POLICY_VERSION` não mudam.

### Ano divergente

Quando uma dessas categorias tem outro ano, o fato fica `rejected` com o motivo `formation_category_year_differs`, em qualquer precisão do P571. A revisão contradiz o valor, então nem a frase do resumo da mesma revisão serve de prova: a regra falha fechada. O link lido fica em `fact_issues` com o localizador. Uma referência confiável do Wikidata continua valendo antes de qualquer leitura da página.

### Divergências conhecidas

Na amostra do ticket, 2NB (`Q16097960`, revisão 1317639217) tem P571 2006 e categoria 2008. O resumo diz "formed by Friday Entertainment in 2006", e por isso o fato era aceito. Com esta regra ele passa a `formation_category_year_differs`. Dreamcatcher (`Q20684822`, revisão 1372613936) tem P571 `2016-11-29` e categoria 2014.

## Alternativas consideradas

### Aceitar `years_active` da infobox

Rejeitada de novo pelo motivo da ADR-019: o campo marca o início das atividades. A categoria nomeia a formação.

### Critério novo "Em atividade desde"

Teria semântica mais limpa e cobriria TWICE, que não tem P571, e ITZY. Exige predicado, regra, categoria no schema da grade e textos na web. Fica para outra decisão.

### Ignorar a categoria divergente quando o resumo prova o ano

Manteria o 2NB aceito. Foi rejeitada porque uma revisão que afirma dois anos diferentes para a formação não serve de prova para nenhum deles.

### Gerador evitar casas sem cobertura

Não aumenta a cobertura. Com os dados atuais, qualquer filtro novo deixaria dias sem grade.

## Consequências

- A reaplicação a uma cópia do banco de 19 de outubro de 2026, com as revisões e os snapshots do Wikidata já guardados nele e o wikitext dessas revisões, mudou só fatos `formed_on`. Os aceitos passaram de 87 para 298: 212 novos, todos com precisão de ano e evidência da categoria, e 1 perdido (2NB). 19 fatos ficaram `formation_category_year_differs`, entre eles AKMU (P571 2014, categoria 2012) e Winner (2014 contra 2013), ambos da YG, que já estavam rejeitados.
- As casas de década com JYP ou YG ganharam grupos. Anos 2000 × JYP: 2AM e Wonder Girls, além de 2PM. Anos 2000 × YG: BigBang, além de 2NE1. Anos 2010 × JYP: Got7, JJ Project e Miss A, além de 15& e Stray Kids. Anos 2010 × YG: Blackpink, GD X Taeyang e GD&TOP, além de Hi Suhyun. Anos 1990 × YG: 1TYM. Anos 2020 × JYP: KickFlip e Xdinary Heroes.
- A categoria é classificação editorial sem citação no texto. Um erro dela que coincida com um P571 errado passa. O risco é o mesmo de aceitar o resumo sem referência.
- A linha do tempo e o quiz recebem anos de formação com precisão de ano, que eles já tratavam.
- O wikitext segue CC BY-SA, como o resumo, e o trecho exibido mantém o link da revisão.
- Esta decisão e a mudança de código não publicam dados. Os fatos novos chegam aos jogos na próxima coleta.
