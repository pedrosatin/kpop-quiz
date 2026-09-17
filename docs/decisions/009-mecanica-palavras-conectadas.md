# ADR 009 sobre mecânica de palavras conectadas

## Status

Aceita

## Data

2026-09-17

## Contexto

O K-pop Quiz publica partidas de múltipla escolha com dez perguntas por sessão e grades de interseções com matriz de 3 por 3 células, conforme estabelecido nas decisões arquiteturais anteriores. O catálogo do projeto prevê a introdução de novas famílias de jogos de acordo com o documento de planejamento `docs/ideas/game-mechanics-and-visual-system.md`. A segunda família planejada é a mecânica de palavras conectadas, baseada no agrupamento de 16 itens em 4 grupos temáticos de 4 elementos.

A aplicação opera exclusivamente como site estático publicado no GitHub Pages, sem banco de dados ativo ou infraestrutura de servidor em tempo de execução. O novo formato precisa operar de forma estática, com paridade funcional entre os idiomas suportados pt-BR e en. Todas as categorias, itens e explicações devem derivar diretamente dos fatos auditados armazenados no banco SQLite local. Isso assegura rastreabilidade factual por meio de identificadores Wikidata e evidências de revisão.

## Decisão

### Topologia 4x4

O tabuleiro de palavras conectadas é composto por um conjunto fixo de 16 itens. Esses itens são distribuídos visualmente em uma grade bidimensional de 4 linhas por 4 colunas ou em uma lista flexível de 16 botões interativos. A ordem de apresentação dos itens na interface é embaralhada de forma determinística ou pseudoaleatória no início de cada partida.

### Categorias temáticas e quatro níveis de dificuldade

Cada partida contém exatamente 4 categorias temáticas disjuntas. Cada categoria reúne exatamente 4 itens que compartilham uma relação factual comum extraída do banco de dados auditado.

As 4 categorias recebem níveis de dificuldade distintos, de 1 a 4:

1. Nível 1: categoria direta, com critérios amplos e de fácil identificação, como agência principal, país de origem ou década de estreia.
2. Nível 2: categoria moderada, com características de maior especificidade, como contagem de integrantes, posições formais ou marcos cronológicos definidos.
3. Nível 3: categoria avançada, com relações menos óbvias, como subunidades, colaborações registradas ou premiações específicas.
4. Nível 4: categoria especialista, com conexões conceituais ou sutis, como coincidências de nomes artísticos, cidades natais compartilhadas ou detalhes de lançamentos auditados.

Cada partida deve conter exatamente uma categoria para cada um dos níveis de dificuldade do conjunto `{1, 2, 3, 4}`.

### Itens e representação bilíngue

Cada um dos 16 itens é identificado pelo identificador Wikidata (QID), possui um nome canônico invariante e declara rótulos traduzidos para os idiomas `pt-BR` e `en`.

As categorias declaram identificador textual único, rótulo bilíngue do tema, texto explicativo bilíngue com a justificativa factual da conexão entre os 4 itens e a lista de evidências auditadas. O suporte bilíngue completo assegura que a lógica de resolução e a clareza conceitual sejam idênticas em português e inglês.

### Unicidade da partição e ausência de ambiguidade

Os 16 itens formam uma partição perfeita do conjunto do tabuleiro:

1. A união dos 4 conjuntos de itens das categorias coincide exatamente com a totalidade dos 16 itens declarados.
2. A interseção entre quaisquer duas categorias é estritamente vazia.
3. O gerador do quebra-cabeça deve verificar se não existem agrupamentos alternativos válidos de 4 itens entre as 16 entidades disponíveis no banco de dados local. A partição definida pelo arquivo publicado é a única combinação correta permitida pelas regras.

### Regras da partida e limite de quatro erros

A partida é executada localmente no navegador segundo as seguintes regras de estado:

