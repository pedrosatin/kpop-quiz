# ADR 049. Limites de memória, regex, SQLite e execução em CI na coleta

## Status

Aprovado em 2026-11-22. Complementa as [ADR 001](001-mediawiki-action-api.md), [ADR 032](032-rebuild-com-fallback-em-passo-separado.md), [ADR 033](033-espera-por-maxlag-e-versao-das-regras.md), [ADR 034](034-descoberta-de-lancamentos-trunca-sem-abortar.md) e [ADR 043](043-rebuild-incremental-e-orcamento-do-refresh.md) com os limites operacionais do pipeline Python e da execução em CI que estavam apenas em comentários.

## Contexto

Durante a coleta MediaWiki/WDQS, extração de wikitext, armazenamento SQLite e execução dos scripts em GitHub Actions, surgiram restrições específicas de runtime e segurança que motivaram proteções pontuais no código:

- **Regex possessivo no Python 3.11.0–3.11.4:** grupos com quantificador possessivo que casam zero vezes falhavam nessas versões do interpretador (`infobox.py`, `_ANY_INFOBOX_START`), exigindo quantificador guloso na repetição de linhas em branco.
- **Limites de resposta HTTP e erros de TLS:** leituras em streaming ou respostas extensas precisam de teto explícito por resposta e lote (32 MiB/lote em `mediawiki.py`, 5 MB em `release_discovery.py`, leitura limitada em `http_request.py`) para conter consumo de memória e encapsular exceções de leitura TLS (`ssl.SSLError`, `OSError`) na camada de erro do cliente.
- **Saturação de inteiros em SQLite para QIDs:** `CAST(... AS INTEGER)` no SQLite satura em $2^{63}-1$. Para comparar e cortar QIDs numéricos sem perder ordem em IDs grandes, a ordenação canônica compara pelo par `(length(qid), qid)` sobre a forma validada `Q[1-9][0-9]*` (`release_discovery.py`, `release_pipeline.py`, `storage.py`).
- **Cache restaurado após falha e arquivos órfãos:** uma execução interrompida no meio de uma transação deixa sidecars `-journal`, `-wal` ou `-shm` no banco restaurado de cache; snapshots parciais fora do banco podem existir no diretório bruto.
- **Comandos de workflow e buffer de saída no CI:** mensagens externas ecoadas em `::warning::` ou `::error::` precisam de escape de comandos de workflow do GitHub Actions e descarga explícita de `stdout` (`flush=True` em `workflow_commands.py`, usado por `map_pilot_refresh.py`) antes de comandos emitidos pela runner.

## Decisão

1. **Regex seguro em infoboxes:** `_ANY_INFOBOX_START` usa repetição gulosa no grupo de linhas em branco opcionais para compatibilidade com Python 3.11.0–3.11.4, enquanto `_TEMPLATE_NAME` usa quantificador possessivo sobre caracteres não delimitadores para evitar backtracking cúbico.
2. **Orçamento de leitura HTTP e normalização de falhas:** `http_request.py`, `mediawiki.py` e `release_discovery.py` aplicam leitura limitada em bytes e convertem falhas de socket/TLS durante a leitura do corpo em `MediaWikiError`.
3. **Forma canônica e ordenação lexical por tamanho de QID:** `_CANONICAL_QID` exige `Q[1-9][0-9]*` (dígitos ASCII sem zero à esquerda), impedindo dígitos Unicode (`²`, `١`) e garantindo que `(length, text)` coincida exatamente com a ordem numérica em SQL e Python.
4. **Quarentena de órfãos e limpeza de sidecars SQLite:** antes de abrir ou restaurar um banco de cache em `scripts/rebuild_database.py` e `storage.py`, arquivos `-journal`, `-wal` e `-shm` residuais sem par válido são tratados e snapshots brutos sem referência no banco são movidos para `.orphans/` com sufixo `.orphan`, mantendo-os fora de `*.json.gz`.
5. **Escaping de workflow commands e ordenação de logs:** `workflow_commands.py` escapa `%`, `\r` e `\n` ao emitir comandos do GitHub Actions; scripts executados em `actions` fazem flush explícito da saída padrão antes de emitir anotações.
6. **Subconjunto de fontes web (`subset-fonts.sh`):** os subsets autohospedados usam o intervalo Google Fonts `latin` mais Latin Extended-A para nomes romanizados, com eixo `wdth=100` fixado via `fonttools varLib.instancer` porque o CSS nunca altera `font-stretch`.

## Alternativas consideradas

- **Exigir Python >= 3.12 em todo desenvolvimento local:** reduziria compatibilidade com ambientes Python 3.11 sem necessidade quando uma forma equivalente de regex atende todas as versões.
- **Converter QIDs para inteiro no SQLite:** inviável para comparações consistentes acima do limite de 64 bits com sinal.

## Consequências

- Os parsers e clientes permanecem determinísticos e seguros apenas com a biblioteca padrão do Python.
- Testes unitários específicos (`test_infobox_parser.py`, `test_release_discovery.py`, `test_rebuild_cache.py`, `test_workflow_commands.py`) verificam cada invariante.
