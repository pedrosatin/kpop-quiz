# ADR 012 sobre mecânica de linha do tempo e ordenação cronológica ("Quando foi?")

## Status

Aceita

## Data

2026-09-18

## Contexto

O K-pop Quiz publica partidas diárias em cinco famílias de jogos complementares: quiz de múltipla escolha com justificativas auditadas, grade de interseções 3x3, palavras conectadas 4x4, adivinhação de nomes por tentativas e caça-palavras temático. O documento de evolução de produto `docs/ideas/game-mechanics-and-visual-system.md` prevê como próxima mecânica um desafio focado em cronologia e eventos históricos, sob o título "Quando foi?" (em inglês, "Timeline").

A história do K-pop é marcada por gerações bem delineadas, estreias históricas de grupos, mudanças de formação e lançamentos emblemáticos. Os dados históricos no banco de dados SQLite local já contam com fatos estruturados de estreia (`debut`), fundação/criação (`formed_on`), nascimento de integrantes e períodos de atividade com evidências auditadas provenientes da Wikipédia e do Wikidata.

A aplicação opera inteiramente como site estático publicado via GitHub Pages, sem dependência de banco de dados ou APIs dinâmicas em tempo de execução. O novo formato precisa atender aos mesmos padrões de determinismo, acessibilidade universal (WCAG 2.2 AA), paridade estrita entre os idiomas português (pt-BR) e inglês (en), validação estrita por JSON Schema Draft 2020-12 e geração reprodutível por semente diária.

## Decisão

### Objetivo do jogo e estrutura da rodada

A mecânica "Quando foi?" desafia o jogador a ordenar cronologicamente um conjunto de eventos históricos do K-pop, do marco mais antigo ao mais recente:

1. Cada partida diária apresenta exatamente 5 eventos históricos factuais associados a um tema contextual (ex.: "Estreias marcantes da 3ª geração", "Marcos históricos da SM Entertainment", "Grandes estreias femininas dos anos 2010").
2. Os eventos são apresentados ao jogador com ordem inicialmente embaralhada de forma determinística pela semente diária.
3. Para cada evento, o jogador visualiza o título, a descrição contextual e a entidade relacionada, mas as datas e anos permanecem ocultos durante a resolução.
4. O jogador organiza a sequência dos eventos utilizando interface drag-and-drop ou controles alternativos acessíveis por botões e teclado ("Mover para cima", "Mover para baixo").
5. O jogador submete seu palpite clicando em "Verificar ordem":
   - Eventos posicionados no índice cronológico correto recebem destaque verde com indicador de confirmação.
   - Eventos fora da posição correta recebem indicador visual e auditivo de ajuste necessário.
   - A partida concede até 3 tentativas para ordenação perfeita, registrando o número de tentativas utilizadas.
6. Ao concluir a partida (por sucesso ou esgotamento de tentativas):
   - Todas as datas exatas (ano, mês e dia) são reveladas na linha do tempo.
   - Cada evento disponibiliza um botão para inspecionar fontes auditadas e evidências externas na Wikipédia e no Wikidata.
   - É disponibilizado um resumo compartilhável sem spoilers em blocos e estrelas para redes sociais e mensageiros.

### Critérios de seleção de eventos e garantia de ordem estrita

Para evitar qualquer ambiguidade na ordenação que possa prejudicar o jogador, o gerador de partidas deve seguir regras matemáticas estritas:

1. **Unicidade de data**: Dois eventos na mesma partida nunca podem compartilhar a mesma data exata (`date`).
2. **Distância temporal mínima**: O intervalo entre quaisquer dois eventos consecutivos na ordem cronológica deve ser de no mínimo 30 dias (preferencialmente de 6 meses a vários anos), impedindo confusões sobre eventos quase simultâneos.
3. **Tipos de eventos permitidos**:
   - `debut`: Estreia oficial de grupo ou solista documentada na Wikipédia/Wikidata.
   - `formation`: Formação ou anúncio oficial da criação de grupo musical.
   - `member_join`: Entrada documentada de integrante em um grupo musical.
   - `disbandment`: Encerramento oficial de atividades de um grupo.
   - `birth`: Nascimento de artista relevante para o tema.
