# ADR 036 sobre o extract que muda sem revisão nova

## Status

Aprovado em 2026-11-14. Muda `Repository._verify_existing_snapshot` e `Repository.save_pages` em `kpop_scraping/storage.py` e o resumo de `python main.py`. O esquema do banco continua como estava. Complementa o [ADR 002](002-immutable-revision-snapshots.md), cujo snapshot por `pageid` e `revid` continua imutável, e o [ADR 032](032-rebuild-com-fallback-em-passo-separado.md), cuja tabela de códigos de saída continua valendo para a corrupção de snapshot.

## Contexto

O coletor guarda um snapshot por provedor, idioma, `pageid` e `revid`. Quando a revisão já está no banco e o JSON baixado tem outro SHA-256, `_verify_existing_snapshot` compara o `pageid`, o `revid` e o extract dos dois. A comparação já ignorava metadados como `touched`, que a Action API muda sem revisão nova. Um extract diferente levantava `SnapshotIntegrityError("revision <revid> of page <pageid> changed content")` e encerrava o run inteiro.

O extract vem do TextExtracts, que o renderiza a partir do parse atual da revisão. Uma edição num template transcluído ou um deploy do parser da Wikipedia muda o texto sem criar revisão. O CLI saía com 65, o script de rebuild do ADR 032 não repetia a tentativa e o dia saía do banco em cache. O banco em cache guarda o mesmo snapshot antigo, então o rebuild do dia seguinte falhava do mesmo jeito, e assim em todos os dias até alguém editar a página. Nesse intervalo os fatos de todos os grupos ficavam parados na última coleta bem-sucedida.

Uma simulação sem rede, com o script de rebuild e um cliente que devolve a mesma revisão com outro extract, reproduziu dois dias seguidos de saída 65 seguidos de restauração do cache, antes da mudança.

## Decisão

### Quarentena por página

- `_verify_existing_snapshot` lê o snapshot guardado com o SHA-256 do banco. Um arquivo ilegível, com outro hash ou que não traga o `pageid` e o `revid` da linha continua levantando `SnapshotIntegrityError`, e o run sai com 65. Um JSON baixado que nomeie outra página ou outra revisão também.
- Com o snapshot íntegro, um extract baixado diferente do guardado vira `ExtractDrift`, com provedor, idioma, `pageid`, `revid` e o SHA-256 UTF-8 dos dois extracts depois do `strip()`.
- `save_pages` grava em `collection_issues` a linha `extract_drift` do run, com o título da página e um `detail` que traz o `revid`, o idioma e os dois hashes. A página é pulada como a de extract acima de 32 KiB: nenhum snapshot novo, nenhuma atualização em `source_pages`, nenhuma ligação em `collection_run_revisions` e nenhuma mudança na entrada do catálogo. O resto do lote continua.
- O snapshot guardado continua sendo a observação da revisão. As evidências que já apontam para ele não mudam, e a extração de fatos segue lendo o extract dele.
- Cada run que encontra a deriva grava a própria linha. A restrição `UNIQUE(collection_run_id, external_page_id, issue_code)` impede duplicata dentro do mesmo run, e o run seguinte grava outra linha com o seu `collection_run_id`.

### Lançamentos e pessoas

Grupo, lançamento e pessoa gravam páginas pelo mesmo `save_pages`, então os três recebem a quarentena pelo mesmo ponto. A checagem prévia `_page_rejection`, que recusa a página de extract acima de 32 KiB antes da gravação, não se aplica aqui. A página com extract acima do limite não tem revisão guardada, e a busca posterior pela revisão falharia. A página com deriva já tem a revisão no banco, porque a deriva só existe quando a revisão está guardada.

- Em `release_source_pages`, a linha da página fica `accepted` com a mesma `source_revision_id`, e a evidência do lançamento lê o extract do snapshot guardado, como antes da deriva. Gravar a linha como `rejected` com um motivo novo tiraria a evidência do lançamento, o oposto do que esta decisão mantém.
- Em `person_source_pages`, a linha também fica `accepted` com a mesma revisão. A evidência de pessoa lê só o wikitext da revisão em `source_revision_wikitext`, que o extract não altera.
- A deriva fica registrada em `collection_issues` do run de lançamentos ou de pessoas.

### Aviso no resumo

- `Repository.extract_drifts` acumula as páginas puladas desde que o objeto abriu, sem repetir a mesma página.
- Depois de um run concluído, o CLI escreve em stderr uma linha por página, `WARNING: extract of <idioma> page <pageid> revision <revid> changed without a new revision; kept the stored snapshot (extract SHA-256 <hash> stored, <hash> fetched)`.
- No GitHub Actions, imprime uma única linha `::warning title=Extract changed without a new revision::<n> page(s) kept the stored snapshot of their revision: <idioma> pageid <pageid> revid <revid>; ...` com `flush=True`, como o aviso do ADR 034. A linha lista até 20 páginas e termina com `and <n> more` quando há outras. O resumo final ganha `Extract drift: <n> page(s) kept the stored snapshot of an unchanged revision`.
- O aviso leva o código de idioma escolhido pelo código, inteiros e hashes calculados pelo pipeline. O título da página e o texto do extract, que vêm da Wikipedia, ficam fora do comando do workflow.
- O run termina com 0, e o script de rebuild não restaura o cache.

## Alternativas consideradas

### Versionar a observação

Guardar o extract novo como segunda observação da mesma revisão, com hash e data de coleta, e apontar as evidências novas para ela. A proveniência acompanharia o texto atual, mas `source_revisions` teria mais de uma observação por `revid`, e o locator das evidências (`wikipedia:<idioma>:pageid=<pageid>:revid=<revid>#extract[...]`) precisaria identificar a observação. A mudança de esquema e de contrato não se paga para um caso que, até aqui, só foi reproduzido em simulação.

### Sobrescrever o snapshot

Trocaria o arquivo e o hash da revisão pelo extract novo. As evidências já publicadas apontariam para um texto diferente do que citam, e o invariante de que toda afirmação aponta para uma revisão e um local dentro da fonte seria violado.

### Manter o aborto

O rebuild diário dependeria de nenhuma página guardada mudar de renderização, uma condição que qualquer edição de template controla. A falha se repetiria todos os dias depois do fallback.

## Consequências

- Uma página cujo extract mudou sem revisão nova não derruba mais o rebuild diário. O dia publica fatos novos dos outros grupos e mostra `Extract changed without a new revision` no resumo da execução.
- A página fica congelada na observação guardada até ganhar uma revisão nova. Uma correção feita só num template não chega aos fatos dela nesse intervalo. Uma mudança de `wikidata_id`, título ou marcação de desambiguação na mesma revisão também não é registrada enquanto a deriva persistir, porque a página inteira é pulada.
- A checagem de assunto de `_page_rejection` em lançamentos lê o extract baixado, e a evidência lê o guardado. Com deriva, a decisão de aceite e a evidência podem vir de textos diferentes da mesma revisão.
- Num run de lançamentos, páginas de wikis diferentes com o mesmo `pageid` dividem a chave única de `collection_issues`, e só a primeira deriva grava a linha. As duas aparecem no aviso, que lê `extract_drifts`.
- O teste de `tests/test_storage.py` que exigia `SnapshotIntegrityError` para o extract alterado foi substituído por testes de quarentena em dois dias seguidos, de lançamento, de pessoa, de snapshot corrompido e de snapshot ou JSON baixado de outra revisão.
- Reverter o código volta ao aborto. As linhas `extract_drift` em `collection_issues` ficam no banco sem uso.
