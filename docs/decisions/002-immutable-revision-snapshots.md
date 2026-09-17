# ADR 002 sobre snapshots imutáveis por revisão

## Status

Aceito em 2026-09-12.

## Contexto

O banco guardava apenas o resumo mais recente de cada página. Uma atualização substituía a resposta anterior, o que impedia reprocessar uma revisão antiga e conferir a evidência usada por uma afirmação.

A coleta precisa distinguir páginas de provedores e idiomas diferentes. Também precisa detectar corrupção ou alteração inesperada sem depender do formato físico do arquivo comprimido.

## Decisão

Salvar um snapshot por provedor, idioma, `pageid` e `revid`. O arquivo contém o objeto de página retornado pela Action API, serializado como JSON com chaves ordenadas, UTF-8 e separadores sem espaços opcionais.

O SHA-256 cobre o JSON canônico descomprimido. O gzip reduz espaço em disco e não participa da identidade do conteúdo. `source_revisions` guarda o caminho relativo, o hash e a data da primeira coleta. `collection_run_revisions` liga a mesma revisão a todas as execuções que a observaram.

Uma gravação cria um arquivo temporário no diretório de destino, sincroniza os bytes e troca o caminho de forma atômica. Se a revisão já existir, o coletor verifica o hash do banco e do arquivo. Uma divergência encerra a execução sem substituir o snapshot.

## Alternativas consideradas

### Guardar o JSON como BLOB no SQLite

Isso permitiria uma única transação para metadados e conteúdo. O banco cresceria com respostas brutas e dificultaria cópias seletivas, inspeção por ferramentas de arquivo e armazenamento futuro em serviço de objetos. A alternativa foi rejeitada.

### Calcular o hash sobre o gzip

Cabeçalhos e parâmetros de compressão podem mudar sem alterar o JSON. O hash deixaria de representar o conteúdo usado pelo extrator. A alternativa foi rejeitada.

### Sobrescrever o caminho de uma revisão

O `revid` identifica conteúdo imutável na fonte. Aceitar uma alteração silenciosa apagaria a evidência anterior. A alternativa foi rejeitada.

## Consequências

- Extratores futuros podem reprocessar uma revisão sem consultar a rede.
- Banco e snapshots podem ser movidos juntos porque o banco guarda caminhos relativos.
- Uma coleta repetida cria outra execução e reutiliza a revisão já armazenada.
- Uma falha após a gravação do arquivo e antes do commit pode deixar um snapshot sem linha no banco. A coleta seguinte verifica e reutiliza o arquivo. Uma rotina futura poderá remover arquivos sem referência.
- O snapshot atual contém o objeto de página com resumo. Wikitext, tabelas e infoboxes exigirão novas consultas e novos tipos de snapshot.
