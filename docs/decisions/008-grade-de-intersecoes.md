# ADR 008 sobre grade de interseções

## Status

Aceita

## Data

2026-09-17

## Contexto

O K-pop Quiz publica atualmente partidas de múltipla escolha com dez perguntas por sessão, conforme definido nas decisões anteriores. A proposta descrita em `docs/ideas/game-mechanics-and-visual-system.md` estabelece a expansão do catálogo com novas famílias de jogos. A primeira família planejada é a grade de interseções, inspirada no modelo do GeoGrid.

A aplicação funciona como site estático publicado no GitHub Pages, sem infraestrutura de banco de dados ou servidor dinâmico em tempo de execução. O novo formato precisa manter total compatibilidade com essa arquitetura. Além disso, todas as respostas aceitas devem derivar unicamente dos fatos auditados armazenados no SQLite local da coleta, o que impede respostas incorretas ou dados não verificados.

## Decisão

### Topologia e dimensões

A grade de interseções é composta por uma matriz ortogonal de 3 linhas por 3 colunas, totalizando 9 células jogáveis. As linhas e colunas representam eixos de critérios independentes entre si. Uma categoria usada em um eixo não pode aparecer no outro. Critérios da mesma categoria nos dois eixos, como "3 integrantes" nas linhas e "5 ou menos integrantes" nas colunas, produzem células de leitura ambígua, e a validação do contrato rejeita a grade na publicação.

### Categorias de critérios

Os critérios associados às linhas e colunas pertencem a três categorias extraídas das tabelas de fatos aceitos:

1. Décadas de formação ou estreia do grupo (`formed_on`).
2. Gravadora ou empresa responsável (`record_label`).
3. Contagem de integrantes do grupo (`has_member`).

Cada critério declara um identificador textual único, a categoria à qual pertence e rótulos legíveis nos idiomas suportados (`pt-BR` e `en`).

A contagem de integrantes só vale para um grupo quando todas as suas afirmações `has_member` vigentes foram aceitas. Afirmações `superseded` e `stale` não contam; uma afirmação rejeitada ou em conflito deixa a lista incompleta, e o grupo fica sem critério de contagem. Contar só os integrantes aceitos poria, por exemplo, um grupo de sete integrantes sob "3 integrantes".

Um critério só entra na busca quando tem ao menos três grupos. Cada critério de um eixo cobre três células, e as nove respostas precisam ser grupos distintos, então um critério com menos grupos nunca completa uma grade. O corte não muda o conjunto de grades possíveis, só o tamanho da busca: com a evidência da [ADR-019](019-evidencia-da-infobox.md), o catálogo passou a ter mais de cem critérios de gravadora, a maioria com um grupo só.

### Células e respostas válidas

Cada uma das 9 células é endereçada pelo par de coordenadas `(row_index, col_index)`, em que `row_index` e `col_index` variam de 0 a 2.

A célula contém a lista determinística de respostas válidas (`valid_entity_ids`). Essa lista reúne os identificadores Wikidata (QIDs) dos grupos musicais aceitos no catálogo que satisfazem simultaneamente o critério da linha e o critério da coluna. Toda célula gerada para publicação precisa conter ao menos um QID válido no catálogo. Grades que resultem em células vazias são rejeitadas pelo gerador.

Cada célula inclui também o conjunto de evidências auditadas (`evidence`) composto por `fact_base_id`, `locator`, `revision_id`, `source_key` e `source_url`. Esses dados registram a comprovação factual dos critérios da célula.

### Regras da partida

A partida consiste em preencher as 9 células da grade respeitando as seguintes restrições:

1. Limite de palpites: o jogador dispõe de 9 a 12 tentativas no total, ou de uma margem de tolerância de até 3 erros antes do encerramento da partida. O acerto de todas as células na primeira tentativa conclui a partida com 9 palpites usados.
2. Regra de unicidade: cada grupo musical só pode ser usado em uma única célula da matriz ao longo de toda a partida. Caso um grupo satisfaça os critérios de duas ou mais células distintas, o jogador deve escolher estrategicamente onde alocá-lo, sem permissão de reuso posterior.
3. Seleção assistida por catálogo: o arquivo da partida incorpora a lista de candidatos aceitos (`candidate_pool`), contendo identificador QID, nome canônico e nomes nos idiomas `pt-BR` e `en`. A interface do cliente usa essa lista para alimentar um campo de seleção com preenchimento assistido para evitar divergências de grafia, pontuação ou romanização.

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

Cada grade publicada possui um identificador próprio `grid_id` (hash SHA-256) e referencia a versão do dataset factual de origem (`dataset_version`). Com a mesma versão de dados e a mesma data de referência ou semente, o gerador produz exatamente os mesmos bytes. O navegador baixa o JSON pré-calculado e executa toda a validação de palpites localmente na memória do cliente ao comparar o QID selecionado com o array `valid_entity_ids` da célula correspondente.

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
- O controle de entidades já usadas é gerenciado inteiramente pelo estado local da aplicação no cliente.

## Correção de uma grade publicada

Adendo aprovado em 2026-10-25. Uma grade comprovadamente incorreta é regenerada para a mesma data, com uma nova identidade derivada do conteúdo. A interface informa em PT e EN que o desafio foi corrigido e que o progresso da versão anterior não pode ser retomado. Palpites da nova versão continuam salvos e retomáveis pelo seu próprio `grid_id`. O aviso descreve a versão e permanece nas recargas; uma troca normal de data não o dispara.

O runner publica `grid-publication.YYYY-MM-DD.json` ao lado dos artefatos, inclusive em `next/`, sob o contrato separado `kpop-grid-publication-v1`. O schema da grade continua v1. Os campos obrigatórios são `reference_date` da publicação, `grid_id` e `grid_reference_date` da grade autorizada, ambos nulos quando indisponível, e `replaces`, a lista cumulativa de identidades rejeitadas daquela data. Uma substituição não pode reutilizar uma identidade rejeitada nem apontar para outra data. Grades reaproveitadas de dias anteriores só são permitidas sem uma substituição corretiva nessa publicação. Campos desconhecidos, versões, datas e hashes inválidos são rejeitados.

O registro de indisponibilidade é gravado antes de remover ou substituir a grade incorreta. Após a promoção, a cópia de `next/` também recebe a correção ou perde a grade rejeitada. Os demais jogos conservam seus bytes. Se a geração falhar, o registro nulo impede o loader de recuperar uma grade antiga por fallback, inclusive quando o servidor devolve HTML com status 200. Os arquivos individuais são substituídos atomicamente; em uma interrupção entre gravações, a prioridade é não oferecer o gabarito rejeitado.

O loader consulta os metadados da data de São Paulo sob o `BASE_URL`, com `cache: no-store`. Quando presentes, eles autorizam somente a identidade e a data indicadas. Uma publicação antiga sem metadados permanece compatível quando a resposta é 404 ou HTML de arquivo ausente. Metadados presentes mas inválidos, ou falha de rede ao consultá-los, não autorizam fallback. Ao reaproveitar um artefato de data anterior, o loader consulta também o registro dessa data para impedir que uma grade rejeitada volte por cache no dia seguinte. O aviso de correção só aparece para a data atual. Isso afeta somente a Grade. O registro não contém URLs nem HTML de fonte; o aviso usa texto localizado da aplicação. Não há migração de saves entre identidades.

O metadado é obrigatório para novas publicações pelo runner. Reverter apenas o código não restaura os artefatos nem torna saves de um gabarito antigo compatíveis. Uma recuperação de artefatos exige restaurar grade e registro juntos ou executar novamente a publicação validada.