4. **Precisão de data**: Somente eventos com data documentada no nível de dia ou mês (`YYYY-MM-DD` ou `YYYY-MM`) são elegíveis para compor partidas diárias. Eventos com apenas o ano registrado são tolerados apenas quando todos os eventos da rodada pertencem a anos distintos.

### Contrato de dados e JSON Schema

O artefato diário `timeline.daily.json` é governado pelo esquema formal `schemas/timeline-puzzle-v1.json` (Draft 2020-12) com `additionalProperties: false`.

Campos obrigatórios do quebra-cabeça:
- `schema_version`: string literal `"kpop-timeline-puzzle-v1"`.
- `puzzle_id`: identificador canônico SHA-256 derivado dos dados normalizados do quebra-cabeça.
- `reference_date`: data ISO 8601 da partida diária (`YYYY-MM-DD`).
- `dataset_version`: hash de versão do catálogo de fatos utilizado na geração.
- `theme`: objeto bilíngue com rótulos `pt-BR` e `en` para o título temático.
- `theme_description`: objeto bilíngue com descrições contextuais em `pt-BR` e `en`.
- `events`: lista contendo de 4 a 6 itens (padrão diário: 5) dispostos em ordem cronológica estrita, cada um com:
  * `id`: identificador invariante do evento ou QID da entidade associada.
  * `event_type`: enumeração do tipo de evento (`debut`, `formation`, `member_join`, `disbandment`, `birth`).
  * `date`: string de data no formato ISO 8601 (`YYYY-MM-DD` ou `YYYY`).
  * `year`: número inteiro representando o ano do evento.
  * `display_date`: rótulos formatados para exibição bilíngue pós-resolução (ex.: `20 de outubro de 2015` e `October 20, 2015`).
  * `title`: objeto bilíngue com o nome do evento.
  * `description`: objeto bilíngue com resumo factual do marco histórico.
  * `entity_id`: identificador Wikidata da entidade principal (ex.: `"Q21480024"` para TWICE).
  * `entity_name`: nome canônico da entidade.
  * `evidence`: lista de objetos de evidência auditada (`fact_base_id`, `locator`, `revision_id`, `source_key`, `source_url`).

### Acessibilidade universal e conformidade WCAG 2.2 AA

1. **Operação completa por teclado e leitores de tela**: A ordenação nunca pode depender exclusivamente de arrasto com mouse ou touch. Cada cartão da lista inclui botões explícitos com `aria-label` descritivo ("Mover [Título] para cima", "Mover [Título] para baixo"), com atualização de anúncio `aria-live` informando a nova posição ("Evento movido para a posição 2 de 5").
2. **Contraste de cor e modo de alto contraste**: Todos os estados de validação (correto, incorreto, selecionado, em foco) atendem a taxa mínima de contraste de 4.5:1 em texto e 3:1 em componentes gráficos, utilizando além da cor ícones semânticos explícitos (✓, ✕, ⇅).
3. **Animação respeitosa**: Transições de reordenação respeitam `@media (prefers-reduced-motion: reduce)`, desativando deslocamentos fluidos quando configurado pelo usuário.

### Resumo compartilhável sem spoilers

O resumo compartilhável gerado ao final da partida segue o padrão visual sem spoilers adotado nos demais jogos da plataforma:

```text
K-pop Quando foi? 2026-09-18
⭐⭐⭐ (1/3 tentativas)
🟩🟩🟩🟩🟩
https://pedrosatin.github.io/kpop-scraping/pt-br/quando-foi/
```

## Consequências

### Positivas
- Enriquece a plataforma com uma sexta mecânica de jogo focada no conhecimento temporal e histórico de K-pop.
- Aproveita a base existente de datas auditadas sem necessidade de novas APIs externas.
- Mantém a arquitetura 100% estática, determinística e integrada ao ciclo diário automatizado via cron.
- Garante total conformidade com diretrizes de acessibilidade WCAG 2.2 AA.

### Negativas
- Requer curadoria e validação cuidadosa no gerador para garantir que todos os eventos de um tema possuam datas precisas e comprovadas por fontes externas.
