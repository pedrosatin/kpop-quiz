# ADR 025: manifesto v3 para pistas relacionadas

## Status

Aceita

## Data

2026-10-28

## Contexto

A PR #311 passou a gerar pistas de década que citam o fato datado da própria resposta. Esse fato não pertence aos `fact_base_ids` da pergunta, e o cliente publicado antes da #311 rejeita a sessão inteira que traga uma pista assim (`clue.fact_base_ids` precisa ser subconjunto dos da pergunta). O cliente lê `manifest-v2.json` a cada partida, e o manifesto não é versionado por cliente. A #311 deixou a geração desligada atrás de `--related-clues` e documentou que a ativação esperaria "o cliente novo estar no ar há tempo suficiente". Essa espera não tem prova: uma aba aberta mantém o script antigo até ser recarregada, e o site não impõe expiração.

Fatos verificados em produção e no código:

- `data/*.json` e o HTML saem com `cache-control: public, max-age=0, must-revalidate`; um cliente antigo lê o manifesto novo assim que ele é publicado. Não há service worker.
- `session_id` deriva de configuração, `dataset_version` e IDs das perguntas. O ID da pergunta deriva de idioma, `logical_id` e modo. Nenhum depende das pistas, então a mesma sessão com e sem pista tem os mesmos IDs. Partida diária e histórico do jogador usam `daily-<data>` e `session-<session_id>`.
- Sessões já publicadas de um dia são mantidas (`keep_or_promote_day`), mas as sessões base e de década vão para o manifesto raiz a cada geração.

## Decisão

Publicar dois manifestos com o mesmo formato:

- `manifest-v2.json` continua listando sessões que todo cliente publicado aceita. `validate_legacy_clues` roda em `publish` e em `--verify`: uma sessão com pista fora dos fatos da pergunta não entra nesse manifesto.
- `manifest-v3.json` lista as mesmas chaves, com os mesmos `session_id`, `dataset_version`, IDs de pergunta, alternativas e evidências. `validate_enrichment` exige que só `clues_available` e `clues_shown` mudem, que uma pergunta que já tinha pista a mantenha e que as sessões do modo Especialista fiquem idênticas. O arquivo de sessão é endereçado pelo hash, então uma sessão sem pista nova é o mesmo arquivo nos dois manifestos e um arquivo enriquecido nunca sobrescreve um legado.

O cliente atual tenta `manifest-v3.json` e volta ao `manifest-v2.json` quando o v3 não existe, não é JSON, não valida, ou quando a sessão que ele nomeia não carrega. O cliente antigo nunca pede o v3.

`--related-clues` (variável `QUIZ_RELATED_CLUES`) passa a significar "publicar também o v3". Sem ele a saída é a de antes, byte a byte. O runner remove um `manifest-v3.json` herdado de outro dia quando o conjunto instalado não traz um, e a promoção de `next/` faz o mesmo.

## Consequências

- Nenhuma aba antiga recebe uma sessão que rejeite, em qualquer ordem de deploy e sem supor quando ela some. Ligar e desligar a variável é reversível sem migração: o cliente atual cai para o v2.
- Um dia já publicado antes da ativação não ganha o v3 (o conjunto mantém seus bytes); o ganho começa no próximo dia gerado ou promovido de `next/`.
- O diretório de dados cresce mais depressa: até uma sessão enriquecida a mais por chave a cada geração (cerca de 19 KB cada), além das que o v2 já acumula.
- Um terceiro formato de pista que exija contrato novo no cliente precisa de um manifesto novo pelo mesmo caminho; este ADR não o dispensa.

## Alternativas consideradas

### Esperar as abas antigas sumirem

É a premissa da #311. Não há expiração de aba nem de script; a espera nunca termina com prova.

### Acrescentar os fatos da resposta aos `fact_base_ids` da pergunta

O cliente antigo aceitaria, mas a pergunta passaria a declarar como base um fato que não sustenta a resposta, e a identificação por fatos distintos usada na deduplicação e nos relatórios mudaria. Enfraquece a proveniência.

### Campo novo na sessão para as pistas relacionadas

O cliente antigo valida as chaves da pergunta com conjunto exato e rejeitaria a sessão.

### Fatiar por caminho ou parâmetro

O cliente antigo só conhece `manifest-v2.json`; qualquer opção que mude seu conteúdo atinge o cliente antigo.
