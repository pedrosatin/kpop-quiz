# ADR 011 sobre mecânica de caça-palavras temático

## Status

Aceita

## Data

2026-09-18

## Contexto

O K-pop Quiz publica partidas de múltipla escolha com dez perguntas por sessão, grades de interseções 3x3, quebra-cabeças de palavras conectadas 4x4 e desafios de adivinhação de nomes por tentativas, conforme estabelecido nas decisões arquiteturais anteriores. O catálogo do projeto prevê a introdução de novas famílias de jogos de acordo com o documento de planejamento `docs/ideas/game-mechanics-and-visual-system.md`. A quarta família planejada é a mecânica de caça-palavras temático, baseada na localização de palavras distribuídas em uma matriz de caracteres alfabéticos.

A aplicação opera como site estático publicado no GitHub Pages, sem banco de dados ativo ou infraestrutura de servidor em tempo de execução. O novo formato precisa operar de forma estática, com paridade funcional entre os idiomas suportados pt-BR e en. Toda entidade participante, seus metadados, suas pistas e suas explicações devem derivar diretamente dos fatos auditados armazenados no banco SQLite local. Essa restrição mantém a rastreabilidade factual por meio de identificadores Wikidata e evidências de revisão.

## Decisão

### Topologia e dimensões da grade 10x10 a 14x14

O jogo de caça-palavras adota uma grade bidimensional retangular formada por linhas e colunas de células alfabéticas. O contrato de dados estipula dimensões mínimas de 8 e máximas de 16 para linhas e colunas. No catálogo diário de produção, as partidas utilizam grades quadradas entre 10x10 e 14x14 células. A dimensão padrão adotada é 12x12 células, estabelecendo equilíbrio entre espaço de busca no visor móvel e densidade de palavras inseridas.

Cada célula da grade contém exatamente um caractere alfabético ASCII maiúsculo no intervalo de A a Z. A grade completa é serializada no contrato como uma matriz de strings unitárias `grid[rows][cols]`.

### Seleção temática e normalização de palavras

Cada partida organiza-se em torno de um tema factual definido pelo catálogo de entidades auditadas. O tema pode abranger grupos de uma geração específica, integrantes de uma mesma banda, lançamentos com certificação ou artistas associados a uma agência. A partida contém entre 3 e 20 palavras candidatas, com média operacional de 6 a 10 palavras por tabuleiro.

Os nomes de grupos e artistas no K-pop apresentam variações frequentes de maiúsculas, minúsculas, caracteres especiais, pontuação, acentuação e espaçamento. Para inserção inequívoca na grade alfabética, o gerador adota a seguinte regra de normalização:
1. Decomposição de caracteres acentuados para sua forma básica via decomposição de compatibilidade Unicode (NFKD), com remoção de diacríticos.
2. Conversão de todos os caracteres para letras maiúsculas.
3. Remoção de espaços, hífens, pontos, apóstrofos e símbolos de pontuação.
4. Restrição estrita aos 26 caracteres alfabéticos ASCII no intervalo `[A-Z]`.
5. Validação de comprimento entre 3 e 16 caracteres. Palavras com menos de 3 caracteres são descartadas por gerarem colisões acidentais na grade; palavras com mais de 16 caracteres ultrapassam a dimensão máxima permitida de grade.

Exemplos de normalização:
* "TWICE" resulta em `TWICE` (5 letras).
* "aespa" resulta em `AESPA` (5 letras).
* "STAYC" resulta em `STAYC` (5 letras).
* "(G)I-DLE" resulta em `GIDLE` (5 letras).
* "LE SSERAFIM" resulta em `LESSERAFIM` (10 letras).
* "BLACKPINK" resulta em `BLACKPINK` (9 letras).

### Posicionamento e direções lineares em 8 eixos

As palavras são posicionadas em linha reta contínua na grade, podendo percorrer 8 direções lineares a partir da célula inicial:
1. Horizontal da esquerda para a direita (passo de linha 0, passo de coluna +1).
2. Horizontal da direita para a esquerda (passo de linha 0, passo de coluna -1).
3. Vertical de cima para baixo (passo de linha +1, passo de coluna 0).
4. Vertical de baixo para cima (passo de linha -1, passo de coluna 0).
5. Diagonal descendente para a direita (passo de linha +1, passo de coluna +1).
6. Diagonal descendente para a esquerda (passo de linha +1, passo de coluna -1).
7. Diagonal ascendente para a direita (passo de linha -1, passo de coluna +1).
8. Diagonal ascendente para a esquerda (passo de linha -1, passo de coluna -1).

