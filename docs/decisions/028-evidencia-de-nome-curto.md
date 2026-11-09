# ADR 028 sobre evidência de nome curto em crédito e lista de integrantes

## Status

Proposta em 2026-11-08. Altera as regras de `performed_by` e de lista de integrantes da [ADR-004](004-wikidata-facts-and-evidence.md). Fato novo só entra em jogo publicado depois da auditoria por amostra e da aprovação do operador.

## Contexto

A regra de `performed_by` só usava nomes com 4 caracteres ou mais (`MIN_NAME_LENGTH`), salvo nome com espaço ou dígito. O limite protege contra palavras comuns, mas tira da evidência todo grupo cujo nome é sigla ou palavra curta. No banco de 19 de outubro de 2026, BTS tinha 65 afirmações `performed_by`, todas rejeitadas por `missing_evidence`, 43 delas com página em inglês aceita. A mesma frase aceitava "Stray Kids" e recusava "BTS". O catálogo tem 40 grupos nessa situação, alguns com nome que é palavra comum, como `Can`, `Toy` e `UN`.

Nas listas de integrantes, `membership_evidence` já usa mínimo 2 caracteres: "RM" passa e "V" não, no resumo da revisão 1376754986 da página de BTS. Com isso o grupo fica com 6 dos 7 integrantes.

A regra de crédito não descobre artista. Ela só confere o artista que o P175 do Wikidata já declara para aquele lançamento, numa página ligada ao mesmo QID. O risco de um nome curto é outro: casar uma palavra da frase que não é o nome.

## Decisão

### Crédito de artista

Um nome com menos de 4 caracteres, sem espaço nem dígito, conta no crédito quando tem pelo menos 2 caracteres e uma letra maiúscula, e quando a frase o escreve com a mesma grafia, maiúsculas incluídas. `Can` não casa `can` nem `CAN`; `BTS` não casa `bts` nem `Bts`. Nome em alfabeto sem maiúsculas, como hangul, fica de fora da regra curta.

As demais condições continuam valendo: substantivo de lançamento logo antes de "by" ou "por", o nome como item inteiro de uma lista feita só de artistas declarados no P175, e fim de item em vírgula, ponto, ponto e vírgula ou fim da frase. "by Toy Story", "by UN Women", "by Can's producer" e "produced by Can" continuam sem provar nada. Nomes com 4 caracteres ou mais, ou com espaço ou dígito, seguem sem diferenciar maiúsculas, como antes.

### Grafia do título da página do grupo

A Wikipedia em inglês escreve "Exo" onde o Wikidata só tem "EXO". O título da página que o catálogo aceitou para o grupo, sem o sufixo de desambiguação, entra na lista de nomes quando é um alias já conhecido em outra caixa. O título não acrescenta nome diferente: "Exo (group)" só vale para um grupo que já tenha o alias `EXO`.

### Uma letra em lista de integrantes

Uma letra só, como `V`, `L`, `Q` ou `J`, prova `has_member` e `member_of` apenas como item inteiro de lista explícita (`consists of`, `composed of`, `comprised of`, `members:`, `line-up of`). A letra precisa estar em maiúscula, separada dos vizinhos e ao lado de pelo menos outro item da lista. Como `V.` pode ser inicial e `I.M` é outro nome, um ponto depois da letra só conta quando encerra a frase e "and" fecha a lista antes dela.

Os gatilhos `addition of` e `graduations of`, as formas "member X left" e a infobox não aceitam nome de uma letra. O nome continua precisando ser alias da pessoa declarada no P527.

### Localizador e versão

Nada muda no formato do localizador: `wikipedia:<idioma>:pageid=<pageid>:revid=<revid>#extract[início:fim]`, com o intervalo da grafia que a frase usa. `EVIDENCE_RULES_VERSION` passa a `text-evidence-v8`. `EXTRACTOR_VERSION` e `SOURCE_POLICY_VERSION` não mudam.

### Fora desta decisão

- `released_on`, cujas regras não mudam.
- O adjetivo `South Korean–Chinese` antes do artista. Muitas páginas de EXO usam esse adjetivo e continuam rejeitadas.
- Crédito fora do formato "by <artista>" no fim do item, como "by BTS for their first album" ou "released by BTS". Essas páginas continuam rejeitadas.

## Alternativas consideradas

### Baixar `MIN_NAME_LENGTH`

Rejeitada. O limite é usado por gravadora, gênero, lugar e formação, e os nomes casam sem diferenciar maiúsculas. Um valor global menor abriria falso positivo em todos esses predicados.

### Aceitar nome curto sem diferenciar maiúsculas no crédito

Rejeitada. Daria a palavras comuns (`can`, `toy`, `un`) o mesmo peso de um nome próprio. A grafia exata custa pouco: "BTS", "NCT" e "Ive" aparecem como no Wikidata, e a exceção de caixa (`Exo`) vem do título da própria página do grupo.

### Lista de palavras proibidas

Rejeitada. Toda lista dessas fica incompleta e não resolve o caso em que o nome de um grupo é palavra comum e está escrito corretamente. A posição do crédito, a grafia exata e o P175 já restringem o caso.

### Exigir descrição antes do nome curto ("South Korean boy band BTS")

Rejeitada. A descrição varia entre páginas e recusaria créditos corretos, como "by BTS". A identidade do artista vem do P175 e do sitelink da página.

## Consequências

- A reaplicação às revisões já guardadas de 19 de outubro de 2026, sem rede, mudou 71 fatos: 62 `performed_by` e 8 fatos de integrante aceitos, e 1 `has_member` em conflito por falta do lado `member_of` (`membership_counterpart_unverified`). Nenhum fato aceito antes perdeu o aceite. BTS passou a 25 `performed_by` aceitos, 13 deles com `released_on` aceito, e V passou a aceito.
- Controles sobre as mesmas revisões: 76 nomes curtos do catálogo testados em 2.160 páginas de lançamento não passaram em nenhuma página em que o grupo não fosse o artista declarado; 147 grafias diferentes da citada não foram aceitas; `Can`, `Toy` e `UN` não passaram em nenhuma página.
- Se o P175 do Wikidata apontar para o grupo errado, a frase "by Can" da página continua confirmando esse erro. Esse risco já existia para nomes longos e depende da identidade da afirmação, não do comprimento do nome.
- Esta decisão e a mudança de código não publicam dados. O reprocessamento é feito em cópia do banco, e a entrada de fatos novos em jogos depende da aprovação do operador sobre a amostra.
