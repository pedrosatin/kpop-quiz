# ADR 043 sobre o rebuild incremental por revisão e o orçamento do refresh

## Status

Aprovado em 2026-11-18. Acrescenta `--incremental` e `--full-refresh` a `python main.py`, o log de fases do coletor, o orçamento total de `scripts/rebuild_database.py` e muda o passo "Rebuild database from Wikipedia and Wikidata" de `daily-puzzles-cron.yml`. Complementa o [ADR 002](002-immutable-revision-snapshots.md) e o [ADR 004](004-wikidata-facts-and-evidence.md), cuja identidade de snapshot continua a mesma, o [ADR 032](032-rebuild-com-fallback-em-passo-separado.md), cujo fallback continua num passo separado, e o [ADR 033](033-espera-por-maxlag-e-versao-das-regras.md), cujo `maxlag=5` e orçamento de espera por execução continuam valendo.

## Contexto

Nos 20 runs agendados até 2026-11-17, o passo de rebuild levou 1.266 s de mediana e 3.940 s de p90. Um rebuild limpo leva cerca de 78 s. O resto é espera: `maxlag` do Wikidata dentro do orçamento de 15 minutos de cada tentativa, as esperas de 10 minutos entre tentativas e, nas noites em que o atraso não passa, três tentativas inteiras antes do banco em cache. O log mostrava só o total, então não dava para separar espera, download e gravação.

O coletor baixava de novo, todo dia, as 578 páginas do catálogo com o extract, os type checks com as afirmações de cada grupo e cerca de 2.400 documentos de entidade em 50 lotes, embora a maioria estivesse numa revisão que o banco já guardava. O cache do Actions já preserva `data/kpop.db` e `data/raw` entre os runs (chave por run, restauração pelo prefixo), mas o coletor não consultava esse acervo antes de pedir à rede.

Os invariantes do projeto proíbem paralelizar requisições à Wikimedia. O ganho precisa vir de pedir menos, nunca de pedir ao mesmo tempo.

## Decisão

### Log de fases

O CLI instala um `PhaseLog` (`kpop_scraping/rebuild_phases.py`) e imprime, no fim do run, inclusive quando ele falha ou recebe SIGTERM, uma linha por fase: `listing`, `revisions`, `download`, `extraction` e `storage`, com segundos, requisições e segundos de espera por `maxlag`. O tempo vai para a fase mais interna aberta naquele momento: uma requisição feita durante a extração de fatos conta como `download`. Com `--incremental`, linhas `Rebuild reuse <tipo>` dizem quantos itens vieram de snapshots guardados e quantos foram baixados. O SIGTERM que o script de rebuild manda a uma tentativa vencida vira `SystemExit(143)`, para que o relatório chegue ao log; a transação aberta é descartada como antes.

### Reuso por revisão

Com `--incremental`:

- **Páginas da categoria.** O coletor pede a revisão atual e os metadados de todas as páginas (`prop=info|pageprops|revisions`, 50 por requisição, fase `revisions`). Uma página cuja revisão já tem snapshot em `source_revisions` é montada com o extract desse snapshot, lido pelo SHA-256, e com o título, a URL, o item do Wikidata e as marcas de redirecionamento e desambiguação que acabaram de chegar. Só as páginas com revisão nova são baixadas com o extract (20 por requisição). As duas formas gravam pelo mesmo `save_pages`, na ordem da categoria.
- **Entidades do Wikidata.** `IncrementalWikidataClient` (`kpop_scraping/revision_reuse.py`) pede `props=info` para até 50 QIDs, resolvendo redirecionamentos e entidades ausentes como o pedido completo resolve. Um QID cuja entidade, revisão e perfil já têm snapshot em `wikidata_entity_snapshots` é servido desse snapshot, lido pelo SHA-256. Só o resto é baixado com o perfil. As revisões consultadas valem para o resto do run, então os type checks do catálogo e os documentos dos grupos perguntam cada QID uma vez. O pipeline de fatos e o de lançamentos recebem os documentos pelo mesmo `entity_batches` e gravam pelo mesmo `save_entity_snapshot`.
- **Type checks.** Um P31 guardado em `wikidata_type_checks` para o QID e a revisão é reutilizado; as afirmações só são baixadas para revisão nova. Um QID redirecionado sempre vai ao pedido completo, que decide o que ele rende.

