# ADR 010 sobre mecânica de nome por tentativas

## Status

Aceita

## Data

2026-09-18

## Contexto

O K-pop Quiz publica partidas de múltipla escolha com dez perguntas por sessão, grades de interseções 3x3 e quebra-cabeças de palavras conectadas 4x4, conforme estabelecido nas decisões arquiteturais anteriores. O catálogo do projeto prevê a introdução de novas famílias de jogos de acordo com o documento de planejamento `docs/ideas/game-mechanics-and-visual-system.md`. A terceira família planejada é a mecânica de adivinhação de nomes por tentativas, com palpites em campo aberto e retorno posicional por caractere, no formato consagrado por jogos de palavras diários.

A aplicação opera exclusivamente como site estático publicado no GitHub Pages, sem banco de dados ativo ou infraestrutura de servidor em tempo de execução. O novo formato precisa operar de forma estática, com paridade funcional entre os idiomas suportados pt-BR e en. Toda entidade-alvo, seus metadados, suas pistas e suas explicações devem derivar diretamente dos fatos auditados armazenados no banco SQLite local. Isso assegura rastreabilidade factual por meio de identificadores Wikidata e evidências de revisão.

## Decisão

### Topologia de grade e comprimento de palavra

O jogo de nome por tentativas baseia-se na descoberta de uma entidade do universo K-pop (grupo musical ou integrante) a partir de palpites com comprimento fixo de $N$ caracteres. Cada partida define:

1. Comprimento da palavra (`word_length`): inteiro entre 3 e 10 caracteres, correspondente ao tamanho do nome normalizado da entidade-alvo do dia (por exemplo, 5 letras para TWICE, AESPA ou STAYC).
2. Limite de tentativas (`max_attempts`): número máximo de palpites permitidos na partida, configurado entre 4 e 8 tentativas, com padrão estabelecido em 6 tentativas.
3. Grade de exibição: matriz de `max_attempts` linhas por `word_length` colunas, em que cada linha recebe uma tentativa submetida pelo jogador.

### Normalização alfabética canônica

Os nomes de grupos e artistas no K-pop apresentam variações frequentes de maiúsculas e minúsculas, caracteres especiais, pontuação, acentuação e espaçamento. Para permitir a digitação por teclado virtual e físico padrão A-Z sem ambiguidade, o pipeline adota a seguinte regra de normalização alfabética:

1. Decomposição de caracteres acentuados para sua forma básica via decomposição de compatibilidade Unicode (NFKD), com remoção de marcas de diacrítico.
2. Conversão de todos os caracteres para letras maiúsculas.
3. Remoção integral de espaços, hífens, pontos, apóstrofos, exclamações e barras.
4. Restrição estrita aos 26 caracteres alfabéticos ASCII `[A-Z]`.

Exemplos de normalização:
* "TWICE" resulta em `TWICE` (5 letras).
* "aespa" resulta em `AESPA` (5 letras).
* "STAYC" resulta em `STAYC` (5 letras).
* "LE SSERAFIM" resulta em `LESSERAFIM` (10 letras).
* "Red Velvet" resulta em `REDVELVET` (9 letras).
* "(G)I-DLE" resulta em `GIDLE` (5 letras).

### Dicionário de palpites válidos e integridade referencial

Para impedir submissões arbitrárias ou combinações desconexas de letras, cada partida publicada embute uma lista fechada de palpites válidos (`valid_guesses`):

1. Toda entrada em `valid_guesses` deve ser uma string de letras maiúsculas com comprimento exatamente igual a `word_length`.
2. A lista de palpites válidos é composta pelo conjunto de nomes canônicos e aliases normalizados de entidades do catálogo que possuam o comprimento exato da partida, complementada por termos e palavras candidatas válidas.
3. O nome normalizado da entidade-alvo deve obrigatoriamente pertencer ao array `valid_guesses`.
4. A validação do palpite ocorre inteiramente no cliente, verificando se o texto digitado está contido em `valid_guesses`. Caso não esteja, o cliente rejeita o envio com aviso visual sem consumir uma tentativa.

### Algoritmo de retorno posicional e tratamento de duplicatas

Ao submeter um palpite válido de comprimento $N$, o sistema avalia cada letra contra a palavra-alvo segundo um algoritmo determinístico em duas passagens para tratar corretamente letras repetidas:

