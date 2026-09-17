# Modelo de dados

## Princípios

Entidades representam grupos, pessoas, lançamentos, turnês, apresentações e lugares. Afirmações representam relações ou valores com tipo. Evidências ligam cada afirmação a uma revisão da fonte.

Formação e estreia são predicados diferentes. Idade deriva de `born_on` e de uma data de referência. Duração de hiato deriva de um intervalo. Contagem anual de shows deriva de apresentações individuais dentro de um escopo de cobertura declarado.

## Schema conceitual

```text
ingestion_run
  id, adapter, started_at, finished_at, status, parser_version, stats

source_page
  id, provider, language, external_page_id, title, canonical_url, wikidata_id,
  is_redirect, is_disambiguation

source_revision
  id, source_page_id, external_revision_id, fetched_at, content_sha256, raw_path

entity
  id, entity_type, canonical_name, wikidata_id, created_at, retired_at

entity_alias
  entity_id, name, language, alias_type

assertion
  id, subject_entity_id, predicate, typed_value, valid_from, valid_to,
  precision, confidence, review_status, extractor_version, extracted_at

assertion_evidence
  assertion_id, source_revision_id, locator, source_snippet

ingestion_error
  ingestion_run_id, source_page_id, stage, error_code, retryable, occurred_at

catalog_entry
  source_page_id, source_revision_id, analyzed_wikidata_id, state,
  rejection_reason, type_check_id, classifier_version, classified_at

catalog_run
  id, classifier_version, started_at, completed_at, status, counts, error

wikidata_type_check
  id, wikidata_id, external_revision_id, instance_of_json, fetched_at
```

`typed_value` deve usar colunas exclusivas para entidade, texto, inteiro, decimal, data ou intervalo, com uma restrição que aceite exatamente um tipo.

## Predicados iniciais

- `formed_on`, `debuted_on` e `disbanded_on`
- `born_on` e `born_in`
- `member_of`, com início e fim de validade
- `hiatus_period`
- `released_on` e `release_by`
- `tour_started_on`, `tour_ended_on` e `tour_by`
- `performance_on`, `performance_venue`, `performance_city` e `performance_tour`

## Estado atual do banco

`schema_migrations` registra as versões aplicadas. `collection_runs` registra categoria, horários, estado, total e erro. `source_pages` registra provedor, idioma, `pageid`, título, URL canônica, resumo, `revid`, QID, marcas da página, data de consulta e última execução.

`source_revisions` registra uma linha por página e `revid`. A linha contém caminho relativo do snapshot, SHA-256 do JSON canônico descomprimido e data da primeira coleta. `collection_run_revisions` liga a revisão a cada execução que a observou. Duas coletas iguais criam duas execuções e compartilham uma revisão.

`catalog_entries` mantém uma linha por página e os estados `candidate`, `accepted` ou `rejected`. A decisão aponta para a revisão da Wikipedia analisada e, quando houve consulta remota, para `wikidata_type_checks`. Essa tabela guarda o QID, o `lastrevid` da entidade e os valores de `P31` em JSON ordenado. `catalog_runs` registra versão do classificador, totais e falha. `collection_issues` registra páginas removidas antes da consulta de detalhes.

`fact_runs` registra cada extração de fatos com versão do extrator, limite de grupos, totais por estado, lotes enviados ao Wikidata e erro. `wikidata_entity_snapshots` guarda uma linha por QID, `lastrevid` e perfil de requisição, com caminho e SHA-256 do JSON canônico. `fact_run_snapshots` liga cada snapshot às execuções que o usaram. `fact_issues` registra QIDs ausentes, redirecionados ou repetidos.

`entities` tem uma linha por QID. `entity_type` aceita `group`, `person`, `organization`, `place`, `genre`, `language` e `instrument`. Grupos do catálogo apontam para `source_pages`. `entity_aliases` guarda rótulos e aliases em pt, en e ko, nomes nativos (`P1559`, `P1705`) e romanizações (`P2125` como `ko-Latn-RR`, `P2126` como `ko-Latn-MR`).

`facts` tem uma linha por ID de afirmação do Wikidata. O valor ocupa `value_wikidata_id` e `value_entity_id` ou `value_time`, `value_precision` e `value_calendar`. `value_raw_json` preserva o valor original, inclusive quando a validação o rejeita. `valid_from` e `valid_to` vêm de `P580` e `P582`, cada um com sua precisão. `status` aceita `accepted`, `rejected`, `conflict` e `superseded`. Estados diferentes de `accepted` exigem `status_reason`. `quality_flags_json` lista marcas como `precision_below_day`, `insufficient_precision_for_age`, `membership_start_unknown`, `end_date_unknown` e `validity_not_evidenced`.

`fact_evidence` liga um fato a uma referência do Wikidata (`wikidata_snapshot_id` e `reference_hash`) ou a uma revisão da Wikipedia (`source_revision_id` e `snippet`). `source_key` identifica o QID de `P248` ou o domínio registrável de `P854`. `locator` indica o local dentro da fonte. O extrator só grava `accepted` quando existe ao menos uma evidência aceita pela política de fontes.

### Predicados implementados

| Predicado | Sujeito | Propriedade | Valor | Valor único |
| --- | --- | --- | --- | --- |
| `formed_on` | grupo | `P571` | data | sim |
| `origin_country` | grupo | `P495` | lugar | sim |
| `formed_in` | grupo | `P740` | lugar | sim |
| `record_label` | grupo | `P264` | organização, com validade | não |
| `genre` | grupo | `P136` | gênero | não |
| `has_member` | grupo | `P527` | pessoa, com validade | não |
| `born_on` | pessoa | `P569` | data | sim |
| `born_in` | pessoa | `P19` | lugar | sim |
| `citizenship` | pessoa | `P27` | lugar, com validade | não |
| `speaks_language` | pessoa | `P1412` | idioma | não |
| `plays_instrument` | pessoa | `P1303` | instrumento | não |
| `member_of` | pessoa | `P463` ou `P361` | grupo do catálogo, com validade | não |

`debuted_on`, `disbanded_on` e hiatos continuam fora do schema implementado.

## Planilhas

CSV ou XLSX servirá para inspeção editorial, filtros e correções propostas. Relações, histórico e evidências permanecem no banco. Uma importação futura precisa validar o identificador da afirmação e impedir alterações silenciosas na fonte original.
