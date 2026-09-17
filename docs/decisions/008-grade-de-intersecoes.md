# ADR 008: grade de interseções

## Status

Aceita

## Data

2026-09-17

## Contexto

O K-pop Quiz publica atualmente partidas de múltipla escolha com dez perguntas por sessão, conforme definido nas decisões anteriores. A proposta descrita em `docs/ideas/game-mechanics-and-visual-system.md` estabelece a expansão do catálogo com novas famílias de jogos. A primeira família planejada é a grade de interseções, inspirada no modelo do GeoGrid.

A aplicação funciona como site estático publicado no GitHub Pages, sem infraestrutura de banco de dados ou servidor dinâmico em tempo de execução. O novo formato precisa manter total compatibilidade com essa arquitetura. Além disso, todas as respostas aceitas devem derivar unicamente dos fatos auditados armazenados no SQLite local da coleta, impedindo respostas incorretas ou dados não verificados.

## Decisão

### Topologia e dimensões

A grade de interseções é composta por uma matriz ortogonal de 3 linhas por 3 colunas, totalizando 9 células jogáveis. As linhas e colunas representam eixos de critérios independentes entre si.

### Categorias de critérios

Os critérios associados às linhas e colunas pertencem a três categorias extraídas das tabelas de fatos aceitos:

1. Décadas de formação ou estreia do grupo (`formed_on`).
2. Gravadora ou empresa responsável (`record_label`).
3. Contagem de integrantes do grupo (`has_member`).

Cada critério declara um identificador textual único, a categoria à qual pertence e rótulos legíveis nos idiomas suportados (`pt-BR` e `en`).

### Células e respostas válidas

Cada uma das 9 células é endereçada pelo par de coordenadas `(row_index, col_index)`, em que `row_index` e `col_index` variam de 0 a 2.

A célula contém a lista determinística de respostas válidas (`valid_entity_ids`). Essa lista reúne os identificadores Wikidata (QIDs) dos grupos musicais aceitos no catálogo que satisfazem simultaneamente o critério da linha e o critério da coluna. Toda célula gerada para publicação precisa conter ao menos um QID válido no catálogo. Grades que resultem em células vazias são rejeitadas pelo gerador.

Cada célula inclui também o conjunto de evidências auditadas (`evidence`) composto por `fact_base_id`, `locator`, `revision_id`, `source_key` e `source_url`. Esses dados registram a comprovação factual dos critérios da célula.

### Regras da partida

A partida consiste em preencher as 9 células da grade respeitando as seguintes restrições:

1. Limite de palpites: o jogador dispõe de 9 a 12 tentativas no total, ou de uma margem de tolerância de até 3 erros antes do encerramento da partida. O acerto de todas as células na primeira tentativa conclui a partida com 9 palpites utilizados.
2. Regra de unicidade: cada grupo musical só pode ser utilizado em uma única célula da matriz ao longo de toda a partida. Caso um grupo satisfaça os critérios de duas ou mais células distintas, o jogador deve escolher estrategicamente onde alocá-lo, sem permissão de reuso posterior.
3. Seleção assistida por catálogo: o arquivo da partida incorpora a lista de candidatos aceitos (`candidate_pool`), contendo identificador QID, nome canônico e nomes nos idiomas `pt-BR` e `en`. A interface do cliente utiliza essa lista para alimentar um campo de seleção com preenchimento assistido, eliminando falhas decorrentes de grafias divergentes, pontuação ou romanizações alternativas.

### Resumo compartilhável

A conclusão da partida gera um resumo textual formatado em blocos para compartilhamento sem revelação das respostas:

```text
K-pop Grid 2026-09-17
9/9 acertos (10 palpites)
🟩🟩🟩
🟩🟩🟩
🟩🟩🟩
```

Para atender aos requisitos de acessibilidade e modos de alto contraste, a interface oferece alternativa baseada em caracteres monocromáticos (`■` para acerto e `□` para erro ou célula não preenchida). O texto exportado inclui a data de referência, a pontuação obtida e o total de palpites gastos, sem expor os nomes dos grupos escolhidos ou das alternativas válidas.

### Geração estática e determinismo

A geração das grades ocorre em tempo de compilação por meio do pipeline Python. O artefato gerado segue o contrato formal `kpop-intersection-grid-v1`.

Cada grade publicada possui um identificador próprio `grid_id` (hash SHA-256) e referencia a versão do dataset factual de origem (`dataset_version`). Com a mesma versão de dados e a mesma data de referência ou semente, o gerador produz exatamente os mesmos bytes. O navegador baixa o JSON pré-calculado e executa toda a validação de palpites localmente na memória do cliente, comparando o QID selecionado com o array `valid_entity_ids` da célula correspondente.

## Alternativas consideradas

### Consultas dinâmicas em tempo de execução

A avaliação de palpites via requisições a uma API backend ou via SPARQL em tempo real exigiria servidores ativos e introduziria dependência de rede externa. Essa abordagem foi descartada para preservar a publicação estática no GitHub Pages e proteger o jogo contra alterações não auditadas na fonte primária.

### Reutilização de entidades entre células

Permitir que o mesmo grupo preencha múltiplas células simplificaria excessivamente a resolução da grade, pois grupos proeminentes poderiam resolver grande parte do tabuleiro. A regra de unicidade foi adotada para exigir planejamento prévio e valorizar o conhecimento sobre formações e gravadoras menos conhecidas.

### Entrada em texto livre sem catálogo assistido

A digitação livre sujeita o jogador a erros ortográficos, diferenças entre alfabetos latino e hangul e variações de espaçamento. A adoção do `candidate_pool` com autocompletar restringe a entrada a entidades previamente catalogadas e auditadas.

### Células sem respostas válidas no catálogo

A inclusão de células impossíveis de resolver aumentaria a frustração do usuário. A regra adotada exige que todo par de critérios tenha ao menos um grupo correspondente no banco local de fatos.

## Consequências

- O gerador Python precisa cruzar as tabelas de fatos do SQLite e computar o gabarito determinístico de cada célula antes da gravação dos arquivos.
- O contrato de dados da grade passa a ser governado pelo schema JSON Draft 2020-12 em `schemas/intersection-grid-v1.json`.
- A verificação de acerto ou erro ocorre de forma síncrona e instantânea no navegador, sem tráfego de dados adicional durante a partida.
- O controle de entidades já utilizadas é gerenciado inteiramente pelo estado local da aplicação no cliente.