A identidade do cache é a dos ADR 002 e 004: provedor, idioma, `pageid` e `revid` para páginas; QID, revisão e perfil para entidades. Uma revisão nova tem outra identidade e sempre é baixada. Toda afirmação continua apontando para o snapshot da revisão de onde veio e para o local dentro dele. Um snapshot ilegível, com outro hash ou de outra revisão levanta `SnapshotIntegrityError` e o run sai com 65, como no modo completo.

O cache é o acervo que o workflow já guarda: `data/kpop.db` e `data/raw` no `actions/cache`. Nenhum armazenamento, segredo ou artefato novo entra. Sem cache compatível restaurado, o banco começa vazio, nada está guardado e o run incremental baixa tudo.

### Versão de esquema e publicação sem cache

A chave passa a `kpop-db-<hash das migrations>-<run_id>`. A fonte única é
`schema_version()` em `kpop_scraping/rebuild_cache.py`: SHA-256 da sequência
`storage.MIGRATIONS`, incluindo nomes e DDL. Acrescentar uma migration ou editar
uma antiga muda a versão automaticamente; o teste de mutação cobre ambos.
O workflow restaura primeiro pelo prefixo desse hash e depois por `kpop-db-`,
inclusive as chaves anteriores a esta decisão.

O cache inclui `kpop.db.schema`, gravado somente depois de refresh bem-sucedido.
Com marcador ausente ou diferente, `rebuild --schema-cache` copia o banco antigo
para `.cached` e retira banco, snapshots e journals do diretório de coleta antes
de começar. Assim o incremental baixa tudo, como o completo, e o banco antigo
continua disponível no passo de restauração do ADR 032. Uma falha não promove o
acervo antigo à versão nova: o próximo run volta a tentar um refresh limpo.

O cache do Actions pode ser removido por expiração ou por limite de espaço.
Por isso um segundo prefixo sozinho não cobre a ausência total de cache.
`data/publication-reserve.sqlite.gz` guarda uma base de publicação compacta,
exportada do acervo local disponível em 18/11/2026, sem nova coleta. Contém só
as tabelas e colunas públicas usadas pelos geradores, com QIDs, revisões e
localizadores das evidências; não inclui caminhos locais, logs, runs nem
snapshots brutos. A atribuição e as licenças das fontes continuam as descritas
no README. `export_reserve(source, target)` permite renová-la a partir de uma
coleta revisada; ela deve ser validada pelos testes de geração antes de publicar.
É material de produto para recuperação offline, não um cache de coleta.

Sem banco restaurado, o script instala essa reserva em `.cached`, mantendo a
coleta vazia. Se o refresh falhar, retornar 75 ou estourar o orçamento, o passo
separado restaura a reserva e os geradores produzem a data pedida. O preço é
publicar fatos mais antigos durante uma indisponibilidade prolongada. Nunca se
inventa evidência ou se troca apenas a data de um tabuleiro publicado. Mudanças
no contrato de leitura dos geradores precisam manter a reserva utilizável ou
renová-la no mesmo commit; a matriz de testes gera jogos reais a partir dela.
A política existente de omitir um jogo que não tenha tabuleiro válido continua
valendo, inclusive a Cruzadinha sem histórico da véspera.

O teste cobre mesma versão, versão antiga e ausência de cache, cada uma com
sucesso, erro determinístico, erro transitório e orçamento esgotado; todos os
casos passam pelo gerador diário real. O primeiro cron após o merge deve mostrar
a chave com hash, refresh limpo se o cache ainda for legado, e geração/publicação
da data alvo mesmo se o refresh falhar. Essa prova agendada fica pendente até o
run acontecer; testes offline não demonstram disponibilidade do Actions.

### Equivalência