Cada palavra registra no artefato as coordenadas de início (`start_row`, `start_col`) e término (`end_row`, `end_col`). As coordenadas devem pertencer ao intervalo `[0, rows)` e `[0, cols)`. O segmento retilíneo definido pelos dois extremos deve ter comprimento idêntico ao número de letras da palavra normalizada. Todas as letras da palavra devem corresponder exatamente às letras das células percorridas na grade. Duas palavras podem cruzar-se na grade quando compartilham o mesmo caractere na célula de interseção.

### Letras de preenchimento e distribuição determinística

Após o posicionamento das palavras temáticas, as células vazias da grade recebem caracteres alfabéticos maiúsculos no intervalo A a Z. O preenchimento opera por meio de gerador pseudoaleatório com semente fixa derivada de `puzzle_id` ou `reference_date`. A mesma semente produz sempre a mesma matriz de caracteres.

A distribuição de frequências das letras de preenchimento utiliza pesos proporcionais à frequência de letras nos nomes romanizados do catálogo de K-pop, enriquecendo as combinações para dificultar a identificação imediata das palavras sem gerar palavras indesejadas. O algoritmo verifica que nenhuma palavra da lista do tema aparece na grade fora das posições declaradas no artefato.

### Pistas pedagógicas e rastreabilidade de evidências

Para preservar o objetivo educativo do projeto, cada palavra associada ao quebra-cabeça inclui metadados factuais auditados:
1. Identificador Wikidata invariante (`id`, padrão QID).
2. Nome canônico da entidade e rótulos para `pt-BR` e `en`. Para pessoas e grupos, os dois rótulos recebem o mesmo nome, o que gerou a palavra da grade. Esse nome é o canônico quando seu comprimento normalizado tem entre 3 letras e a dimensão máxima da grade; se o nome canônico ultrapassar a grade, utiliza-se o primeiro rótulo ou alias que caiba nesse intervalo. Entidades cujo nome canônico normaliza para menos de 3 letras (como "I.N", "RM" ou "V") são descartadas da seleção de palavras do caça-palavras para evitar colisões acidentais na grade, conforme a regra de comprimento mínimo. Rótulos de gravadoras usados em temas e pistas continuam localizados.
3. Pista opcional bilíngue (`clue`), que diferencia a palavra das demais do tema. A regra está na seção seguinte.
4. Lista de evidências auditadas (`evidence`), com `fact_base_id`, `locator`, `revision_id`, `source_key` e URL HTTPS para auditoria externa no Wikidata ou na Wikipédia. A lista reúne a evidência do fato que coloca a palavra no tema e, quando há pista, a evidência do fato citado na pista.

### Regra das pistas

A pista cita um único fato aceito, com evidência, sobre a própria entidade. Nos temas de integrantes e de gravadora, o fato que define o tema nunca vira pista. No tema de década, o ano de formação vem da mesma declaração `formed_on` que define o tema, e a pista informa o ano exato, que o título do tema não traz. As opções por tipo de tema são:

| Tema | Opções de pista |
| --- | --- |
| Integrantes de um grupo | ano de nascimento (`born_on`, precisão de ano ou melhor); outro grupo do qual a pessoa é integrante (`has_member`/`member_of`) |
| Grupos de uma gravadora | ano de formação (`formed_on`); outra gravadora do grupo (`record_label`) |
| Grupos de uma década | ano de formação (`formed_on`); gravadora (`record_label`) |

Entre as opções de uma palavra, o gerador escolhe o texto compartilhado pelo menor número de palavras candidatas do tema; empates seguem a ordem nascimento, formação, gravadora, outro grupo, e depois o texto em inglês. Datas com precisão menor que ano, como década ou século, e anos divergentes entre declarações não geram pista. Datas de entrada e saída de integrantes não são usadas, porque a validação marca esses qualificadores como `validity_not_evidenced`.