1. Contagem de frequência: calcula-se a contagem de ocorrências de cada letra na palavra-alvo.
2. Primeira passagem (acertos exatos):
   Para cada posição $i$ de 0 a $N-1$:
   Se a letra do palpite coincide com a letra da palavra-alvo na posição $i$, o estado da posição é classificado como `correct` (verde) e decrementa-se a contagem daquela letra.
3. Segunda passagem (letras presentes ou ausentes):
   Para cada posição $i$ de 0 a $N-1$ que não tenha recebido a classificação `correct`:
   Se a letra do palpite existe na palavra-alvo e a contagem disponível é maior que zero, o estado da posição é classificado como `present` (amarelo) e decrementa-se a contagem disponível da letra.
   Caso contrário, o estado é classificado como `absent` (cinza escuro).

Essa ordenação impede que uma letra repetida no palpite receba múltiplos destaques amarelos quando a palavra-alvo contiver apenas uma ocorrência daquela letra.

### Pistas pedagógicas e metadados da entidade

Diferente de jogos de palavras genéricos, o objetivo educativo do K-pop Quiz é conectar o quebra-cabeça aos fatos históricos e catalográficos auditados. O objeto da entidade-alvo traz:

1. Identificador Wikidata invariante (`id`, padrão QID).
2. Nome canônico e rótulos traduzidos para `pt-BR` e `en`.
3. Tipo da entidade (`group` ou `person`).
4. Metadados e pistas opcionais (`clues`): ano de estreia (`debut_year`), agência ou empresa gestora (`agency`), contagem de integrantes (`members_count`) e descrição bilíngue sumária (`description`).
5. Lista de evidências auditadas (`evidence`), com `fact_base_id`, `locator`, `revision_id`, `source_key` e URL HTTPS para verificação no Wikipedia ou Wikidata.

Essas informações são reveladas no encerramento da partida ou de forma progressiva no modo assistido.

### Resumo compartilhável e acessibilidade

Ao término da partida, o cliente gera um resumo textual para compartilhamento em redes e aplicativos de mensagem, sem revelar o nome da entidade:

```text
K-pop Guess 2026-09-18 4/6

⬛🟨⬛⬛⬛
🟩⬛⬛🟨⬛
🟩🟩🟩⬛🟩
🟩🟩🟩🟩🟩
```

Para garantir conformidade com diretrizes de acessibilidade (WCAG 2.2) e apoiar pessoas com daltonismo, a interface disponibiliza:
1. Modo de alto contraste, com uso de azul para acerto exato e laranja para letra presente.
2. Modo monocromático com símbolos tipográficos (`✓`, `~`, `✗`) junto a cada bloco.
3. Rótulos textuais `aria-label` em cada célula indicando posição, letra e estado (`correto`, `presente`, `ausente`).

### Geração estática e proveniência de dados

Os arquivos de partidas são gerados em tempo de compilação pelo pipeline Python e gravados atomicamente no formato JSON, conforme o contrato `kpop-name-guess-puzzle-v1`.

Cada artefato gerado possui `puzzle_id` (hash SHA-256 canônico) e referencia `dataset_version` (hash SHA-256 canônico do banco de dados). O navegador carrega o artefato estático e executa toda a máquina de estados localmente via TypeScript, sem dependência de APIs em tempo de execução.

## Alternativas consideradas

### Comprimento universal de cinco letras

Fixar todas as partidas em 5 letras restringiria severamente o catálogo de entidades selecionáveis, excluindo grupos relevantes como EXO (3 letras), ITZY (4 letras), STAYC (5 letras), NEWJEANS (8 letras) ou BLACKPINK (9 letras). A flexibilidade de $N$ entre 3 e 10 letras, fixada por dia, preserva a variedade do acervo sem prejudicar a clareza das regras.

### Palpites totalmente livres em dicionário aberto

Permitir que o jogador digite qualquer palavra de língua portuguesa ou inglesa desvirtuaria a proposta temática do jogo. A exigência de que os palpites pertençam a um vocabulário temático de entidades e termos do K-pop mantém a coerência da experiência lúdica.

### Validação remota de tentativas em servidor

A verificação remota exigiria servidor dinâmico, contrariando o princípio de hospedagem estática no GitHub Pages. Como o jogo é casual e educativo, a presença da lista no JSON estático do cliente atende plenamente aos requisitos de arquitetura.
