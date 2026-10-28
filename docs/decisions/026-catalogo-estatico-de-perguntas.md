# ADR 026: catálogo estático de perguntas para novas partidas

## Status

Aceita

## Data

2026-10-28

A decisão de produto foi aceita pelo operador em 25/10/2026, após o playtest de produção, com o rascunho "ADR 025 sobre catálogo publicado, replay e retomada do Quiz". Esse número passou a ser da [ADR 025](025-manifesto-v3-pistas-relacionadas.md) (manifesto v3), publicada antes. Este registro leva o texto adiante com o número 026 e o contrato implementado na fatia Q02. Replay (Q03) e retomada (Q04) seguem pendentes.

## Contexto

As ADRs 005 e 007 definem geração factual offline, sessões de dez perguntas e publicação com manifesto, identidades e hashes. O carregador consome sessões fechadas. Repetir a mesma sessão no Quiz geral não oferece a nova seleção desejada pelo jogador, e `create_session` já escolhe dez perguntas de um conjunto elegível maior que o publicado.

Fatos que moldam o contrato, verificados no código e nos artefatos:

- Hoje o jogador alcança 60 perguntas distintas por idioma e modo: seis sessões do manifesto v2 (base, diário e quatro décadas), cada uma com dez. O diretório guarda 926 arquivos de sessão acumulados, mas só os do manifesto são lidos.
- Clientes publicados validam o manifesto v2 e o v3 com conjunto exato de chaves (`dataset_version`, `schema_version`, `sessions`) e rejeitam qualquer chave a mais. A ADR 025 já registrou que um formato novo precisa de manifesto novo.
- `dataset_version` muda a cada geração diária, porque a base é reconstruída da Wikipedia e do Wikidata na CI. O diretório de dados é versionado e o cron publica por pull request.
- O banco local de desenvolvimento não é o de produção. Ele gera 3.393 perguntas lógicas (20.358 variantes), cada idioma e modo com cerca de 6,4 MB em JSON canônico, 1,66 MB comprimido.

## Decisão

Publicar um catálogo estático validado de perguntas elegíveis, versionado por conteúdo e referenciado por um manifesto com integridade verificável. O navegador monta, na fatia seguinte, uma seleção de dez perguntas com `semantic_id` distintos, restrita ao idioma, ao modo e aos filtros escolhidos. Nenhuma pergunta, pista ou evidência é coletada ou gerada durante a partida.

### Contrato

**Manifesto próprio.** `catalog-manifest-v1.json` (`kpop-quiz-catalog-manifest-v1`), separado de `manifest-v2.json` e `manifest-v3.json`. Nenhum cliente publicado o pede, e as sessões e os dois manifestos de sessão mantêm forma e bytes. Campos: `schema_version`, `catalog_version`, `dataset_version`, `reference_date` e `shards`.

**Um shard por idioma e modo.** São seis: `catalog.<idioma>.<modo>.<sha256>.json` (`kpop-quiz-catalog-v1`). O manifesto lista os seis, sem catálogo parcial. Cada entrada traz `path`, `sha256`, `questions` e a contagem elegível de cada pool.

**Perguntas como a sessão as carrega.** Cada pergunta é o objeto do dataset, com `id`, `semantic_id`, opções, evidências e pistas, validado pelo mesmo `validate_question`. Os IDs são os das sessões publicadas, então histórico de resultados e partidas salvas continuam compatíveis. O catálogo guarda as opções na ordem do dataset; uma sessão as embaralha com a própria semente, e a seleção de Q03 deve fazer o mesmo.

**Elegibilidade por filtro.** `pools` lista, em índices crescentes de `questions`, o que cada filtro permite: `all`, `decade.1990`, `decade.2000`, `decade.2010` e `decade.2020`. A publicação calcula os pools com `eligible_questions`, a função que `create_session` usa, incluindo o limiar de relevância de grupo do modo. Filtros de tema e de grupo existem no gerador, mas não na interface, e ficam fora do contrato até serem usados.

**Versão por conteúdo.** O nome do shard carrega o hash dos bytes. `catalog_version` é o SHA-256 de linhas simples: o identificador do manifesto, o `dataset_version` e `<chave>:<sha256>` de cada shard em ordem. O cliente o recalcula sem escritor de JSON canônico. Qualquer mudança de pergunta, evidência, pista ou pool muda a versão.

**Pistas relacionadas.** O catálogo sai do mesmo dataset que as sessões do manifesto v3: com `--related-clues` leva as pistas relacionadas, sem a opção não leva. Ligar ou desligar a variável muda `catalog_version`, nunca o `dataset_version`.

**Classificação do pool.** Mais de dez perguntas: `ok`. Exatamente dez: `repeats` (avisar que a partida repete o conjunto). Menos de dez: `unavailable`. O manifesto traz as contagens, então a interface sabe a classificação sem baixar o shard.