Sem opção, a palavra fica sem `clue`, e a interface mostra só a contagem de letras. Se, depois do sorteio, todas as palavras com pista tiverem o mesmo texto, o gerador remove todas as pistas da partida e a evidência que só elas usavam. A função `validate_word_search_clues` rejeita pista igual ao título do tema em qualquer idioma e partida com duas ou mais pistas todas iguais. O gerador a executa em toda partida. Ela fica fora de `validate_word_search_puzzle` para que artefatos publicados antes desta regra continuem passando na verificação estrutural até a próxima geração diária.

O jogador pode consultar a lista de palavras pendentes em dois modos: exibição direta dos nomes ou modo com pistas, no qual o nome da palavra permanece oculto até sua descoberta ou mediante solicitação de dica.

### Resumo compartilhável e acessibilidade WCAG 2.2 AA

Ao concluir a partida ou localizar todas as palavras, o cliente web gera um resumo em texto puro para compartilhamento em aplicativos e redes sociais:

```text
K-pop Word Search 2026-09-18 8/8 (02:15)
```

O resumo indica a data de referência, a proporção de palavras encontradas sobre o total e a duração decorrida no formato de minutos e segundos. Se o jogador compartilhar antes de encontrar todas as palavras, a contagem reflete o progresso parcial registrado no momento da ação.

A interface gráfica adota as diretrizes da norma WCAG 2.2 nível AA:
1. Navegação completa por teclado. O foco move-se entre as células da grade com as teclas de seta (Cima, Baixo, Esquerda, Direita). A seleção inicia com a tecla Espaço ou Enter na primeira célula e conclui com nova ativação na célula final. Teclas de atalho permitem alternar para a lista de palavras e para o botão de dicas.
2. Contraste de cores superior a 4,5:1 em elementos textuais e 3:1 em componentes interativos.
3. Modo de alto contraste com contornos espessos, padrões de seleção destacados e marcadores visuais que não dependem unicamente da cor para indicar palavras encontradas.
4. Rótulos textuais `aria-label` em cada célula com indicação de linha, coluna, letra e estado de seleção.
5. Região viva com `aria-live="polite"` para anunciar a localização de palavras e a contagem restante a usuários de leitores de tela.

### Geração estática e proveniência de dados

Os quebra-cabeças são gerados previamente durante o pipeline de build em Python e gravados atomicamente no formato JSON, sob o contrato `kpop-word-search-puzzle-v1`.

Cada artefato publicado possui `puzzle_id` (hash SHA-256 canônico) e referencia `dataset_version` (hash SHA-256 do banco de dados auditado). O navegador baixa o arquivo JSON e executa a máquina de estados, o cronômetro e a validação de seleções inteiramente no cliente.

## Alternativas consideradas

### Direções restritas a horizontal e vertical

A restrição a eixos ortogonais simplificaria o algoritmo de busca no cliente, mas diminuiria a variedade lúdica do passatempo. A inclusão das diagonais em 45 graus preserva o padrão clássico de caça-palavras sem introduzir descontinuidades geométricas.

### Formato de caminho contorcido estilo Strands

Avaliou-se o formato em que palavras mudam de direção a cada letra vizinha. Essa abordagem exige algoritmos complexos de caminho em grafo e dificulta a navegação linear por teclado para acessibilidade. A decisão manteve o formato retilíneo tradicional em 8 eixos.

### Geração em tempo de execução no cliente

Distribuir apenas a lista de palavras para que o cliente monte a grade dinamicamente pouparia bytes de download. Entretanto, impediria a auditoria estática prévia do posicionamento, quebraria a reprodutibilidade entre jogadores no mesmo dia e aumentaria o processamento inicial em dispositivos móveis. A geração estática no pipeline mantém a integridade dos artefatos publicados.

## Consequências

- O gerador Python em `kpop_scraping` seleciona entidades por tema, posiciona palavras nos 8 eixos lineares, preenche células remanescentes e valida ausência de colisões.
- O contrato de dados do caça-palavras é formalizado no arquivo `schemas/word-search-puzzle-v1.json` com validação Draft 2020-12.
- O módulo `kpop_scraping/word_search_schema.py` implementa as rotinas de extração de coordenadas, inspeção de grade, validação profunda e escrita atômica.
- A suíte de testes em `tests/test_word_search_schema.py` cobre regras de geometria, limites de grade, integridade referencial e serialização.
- O cliente web gerencia a interação tátil e por teclado, a renderização dos 8 eixos e o resumo compartilhável sem dependência de rede após o carregamento inicial.
