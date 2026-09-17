# Plano de redesign da interface

Status: especificação local para implementação após a PR 7. Este arquivo não autoriza uso de imagens, marcas ou conteúdo protegido.

Base examinada: `origin/master` no commit `f713f90` e site público em 15 de setembro de 2026.

## Decisão

O site continua estático, com Astro, Preact e rotas `/pt-br/` e `/en/`. O redesign cria uma identidade editorial própria para o K-pop Quiz. Uma cor temática identifica cada partida. Cores de texto, foco, acerto e erro permanecem fixas.

O primeiro recorte cobre a partida atual de múltipla escolha. A página de coleção, a partida diária e novas mecânicas entram em PRs posteriores. Fotos só entram após a criação do registro de licença e atribuição.

## Referências e limites

As referências orientam comportamento e hierarquia. A implementação não copia grade, microtexto, ícones, tipografia, animações nem combinação de cores.

* [GeoGrid](https://www.geogridgame.com/faq) demonstra regra curta, partida diária, categorias explicáveis e resumo de resultado. A FAQ informa que a grade combina critérios de linha e coluna e calcula raridade pela frequência das respostas.
* [Wordle](https://www.nytimes.com/games/wordle/index.html) demonstra uma ação repetida, tentativas contadas e resumo compartilhável sem respostas.
* [Strands](https://www.nytimes.com/games/strands) demonstra descoberta de tema e progresso visível em caça-palavras. Essa mecânica exige um gerador que prove a solução da grade.
* [WhenTaken](https://whentaken.com/) demonstra o uso de imagem, data e localização em uma rodada curta. A adaptação depende de mídia licenciada e datas editoriais sem ambiguidade.
* [JYP Entertainment](https://www.jype.com/) organiza lançamentos com fotografia, nome do artista, título e data. O aviso da própria empresa restringe o uso comercial do logotipo. Nenhum logotipo entra no produto sem autorização.
* [SMTOWN](https://www.smtown.com/) usa módulos de função com títulos curtos e imagens isoladas.
* [Weverse Magazine](https://magazine.weverse.io/?lang=en) usa uma lista editorial densa, com categoria, título, imagem e data.

O padrão extraído dos sites de K-pop é simples: fotografia tem espaço próprio, títulos têm peso alto e cada módulo apresenta poucos metadados. A interface não usa imagens como fundo de texto. Isso reduz problemas de contraste e evita imitar páginas promocionais.

## Inventário atual

### Estrutura

* `BaseLayout.astro` cria cabeçalho, seletor de idioma, conteúdo e rodapé.
* As duas rotas repetem o bloco introdutório e montam `Quiz` com `client:load`.
* `Quiz.tsx` concentra carregamento, timer, seleção, resposta, foco, resultado e evidências.
* `global.css` concentra todos os tokens e estilos.
* `catalog.ts` contém o texto PT-BR e inglês.

### Comportamento já preservado

* Dez perguntas por sessão.
* Progresso, pontuação e timer visíveis.
* Quatro alternativas com rádio nativo.
* Feedback imediato com justificativa e fontes.
* Foco movido para feedback, próxima pergunta e resultado.
* Estados de carregamento, artefato ausente, artefato inválido e sessão vazia.
* Verificação de manifesto e SHA-256 no carregador.
* `prefers-reduced-motion` já desativa transições e animações longas.

### Limites observados no site público

* A tela abre direto na pergunta e não permite escolher dificuldade ou timer.
* O título editorial ocupa quase metade da largura em desktop. A pergunta pode ser cortada visualmente em janelas estreitas com a grade de duas colunas.
* A identidade atual usa papel bege, vermelho, azul-petróleo e Georgia. Ela lê como quiz editorial geral, com pouca relação visual com música pop.
* Não há tema escuro, alto contraste, pistas, revisão de respostas nem compartilhamento.
* O cabeçalho oferece apenas marca e idioma.
* A tela de resultado mostra acertos, texto curto e reinício.
* O componente `Quiz.tsx` já reúne responsabilidades demais para receber preparação, pistas e preferências sem divisão.

## Arquitetura de componentes

O redesign divide apresentação e estado. O carregador atual permanece isolado em `src/data`.

```text
src/components/
  AppShell/
    SiteHeader.tsx
    PreferencesMenu.tsx
    LanguageSwitch.tsx
  GameSetup/
    GameSetup.tsx
    DifficultyPicker.tsx
    TimerControl.tsx
    GameRules.tsx
  Quiz/
    QuizController.tsx
    ProgressHeader.tsx
    QuestionCard.tsx
    HintTray.tsx
    AnswerList.tsx
    AnswerFeedback.tsx
    EvidenceDisclosure.tsx
    LicensedMedia.tsx
  Results/
    ScoreSummary.tsx
    ShareResult.tsx
    ReviewAnswers.tsx
  states/
    LoadingState.tsx
    EmptyState.tsx
    ArtifactErrorState.tsx
```

`QuizController` mantém a máquina de estado. Os outros componentes recebem dados e callbacks. Cada componente deve ficar abaixo de 200 linhas. Tema, idioma e preferências podem usar Context. Seleção, timer e resposta continuam no controlador.

Estados da partida:

```text
loading -> setup -> question.ready -> question.answered -> next
                       |                    |
                       +-> timed_out -------+
next -> question.ready | complete -> results -> review
loading -> missing | invalid | empty
```

## Tokens de cor

Os nomes CSS são semânticos. Componentes não recebem valores hexadecimais diretamente. Os contrastes abaixo usam a fórmula de luminância relativa da [WCAG 2.2](https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio).

### Tema claro

| Token CSS | Valor | Par medido | Razão |
| --- | --- | --- | --- |
| `--color-canvas` | `#FFF8F0` | `--color-text` | 16,07:1 |
| `--color-surface` | `#FFFFFF` | `--color-text` | 16,93:1 |
| `--color-surface-muted` | `#F7EFF8` | `--color-text` | 15,04:1 |
| `--color-text` | `#24182B` | `--color-canvas` | 16,07:1 |
| `--color-text-muted` | `#66566D` | `--color-canvas` | 6,40:1 |
| `--color-border` | `#94879D` | `--color-surface` | 3,38:1 |
| `--color-action` | `#B31555` | branco | 6,66:1 |
| `--color-action-hover` | `#8F1044` | branco | 9,03:1 |
| `--color-link` | `#006E73` | `--color-canvas` | 5,73:1 |
| `--color-focus` | `#0067CC` | `--color-canvas` | 5,23:1 |
| `--color-success-text` | `#0E693D` | `--color-success-bg` | 5,97:1 |
| `--color-success-bg` | `#E4F5EB` | `--color-success-text` | 5,97:1 |
| `--color-error-text` | `#A32119` | `--color-error-bg` | 6,49:1 |
| `--color-error-bg` | `#FDEAE7` | `--color-error-text` | 6,49:1 |

### Tema escuro

| Token CSS | Valor | Par medido | Razão |
| --- | --- | --- | --- |
| `--color-canvas` | `#17121C` | `--color-text` | 17,50:1 |
| `--color-surface` | `#251C2C` | `--color-text` | 15,57:1 |
| `--color-surface-muted` | `#30263A` | `--color-text` | 13,63:1 |
| `--color-text` | `#FFF7FB` | `--color-canvas` | 17,50:1 |
| `--color-text-muted` | `#CFC3D5` | `--color-canvas` | 10,90:1 |
| `--color-border` | `#776A82` | `--color-surface` | 3,25:1 |
| `--color-action` | `#FF74AC` | `#25182A` | 6,72:1 |
| `--color-action-hover` | `#FFA7CC` | `#25182A` | 9,38:1 |
| `--color-link` | `#67DAD7` | `--color-canvas` | 11,04:1 |
| `--color-focus` | `#7CC4FF` | `--color-canvas` | 9,82:1 |
| `--color-success-text` | `#74E3A8` | `--color-success-bg` | 7,80:1 |
| `--color-success-bg` | `#123C2A` | `--color-success-text` | 7,80:1 |
| `--color-error-text` | `#FF9A91` | `--color-error-bg` | 6,75:1 |
| `--color-error-bg` | `#4B201E` | `--color-error-text` | 6,75:1 |

### Cores temáticas

Cada sessão escolhe uma das quatro cores. O texto sobre a cor usa o par registrado.

| Tema | Claro | Texto claro | Razão | Escuro | Texto escuro | Razão |
| --- | --- | --- | --- | --- | --- | --- |
| rosa | `#B31555` | `#FFFFFF` | 6,66:1 | `#FF74AC` | `#25182A` | 6,72:1 |
| violeta | `#6039B2` | `#FFFFFF` | 7,71:1 | `#BCA2FF` | `#25182A` | 7,85:1 |
| ciano | `#006E73` | `#FFFFFF` | 6,04:1 | `#67DAD7` | `#25182A` | 10,13:1 |
| amarelo | `#F5C542` | `#24182B` | 10,44:1 | `#FFD95A` | `#25182A` | 12,33:1 |

O tema usa `--color-theme` em faixa, progresso, chip e ilustração. Acerto e erro nunca usam `--color-theme`. O modo de alto contraste remove sombras, aumenta bordas para 2 px e usa `Canvas`, `CanvasText`, `ButtonFace`, `ButtonText`, `Highlight` e `HighlightText` sob `forced-colors: active`.

## Tipografia

* Títulos e placar usam Space Grotesk variável, pesos 600 a 700. A fonte cobre o conteúdo latino de PT-BR e inglês. O projeto publica a família sob SIL Open Font License 1.1, conforme o [repositório oficial](https://github.com/floriankarsten/space-grotesk).
* Interface e texto usam Noto Sans variável, pesos 400 a 700. A família Noto usa SIL Open Font License 1.1, conforme a [documentação do projeto](https://github.com/notofonts/latin-greek-cyrillic).
* Nomes em coreano usam `Noto Sans KR` somente se o conjunto publicado contiver Hangul. O build cria um subconjunto dos glifos usados.
* O site hospeda os arquivos WOFF2. Não há pedido a Google Fonts em tempo de execução.
* Cada diretório de fonte inclui `OFL.txt` e um arquivo com autoria e origem.

Pilha de títulos:

```css
font-family: "Space Grotesk", "Noto Sans", ui-sans-serif, system-ui, sans-serif;
```

Pilha de interface:

```css
font-family: "Noto Sans", "Noto Sans KR", ui-sans-serif, system-ui, sans-serif;
```

Escala em rem:

| Uso | Tamanho | Linha | Peso |
| --- | --- | --- | --- |
| título da página | `clamp(2.5rem, 8vw, 5rem)` | `0.95` | 700 |
| pergunta | `clamp(1.5rem, 4vw, 2.25rem)` | `1.15` | 650 |
| título de seção | `1.5rem` | `1.2` | 650 |
| corpo | `1rem` | `1.55` | 400 |
| alternativa | `1rem` | `1.35` | 550 |
| metadado | `0.875rem` | `1.4` | 600 |
| chip | `0.75rem` | `1.2` | 700 |

## Grid, espaço e forma

Escala de espaço:

```css
--space-1: 0.25rem;
--space-2: 0.5rem;
--space-3: 0.75rem;
--space-4: 1rem;
--space-5: 1.5rem;
--space-6: 2rem;
--space-7: 3rem;
--space-8: 4rem;
```

Raios:

```css
--radius-control: 0.375rem;
--radius-card: 0.75rem;
--radius-pill: 999px;
```

Sombras:

```css
--shadow-card: 0 0.5rem 0 color-mix(in srgb, var(--color-text) 12%, transparent);
--shadow-focus: 0 0 0 0.2rem var(--color-focus);
```

O layout usa 12 colunas acima de 64 rem, 8 colunas entre 48 e 63,99 rem e 4 colunas abaixo de 48 rem. `--content-max` vale `72rem`. `--game-max` vale `52rem`. A margem lateral vale `1rem` até 47,99 rem, `2rem` até 63,99 rem e `max(2rem, (100vw - 72rem) / 2)` acima disso.

Alvos interativos medem pelo menos 44 por 44 CSS px. Alternativas usam uma coluna até 47,99 rem. Duas colunas só entram quando cada opção mantém pelo menos 15 rem e nenhum rótulo quebra em mais de três linhas.

## Tela de preparação e dificuldade

O gerador deve declarar pistas por pergunta antes que a interface ofereça os níveis.

```json
{
  "difficulty": "assisted",
  "clues_available": ["group_name", "debut_period", "licensed_image"],
  "clues_shown": ["group_name"],
  "base_points": 100,
  "hint_cost": 15,
  "timer_seconds": null
}
```

Regras:

* Assistido mostra o grupo em perguntas sobre pessoas. Pode mostrar período de estreia e imagem licenciada. O timer começa desligado.
* Padrão mostra uma pista contextual que não nomeia a resposta. O timer sugerido é 20 segundos e pode ser desligado.
* Especialista omite grupo, imagem e período. Distratores vêm da mesma empresa ou faixa temporal quando a base sustenta essa proximidade. O timer sugerido é 12 segundos e pode ser ampliado ou desligado.
* Uma pista pedida durante a rodada reduz em 15 a pontuação máxima da pergunta. A pontuação nunca fica abaixo de 25.
* O nível altera pistas e escolha de distratores. O fato correto, a explicação e a evidência permanecem iguais.
* Se a pergunta não tiver o conjunto de pistas necessário, o gerador não publica aquela variante de dificuldade.

Exemplos PT-BR:

* Assistido: `Qual integrante do TWICE nasceu em 29 de dezembro de 1996?`
* Padrão: `Qual destas integrantes de um grupo que estreou entre 2015 e 2017 nasceu em 29 de dezembro de 1996?`
* Especialista: `Quem nasceu em 29 de dezembro de 1996?`

Exemplos em inglês:

* Assisted: `Which TWICE member was born on December 29, 1996?`
* Standard: `Which member of a group that debuted between 2015 and 2017 was born on December 29, 1996?`
* Expert: `Who was born on December 29, 1996?`

O texto usa intervalo de estreia enquanto a equipe não aprovar uma taxonomia de gerações do K-pop.

## Estados e comportamento dos componentes

### Cabeçalho

`SiteHeader` contém marca textual, link para jogos, idioma e preferências. Em 320 px, marca e dois botões cabem em uma linha. O menu de preferências abre com botão nativo, recebe foco e fecha por Escape. A troca de idioma preserva o ID do jogo e o nível. Se houver progresso, pede confirmação antes de reiniciar.

### Preparação

`GameSetup` mostra título, duração, número de perguntas, temas de dados e uma regra. `DifficultyPicker` usa três rádios com a pista exata de cada nível. `TimerControl` oferece desligado, 12, 20 e 30 segundos. `StartButton` move o foco para o título da primeira pergunta.

### Rodada

`ProgressHeader` mostra pergunta, pontos e tempo. O leitor de tela recebe atualizações do timer somente em 10 segundos, 5 segundos e nos últimos 3 segundos. Isso evita anúncio a cada segundo.

`QuestionCard` mantém o enunciado acima das alternativas. Metadados aparecem em chips apenas quando são pistas declaradas.

`HintTray` lista cada pista disponível e seu custo. O botão usa texto, por exemplo `Mostrar grupo, menos 15 pontos`. Uma pista revelada permanece visível até o fim da pergunta.

`AnswerList` usa `fieldset`, `legend` e rádios nativos. A, B, C e D são decoração visual. As teclas 1 a 4 são atalhos opcionais e não substituem Tab, setas e Espaço.

`AnswerFeedback` usa `role="status"` com anúncio curto. O foco vai para o título do feedback após a resposta. Acerto mostra ícone de confirmação, texto e cor. Erro mostra ícone de erro, texto e cor. O botão de próxima pergunta vem depois da explicação curta. A fonte fica em `details`.

`LicensedMedia` exige os campos abaixo. Sem um campo, mostra o estado de mídia indisponível e preserva a pergunta textual.

```json
{
  "asset_url": "...",
  "source_url": "...",
  "creator": "...",
  "license_name": "...",
  "license_url": "...",
  "subject_qid": "...",
  "verified_at": "YYYY-MM-DD",
  "transformations": ["crop 4:5", "resize 960x1200"]
}
```

Antes da resposta, o texto alternativo diz `Foto usada como pista desta pergunta`. Após a resposta, a legenda revela o sujeito, autor, licença e fonte. Toda pergunta com imagem possui uma versão equivalente sem imagem.

### Resultado

`ScoreSummary` mostra acertos, pontos, tempo e pistas usadas. `ShareResult` gera texto local sem respostas. O botão usa a API de compartilhamento quando disponível e oferece cópia como alternativa.

Exemplo PT-BR:

```text
K-pop Quiz 8/10
■■■■□ ■■■■□
Padrão · 1 pista · 03:42
```

Exemplo em inglês:

```text
K-pop Quiz 8/10
■■■■□ ■■■■□
Standard · 1 hint · 03:42
```

`ReviewAnswers` lista enunciado, resposta do jogador, resposta correta, explicação e evidência. A revisão não altera o placar.

### Estados de dados

* Carregando usa skeleton de altura fixa com `aria-busy="true"`. A animação para com movimento reduzido.
* Artefato ausente explica que o idioma ainda não foi publicado e oferece nova tentativa.
* Artefato inválido informa falha de integridade sem mostrar hash ou caminho interno.
* Sessão vazia oferece retorno à coleção.
* Offline com sessão em cache mostra a data de publicação.
* Atualização disponível mantém a partida atual e oferece recarregar após o resultado.

## Movimento

* Seleção de alternativa usa 120 ms.
* Troca de pergunta e abertura de feedback usam 160 ms.
* Resultado usa 180 ms.
* Apenas `opacity`, `transform` e cor entram nas transições.
* Nenhuma animação roda continuamente, exceto skeleton durante carregamento.
* `prefers-reduced-motion: reduce` define duração de 1 ms, remove deslocamento e troca skeleton animado por bloco estático.
* Não usar confete, flash ou fundo em movimento.

## Wireframe mobile

Largura alvo: 320 a 767 px.

```text
┌──────────────────────────────────┐
│ KQ       Jogos       PT | tema   │  56 px
├──────────────────────────────────┤
│ HISTÓRIA · PADRÃO                │
│ Pergunta 3 de 10        260 pts  │
│ ███████░░░              00:17    │
│                                  │
│ Qual destes lançamentos saiu     │
│ primeiro?                        │
│                                  │
│ [ Mostrar ano · menos 15 pontos ]│
│                                  │
│ (A) Pink Luv                     │  56 px mín.
│ (B) Secret Garden                │
│ (C) Pink Blossom                 │
│ (D) BEST                         │
│                                  │
│ [ Responder                    ] │
└──────────────────────────────────┘
```

Após responder, o feedback entra abaixo das alternativas. A tela não move as alternativas já exibidas até o clique em `Próxima pergunta`.

## Wireframe desktop

Largura alvo: 1024 a 1440 px.

```text
┌────────────────────────────────────────────────────────────────────┐
│ KQ        Jogos                                      EN  tema  HC  │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  HISTÓRIA DO K-POP      ┌────────────────────────────────────────┐ │
│  Teste o que você sabe  │ Pergunta 3/10   260 pts        00:17  │ │
│  em dez perguntas.      │ ███████░░░                           │ │
│                         │                                      │ │
│  Padrão                 │ Qual destes lançamentos saiu         │ │
│  10 perguntas           │ primeiro?                            │ │
│  cerca de 4 min         │                                      │ │
│                         │ [ Mostrar ano · menos 15 pontos ]    │ │
│                         │                                      │ │
│                         │ [A Pink Luv] [B Secret Garden]       │ │
│                         │ [C Pink Blossom] [D BEST]            │ │
│                         │                                      │ │
│                         │ [ Responder ]                        │ │
│                         └────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

A coluna editorial ocupa 4 de 12 colunas. A partida ocupa 8 de 12. Em alturas abaixo de 720 px, a coluna editorial deixa de ser sticky.

## Migração em PRs pequenas

### PR A, contrato de dificuldade

* Adicionar campos de pistas, pontos e dificuldade aos schemas Python e TypeScript.
* Gerar variantes assistida, padrão e especialista somente quando os dados suportarem as regras.
* Preservar IDs dos fatos e criar ID semântico por variante.
* Publicar sessões PT-BR e inglês.
* Acrescentar testes de determinismo, equivalência de resposta e ausência de pista vazada.

Aceite: o validador rejeita variante sem pista declarada, custo inválido, resposta divergente ou distrator fora da classe de entidade.

### PR B, tokens, fontes e temas

* Autohospedar Space Grotesk e Noto Sans com OFL.
* Trocar variáveis atuais pelos tokens deste plano.
* Implementar claro, escuro, sistema, alto contraste e movimento reduzido.
* Manter a estrutura da partida e capturar baselines visuais.

Aceite: todos os pares de texto passam em 4,5:1. Controles, bordas e foco passam em 3:1. A página não pede fontes a terceiros.

### PR C, preparação e pistas

* Dividir `Quiz.tsx` em controlador e componentes de apresentação.
* Adicionar `GameSetup`, `DifficultyPicker`, `TimerControl` e `HintTray`.
* Persistir preferências sem armazenar conteúdo pessoal.
* Preservar foco, timer e integridade dos artefatos.

Aceite: as três dificuldades geram rodadas completas. O timer pode ser desligado antes e durante a partida. Cada pista reduz a pontuação uma vez.

### PR D, resultado e compartilhamento

* Adicionar placar detalhado, resumo compartilhável e revisão das respostas.
* Gerar texto PT-BR e inglês sem revelar respostas.
* Cobrir API de compartilhamento, cópia e ausência das duas APIs.

Aceite: o resumo não contém prompt, alternativa nem nome de entidade. A revisão mostra evidência de cada fato.

### PR E, coleção e partida diária

* Criar página inicial com jogos por tema.
* Colocar tema e nível na URL.
* Gerar sessão diária por data e idioma no build.
* Manter arquivo de sessões anteriores enquanto o pacote publicado ficar abaixo de 5 MB comprimido.

Aceite: a mesma data e idioma produzem o mesmo ID e hash. A troca de idioma abre a mesma partida lógica.

### PR F, registro de mídia

* Criar schema de mídia e verificação de licença.
* Aceitar somente licenças que permitam redistribuição no uso definido.
* Renderizar crédito ao lado da imagem e na revisão.
* Adicionar variantes de pergunta sem imagem.

Aceite: build falha se faltar autor, licença, URL da licença, fonte, sujeito, data de verificação ou transformação.

## Plano de testes

### Unidade e integração

* Vitest cobre reducer ou máquina de estado do quiz, custos de pista, timer, troca de idioma e preferências.
* Testing Library cobre nome acessível, ordem de foco, anúncios e estados de botões.
* Testes de contrato verificam equivalência entre schema Python, manifesto e tipos TypeScript.
* Testes de cor calculam contraste para cada token e estado.
* Snapshots textuais cobrem PT-BR e inglês sem usar snapshot do DOM inteiro.

### Navegador real

Executar em Chromium nas larguras 320, 768, 1024 e 1440 px. Testar alturas de 568 e 768 px no mobile. Em cada largura:

1. Abrir preparação, escolher nível e desligar timer.
2. Completar uma resposta correta e uma incorreta.
3. Revelar uma pista.
4. Abrir e fechar evidência.
5. Terminar a partida, copiar resultado e revisar respostas.
6. Repetir com teclado.
7. Repetir com zoom de 200%.
8. Verificar tema escuro, alto contraste e movimento reduzido.

Critérios: zero overflow horizontal, zero erro ou aviso no console, ordem de foco igual à ordem visual, nomes acessíveis em todos os controles e região dinâmica sem anúncios repetidos do timer.

### Acessibilidade automatizada e manual

* Rodar axe-core nas telas de preparação, pergunta pronta, resposta correta, resposta incorreta, resultado e erro de integridade.
* Verificar WCAG 2.2 AA para 1.4.3, 1.4.10, 1.4.11, 2.1.1, 2.2.1, 2.4.3, 2.4.7, 2.4.11, 2.5.8, 3.2.1, 3.3.2 e 4.1.3.
* Fazer uma passagem com leitor de tela em PT-BR e inglês antes do merge da PR C.
* Confirmar `lang` da página e `lang` em trechos que mudam de idioma.

### Regressão visual

Capturar preparação, pergunta, feedback e resultado nos quatro breakpoints. Fixar dados, fonte e relógio. A revisão humana aprova diferenças acima do limite de 0,2% dos pixels. Não aceitar baseline novo apenas para silenciar falha.

### Desempenho

Orçamento por rota em produção:

| Métrica | Meta |
| --- | --- |
| JavaScript inicial comprimido | até 90 KB |
| CSS comprimido | até 20 KB |
| fontes WOFF2 iniciais | até 140 KB |
| LCP p75 móvel | até 2,5 s |
| INP p75 móvel | até 200 ms |
| CLS p75 | até 0,05 |
| tarefa longa no carregamento | nenhuma acima de 50 ms |

Astro mantém conteúdo editorial em HTML. Apenas preparação, quiz e preferências hidratam. Fontes usam `font-display: swap`, preload somente para o peso variável de interface e dimensões fixas para toda mídia.

## Dependências de assets e licença

Pode entrar sem negociação comercial:

* Space Grotesk e Noto Sans, com arquivos WOFF2 e textos OFL 1.1 no repositório.
* Ícones próprios em SVG, com traços simples e licença do próprio projeto.
* Formas abstratas próprias geradas em CSS ou SVG.
* Dados Wikidata CC0 e texto Wikipedia conforme a atribuição já publicada.

Exige conferência por arquivo:

* Wikimedia Commons. Registrar autor, licença, URL da licença, página do arquivo e data de verificação.
* Capas e fotografias promocionais. A presença em site oficial não concede direito de redistribuição.
* Logotipos de grupos e empresas. Tratar como marca registrada. Não usar como decoração.

Bloqueado até contrato:

* Letras de músicas, mesmo em trechos.
* Fotografias de agências ou imprensa sem licença de redistribuição.
* Áudio, vídeo e thumbnails de plataformas comerciais.

## Critérios de aceite do redesign

1. O build continua totalmente estático e funciona sob `/kpop-scraping/` no GitHub Pages.
2. PT-BR e inglês oferecem a mesma sessão lógica, dificuldade e pistas equivalentes.
3. Tema claro, escuro, sistema e alto contraste passam nos testes de contraste.
4. O jogador completa a partida só com teclado em 320, 768, 1024 e 1440 px.
5. O timer pode ser desligado, pausado ou ampliado.
6. O feedback usa texto, ícone e cor.
7. Nenhuma mídia aparece sem registro completo de licença e atribuição.
8. O resumo compartilhável não revela resposta.
9. A revisão associa cada resposta aos mesmos `fact_base_ids` e evidências do artefato.
10. O build respeita os orçamentos de JavaScript, CSS e fontes.
11. Lighthouse ou medição equivalente registra LCP, INP e CLS dentro das metas em uma execução móvel controlada.
12. A página carrega sem erro, aviso de console, overflow horizontal ou pedido de fonte a terceiros.

## Sequência recomendada

Implementar PR A e PR B em paralelo somente se cada branch partir do mesmo `master` e não alterar os mesmos schemas publicados. Na prática, PR B pode avançar com CSS e fontes enquanto PR A altera dados. PR C depende das duas. PR D depende de PR C. PR E pode começar após PR D. PR F depende da aprovação da política de mídia.

As próximas mecânicas seguem esta ordem após o redesign: grade de interseções, palavras conectadas, caça-palavras e nome por tentativas. Mapas dependem de coordenadas e alternativa completa para teclado. Letras permanecem fora do pipeline até existir fornecedor licenciado.