### Validação em três pontos

- **Publicador.** Valida dataset, cada pergunta, cada shard e o manifesto antes de gravar. Grava os shards, depois o manifesto, depois apaga a geração anterior. Uma falha antes do manifesto deixa o catálogo anterior inteiro.
- **Verificação.** `web_publish --verify` relê tudo: hash de cada shard contra o manifesto, schema, identidade, idioma, modo, versão e pools, e compara o manifesto recalculado byte a byte. Quando catálogo e sessões vêm do mesmo `dataset_version`, toda pergunta de sessão precisa estar no pool correspondente e igual à do catálogo, exceto as pistas e a ordem das opções. `--require-catalog` torna a presença obrigatória.
- **Consumidor.** `catalog-loader.ts` confere o manifesto, o hash dos bytes antes do parse, o schema, o idioma e o modo pedidos, a versão do dataset, a data de referência, a unicidade de IDs, a ordem, os pools e a contagem declarada. Só então devolve o catálogo. Ausente: erro `missing`. Qualquer divergência: erro `invalid` com o motivo. Não há fallback para sessões, para outro manifesto ou para conteúdo não validado.

### Publicação sob opção, desligada

`daily_puzzles_cli --catalog` (variável de repositório `QUIZ_CATALOG` no cron) publica o catálogo; sem a opção a saída é a anterior, byte a byte. Com a opção desligada, um catálogo deixado por execução anterior é retirado, como o manifesto v3: é assim que o catálogo se desfaz sem migração. O catálogo vive só no diretório principal, nunca em `next/`, e segue o banco da execução, não o dia: um dia mantido ou promovido de `next/` conserva as sessões, enquanto o catálogo não guarda histórico. Mantém-se uma geração; os shards substituídos saem na publicação.

O replay do Quiz não usa o catálogo nesta fatia e continua desativado.

### Preservado do rascunho aceito

O replay geral evita repetir o conjunto imediatamente anterior quando existir outra combinação elegível. Embaralhar a ordem das mesmas dez não satisfaz esse requisito. Não há promessa de dez perguntas inéditas por rodada. O diário mantém a mesma identidade e seleção do dia. A sessão selecionada terá identidade ligada à versão do catálogo, à configuração e ao conteúdo selecionado, sem enfraquecer a idempotência do registro de resultados. A retomada salva localmente a partida e o prazo do cronômetro, que continua correndo durante a confirmação de desistência. Esses pontos pertencem a Q03 e Q04.

## Alternativas consideradas

- **Acrescentar o catálogo a `manifest-v3.json`.** O cliente atual valida o v3 com chaves exatas, rejeitaria o manifesto e voltaria ao v2, perdendo as pistas relacionadas.
- **Manifesto v4 com sessões e catálogo.** Repete a lista de sessões e obriga cada manifesto novo a carregar o anterior. O catálogo não é uma sessão e não precisa ser lido junto com elas.
- **Repetir uma sessão fixa com aviso.** Não atende ao replay com nova seleção escolhido pelo operador.
- **Publicar várias sessões prontas.** Limita a variedade às combinações antecipadas.
- **Buscar ou gerar perguntas por backend durante a partida.** Acrescenta dependência operacional e perde a proveniência fixa.
- **Catálogo único com os seis idiomas e modos.** Cerca de 37 MB para um jogador que usa um deles. O shard por idioma e modo baixa 1,66 MB comprimido.
- **Compactar pelo fato comum entre modos e idiomas.** Reduziria o tamanho, mas exige reconstruir a pergunta no cliente e reescrever a validação que já cobre o objeto publicado. Fica como evolução se o custo de transferência pesar.
- **Reter várias gerações de shards, como nas sessões.** Cada geração acrescentaria cerca de 37 MB ao diretório versionado.

## Consequências

- Habilitar `QUIZ_CATALOG` acrescenta cerca de 37 MB (9 MB comprimidos, no banco local) ao diretório de dados e ao artefato do cron. O diff diário é pequeno quando os fatos mudam pouco, porque os IDs de pergunta são estáveis. A variável permanece desligada até o replay que o lê entrar no ar.
- Um cliente com o manifesto do catálogo em memória que peça um shard depois de nova publicação recebe `missing` e resolve recarregando. Só existe uma geração.
- Dez perguntas continuam sendo o tamanho da rodada. Fontes, critérios de elegibilidade e correção factual das ADRs anteriores permanecem obrigatórios.
- A cobertura por pool é relatada a cada publicação (`web_publish` e `daily_puzzles_cli`) e quantidade insuficiente não autoriza completar a sessão com duplicatas ou filtros diferentes.
- Q03 consome `loadQuizCatalog`, `eligibleQuestions` e `replayStatus`. Q04 acrescenta a persistência da partida e define como restaurar perguntas de um catálogo de versão anterior.
