# ADR 053. Schemas como fonte do formato; validação só nos testes

## Status

Aceita em 2026-11-22. Substitui a proposta de validadores Ajv no navegador (protótipo na branch local `docs/adr-validadores-gerados`, commit `6563292`). Os tickets 04 a 06 da épica bibliotecas ficam `wontfix`. O ticket 07 (Python com `jsonschema` nos testes do publicador) permanece.

## Contexto

Os formatos publicados vivem em `schemas/*.json`. O pipeline Python valida a forma com código próprio em `kpop_scraping/*_schema.py` e, nos testes, com compiladores quando a dependência está instalada. O web valida de novo com guardas TypeScript em `web/src/lib/*-types.ts` e nos carregadores (`web/src/data/*-loader.ts`). Uma mudança de formato precisa de três edições alinhadas.

A [ADR 026](026-catalogo-estatico-de-perguntas.md) já separa o que um schema JSON descreve (forma dos objetos) do que continua escrito à mão (hash dos bytes, unicidade de IDs entre shards, ordem dos pools, data de referência fixa e `catalog_version`).

Um protótipo com Ajv standalone no schema de Conexões mediu o custo de embutir o validador na ilha do jogo:

| Medida | Valor |
| --- | --- |
| Validador gerado (fonte) | 66 015 bytes |
| Validador minificado | 35 190 bytes |
| Validador minificado + gzip | 5 366 bytes |
| Ilha `ConnectionsGame` antes | 15 858 bytes |
| Ilha `ConnectionsGame` depois | 51 195 bytes |
| Δ da ilha | +35 337 bytes (~3,2×) |
| `eval` / `new Function` | ausentes |
| CSP (`csp:verify`) | ok |

Nos artefatos reais de Conexões o schema e a guarda manual concordam. Nos quatro casos abaixo o schema aceita e a guarda manual recusa (integridade entre campos que o draft 2020-12 deste arquivo não expressa):

1. duas categorias com o mesmo `difficulty_level`;
2. duas categorias que compartilham um `item_id` (partição quebrada);
3. um item do tabuleiro que nenhuma categoria referencia;
4. duas categorias com o mesmo `id` e corpos diferentes (`uniqueItems` compara objetos inteiros).

Embutir Ajv no navegador acrescentava ~35 KB por ilha sem cobrir essas regras: o validador gerado aceitava os quatro casos que a guarda manual recusa. Em 22/11/2026 o operador decidiu manter as guardas manuais em tempo de execução e validar contra os schemas só nos testes.

## Decisão

1. **Fonte do formato.** `schemas/*.json` é a fonte do formato dos artefatos publicados. Web e Python leem o mesmo arquivo no repositório, sem cópia em outro diretório.

2. **Validação contra schema só em teste.**
   - **Web:** Vitest valida cada artefato publicado em `web/public/data/` (e `next/`) que tem schema correspondente, com `ajv` e `ajv-formats` como *devDependency* de `web/`. O código de produto (`web/src/components/`, carregadores, ilhas) não importa Ajv.
   - **Python:** os testes do publicador validam a saída com `jsonschema` (ticket 07). A dependência entra só em `requirements-ci.txt`. O coletor e o publicador em produção continuam só com a biblioteca padrão.

3. **Guardas manuais em tempo de execução.** `web/src/lib/*-types.ts` e `web/src/data/*-loader.ts` continuam sendo a validação no navegador. Elas cobrem a forma que o schema descreve e as regras de conteúdo da ADR 026, inclusive as quatro divergências medidas no protótipo de Conexões.

4. **O que continua escrito à mão** (além do schema), conforme a ADR 026 e o protótipo:
   - hash dos bytes (shards, envelopes, `puzzle_id` / `dataset_version` quando a regra recalcula o conteúdo);
   - unicidade de IDs além de `uniqueItems` por igualdade profunda;
   - partição do tabuleiro (Conexões: cada item em exatamente uma categoria; união igual ao conjunto de itens);
   - níveis de dificuldade distintos `{1,2,3,4}` na partida de Conexões;
   - ordem e contagens dos pools do catálogo;
   - data de referência fixa do catálogo e conferência de `catalog_version`;
   - regras de publicação (troca de tabuleiro, reaproveitamento, omit).

5. **Artefatos ainda sem schema JSON** em `schemas/` (o teste Vitest os lista por nome; um arquivo novo fora do mapa e fora dessa lista falha):
   - manifesto e shards do catálogo estático (`catalog-manifest-v1.json` e `catalog.*.json`, ADR 026);
   - `manifest.json`, `manifest-v2.json` e `manifest-v3.json` das sessões do Quiz;
   - `daily-set.json`;
   - registros `crossword-publication.<data>.json` (o envelope diário usa `crossword-daily-v1.json`);
   - conjunto do Mapa (`data/map-pilot/`, contrato na ADR 015), quando publicado.

6. **Rejeição do Ajv no navegador.** Os números do protótipo justificam a recusa: +35 KB na ilha de Conexões sem cobrir as quatro divergências que a guarda manual já recusa. Tickets 04 a 06 (migrar carregadores para validadores gerados) são `wontfix`.

## Critério para rever a decisão

Reabrir a validação no navegador (ou outra abordagem) se ocorrer qualquer um destes fatos:

1. o custo medido de um validador gerado por ilha cair o bastante, segundo critério do operador, e as quatro divergências (ou equivalentes por jogo) passarem a ser expressas no schema ou cobertas por checagens geradas sem inflar o bundle;
2. a tripla manutenção (schema + Python + TypeScript) produzir divergências de formato em produção que os testes contra schema não tenham pegado a tempo;
3. o operador pedir explicitamente a revisão.

Enquanto isso, estender um schema ou acrescentar um artefato ao mapa do teste Vitest é o caminho normal; não exige reabrir Ajv no cliente.

## Alternativas consideradas

- **Ajv standalone no build, importado pelas ilhas** (proposta anterior): fonte única no cliente, mas +35 KB por ilha no protótipo de Conexões e sem as regras de partição/dificuldade. Rejeitada em 22/11/2026.
- **Só guardas manuais, sem ler `schemas/` nos testes do web:** mantém o risco de o artefato publicado divergir do schema sem o Vitest perceber. Rejeitada: o schema é a fonte do formato e precisa de um leitor no web além do Python.
- **Gerar TypeScript a partir do schema (tipos ou zod):** fora do escopo desta fatia; não altera a decisão de onde roda a validação.

## Consequências

- DevDependencies novas no web: `ajv` e `ajv-formats`, usadas só em teste.
- Teste Vitest com mapa explícito artefato → schema e lista nomeada dos sem schema.
- Bundle de produção permanece sem Ajv; a prova é comparar os JS de `dist/_astro/` antes e depois desta fatia.
- Ticket 07 implementa o lado Python; 04 a 06 ficam `wontfix`.
- Reverter esta fatia: remover a ADR, o teste Vitest e as duas devDependencies.