`tests/test_incremental_rebuild.py` roda o CLI de verdade contra uma Action API simulada no `urlopen`. Os dois runs partem da cópia do mesmo banco da véspera e recebem o mesmo dia: página com revisão e extract novos, página que saiu da categoria, página nova, grupo e pessoa com revisão nova, entidade de rótulo com revisão nova e entidade que sumiu. O dump de todas as tabelas, sem as colunas `*_at`, os CSVs de relatório e todos os arquivos de `data/raw` saem idênticos. O mesmo teste confirma que só a página alterada e a nova tiveram o extract baixado e que só o grupo e a pessoa alterados tiveram o documento baixado. Num dia sem edição, o run incremental não baixa conteúdo nenhum.

### Orçamento do refresh

`scripts/rebuild_database.py` ganha um orçamento total para todas as tentativas e esperas do passo: 45 minutos (`REBUILD_BUDGET_SECONDS`, padrão 2.700). Uma tentativa nunca passa do fim do orçamento: o timeout dela é o menor entre os 30 minutos e o que resta. Nenhuma tentativa começa, e nenhuma espera antes dela, quando o que resta não cobre a espera e a menor tentativa útil, 5 minutos (`REBUILD_MIN_ATTEMPT_SECONDS`). O script desiste com 124 ou 75 e grava o motivo. O passo de restauração do ADR 032 põe o banco anterior de volta e o dia sai dele.

Com o Wikidata atrasado o tempo todo, a primeira tentativa sai com 75 perto de 17 minutos, a espera de 10 minutos acontece e a segunda tentativa recebe os cerca de 17 minutos que restam, o bastante para o orçamento de `maxlag` de 15 minutos e o trabalho. O fallback chega por volta de 45 minutos, contra cerca de 66 antes. O `timeout-minutes` do passo cai de 120 para 60; o pior caso do script é 45,5 minutos.

### Workflow

O passo de rebuild passa `--incremental` de segunda a sábado e `--full-refresh` aos domingos (dia da semana em UTC no início do passo). O run completo semanal mantém observável, ao menos uma vez por semana, o extract que muda sem revisão nova (ADR 036), que o incremental não vê porque não baixa o extract de uma revisão guardada.

## Alternativas consideradas

### Paralelizar as requisições

Os invariantes do projeto proíbem, e o `maxlag` atinge todas as requisições do mesmo jeito.

### Cache HTTP por URL

Guardaria respostas pela URL pedida. A mesma URL devolve revisões diferentes com o tempo, e a resposta não diz se mudou sem uma consulta de revisão. O acervo por revisão já existe e tem identidade verificável.

### Reusar sem consultar a revisão

Pularia a consulta de revisão e serviria o snapshot mais recente. Uma edição do dia nunca chegaria ao banco.

### Incremental sempre, sem run completo

O extract que muda sem revisão nova e um snapshot gravado com conteúdo errado nunca mais apareceriam. O domingo completo custa um run de duração antiga por semana.

### Orçamento menor, uma tentativa só

A auditoria sugeriu uma tentativa de 15 minutos. O ADR 033 escolheu tolerar atrasos longos para publicar fatos novos. Com 45 minutos, duas tentativas reais cabem, e a cauda cai de cerca de 66 para cerca de 45 minutos.

## Consequências

- Uma noite sem atraso baixa só o que mudou. Um rebuild incremental pede, para cada lote de 50 entidades, uma consulta de revisão em vez do documento, e baixa os documentos alterados à parte. Em quantidade de requisições, o Wikidata fica perto do modo completo; em bytes e no trabalho do servidor, cai na proporção do que não mudou. A Wikipedia passa de 29 requisições de extract para 12 de revisão mais as das páginas alteradas.
- O ganho na mediana depende da proporção de edições e do `maxlag`, que continua sendo a maior parte do tempo. A medição de 7 dias de cron, antes e depois, com as linhas de fase do log, mostra quanto foi.
- O incremental não registra `extract_drift` de uma revisão guardada. O run de domingo registra.
- O dia sai do banco anterior depois de cerca de 45 minutos de atraso persistente, contra cerca de 70 minutos de tolerância antes. Uma noite com atraso entre 45 e 70 minutos, que antes publicava fatos novos, agora publica os da véspera.
- Reverter o workflow para o comando antigo volta ao modo completo; `--full-refresh` é o padrão do CLI. Reverter o orçamento é definir `REBUILD_BUDGET_SECONDS` acima do pior caso antigo, 6.690 s, e voltar o `timeout-minutes` para 120.