1. Seleção de itens: o jogador seleciona exatamente 4 itens do tabuleiro e submete o palpite.
2. Resolução de grupo: se os 4 itens selecionados coincidirem com os `item_ids` de uma categoria não resolvida, o grupo é considerado concluído. Os 4 itens são removidos da grade ativa e agrupados em uma faixa horizontal com a cor correspondente à sua dificuldade, com exibição do rótulo do tema e da explicação factual.
3. Tratamento de erro: se o palpite não corresponder a nenhuma categoria, o jogador perde uma vida. A partida permite no máximo 4 erros.
4. Sinalização de proximidade: se o palpite incorreto contiver exatamente 3 itens pertencentes a uma mesma categoria ainda não resolvida, a interface exibe aviso de que o palpite está a um item de distância da solução correta.
5. Condição de vitória: a partida termina com vitória quando os 4 grupos são resolvidos com menos de 4 erros.
6. Condição de derrota: a ocorrência do quarto erro encerra imediatamente a partida, com revelação das categorias remanescentes e de suas respectivas explicações.

### Resumo compartilhável com emojis e alternativa monocromática

Ao final da partida, a aplicação disponibiliza um resumo textual para cópia e compartilhamento, sem expor os nomes dos itens ou das categorias:

```text
K-pop Connections 2026-09-17
Resultado: 4/4 grupos
Tentativas: 6 (2 erros)

🟨🟨🟨🟨
🟩🟩🟦🟩
🟩🟩🟩🟩
🟪🟦🟪🟪
🟪🟪🟪🟪
🟦🟦🟦🟦
```

Cada linha representa um palpite submetido. Cada caractere corresponde à cor de dificuldade da categoria do item selecionado: amarelo para nível 1, verde para nível 2, azul para nível 3 e roxo para nível 4.

Para suporte a acessibilidade e temas de alto contraste, a interface disponibiliza uma versão monocromática baseada em numerais ou caracteres diferenciados (`①`, `②`, `③`, `④`), sem dependência de distinção exclusivamente cromática.

### Geração estática e proveniência com evidências

Os arquivos de partidas são gerados em tempo de compilação pelo pipeline Python e serializados no formato estático JSON, conforme o contrato `kpop-connections-puzzle-v1`.

Cada artefato gerado possui um identificador criptográfico `puzzle_id` (hash SHA-256) e referencia a versão do conjunto de fatos de origem `dataset_version` (hash SHA-256). Cada categoria incorpora a lista de evidências auditadas com os campos `fact_base_id`, `locator`, `revision_id`, `source_key` e `source_url` HTTPS.

A partir da mesma versão do banco de dados e da mesma semente temporal, o pipeline produz bytes idênticos. O navegador carrega o artefato e conduz toda a validação de palpites e transições de estado na memória do cliente, sem requisições de rede adicionais durante o jogo.

## Alternativas consideradas

### Avaliação dinâmica de palpites via servidor

A verificação de palpites por meio de um endpoint dinâmico permitiria ocultar as soluções do cliente até o momento da resolução. Essa opção foi descartada por exigir infraestrutura de backend em tempo de execução e violar o requisito de hospedagem estática no GitHub Pages. Como o jogo é casual e educativo, a presença dos dados no JSON estático do cliente é aceitável, em alinhamento com o modelo já adotado no quiz tradicional e na grade de interseções.

### Múltiplas partições válidas com itens compartilhados

Permitir itens em mais de uma categoria introduziria ambiguidade na validação de palpites e causaria a rejeição de combinações factualmente válidas.

### Dimensões variáveis de grupos

Avaliou-se a possibilidade de usar tamanhos alternativos de tabuleiro, como 3 grupos de 3 itens (9 itens) ou 5 grupos de 5 itens (25 itens). A matriz 4x4 (16 itens) foi escolhida por manter equilíbrio entre tempo de sessão, carga cognitiva e compatibilidade com a escala padronizada de 4 níveis de dificuldade.

### Tentativas ilimitadas sem registro de erros

Tentativas ilimitadas permitiriam a enumeração exaustiva de palpites sem restrição pelo cliente. O limite de 4 erros restringe a exploração combinatória no navegador a no máximo 4 submissões incorretas por sessão.

## Consequências

- O gerador Python em `kpop_scraping` deve agrupar fatos auditados, selecionar 4 categorias com níveis 1 a 4 e validar que a partição dos 16 itens é única e disjunta.
- O contrato de dados do artefato de palavras conectadas passa a ser regulado pelo schema JSON Draft 2020-12 em `schemas/connections-puzzle-v1.json`.
- A validação estrutural e a escrita atômica do arquivo passam a ser executadas pelo módulo `kpop_scraping/connections_schema.py`.
- O cliente web gerencia o estado da partida, histórico de palpites, vidas restantes e renderização bilíngue de forma independente, sem chamadas a servidores remotos.
