# ADR 046 sobre falsos negativos da frase de formação no resumo

## Status

Aprovado em 2026-11-20. Ajusta os bloqueadores de sujeito da regra de `formed_on` da [ADR-004](004-wikidata-facts-and-evidence.md). Não muda a categoria da [ADR-029](029-ano-de-formacao-pela-categoria.md).

## Contexto

A frase do resumo prova o ano de formação quando o grupo é o sujeito de "formed", "founded", "established" ou "created" e a data aparece na mesma frase. Dois bloqueadores recusavam frases válidas:

- `_MEMBER_AS_SUBJECT` lia "member South" em "five-member South Korean" e em "seven member South Korean" como se um integrante fosse o sujeito.
- `_DEPENDENT_SUBJECT` lia "which" dentro do parêntese explicativo do nome, como em N.Flying ("short for New Flying which also means ..."), e tratava a oração relativa do glossário como mudança de sujeito.

C-REAL (`Q492466`, revid `1351483658`), ENOi (`Q81207594`, revid `1318226487`) e N.Flying (`Q15727149`, revid `1372006877`) tinham o ano certo no resumo e o fato ficava `missing_evidence`. A triagem de 19/11/2026 tratou o achado como correção de falso negativo do parser (ticket 11), sem mudar o produto.

## Decisão

- Um adjetivo de contagem (`five-member`, `seven member`, `4-member` e equivalentes de 1 a 12) não aciona o bloqueador de "member + Nome".
- "member Mina", "ex-member Jennie" e demais "member" seguidos de nome capitalizado fora desse adjetivo continuam a recusar a frase.
- Parênteses no trecho entre o sujeito e o verbo de formação (e nas demais checagens de sujeito do grupo) são ignorados ao procurar `who`/`which`/`that`/`whose`. A oração relativa fora do parêntese, no intervalo entre o verbo e a data, continua a recusar o valor.
- `EVIDENCE_RULES_VERSION` passa a `text-evidence-v10`. `EXTRACTOR_VERSION` e `SOURCE_POLICY_VERSION` não mudam.

## Alternativas consideradas

### Aceitar só os três casos por lista editorial

Rejeitada: o defeito é do parser e se repete em qualquer "N-member South Korean … formed … in AAAA".

### Remover `_MEMBER_AS_SUBJECT` e `_DEPENDENT_SUBJECT`

Rejeitada: os testes de "Twice member Mina created…" e "formed by a producer who moved… in 2015" existem para esses bloqueadores.

## Consequências

- Os três grupos do ticket passam a ter prova pelo resumo da revisão fixa; o fato novo só chega aos jogos depois da próxima coleta com `text-evidence-v10`.
- Frases que os bloqueadores devem recusar continuam recusadas.
- A fixture `tests/fixtures/formation_false_negative_cases.json` guarda o extract CC BY-SA de cada revisão citada.
