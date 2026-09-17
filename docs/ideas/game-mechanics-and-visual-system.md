# Mecânicas de jogo e sistema visual do K-pop Quiz

Status: proposta de produto para discussão. Este arquivo não autoriza coleta de imagens, letras nem alterações no frontend.

Data da pesquisa: 14 de setembro de 2026.

## Problema

Como criar partidas curtas de K-pop que atendam tanto quem reconhece poucos grupos quanto fãs que conhecem discografias e mudanças de formação, sem esconder a origem dos fatos nem exigir servidor no primeiro lançamento?

O público é amplo. A interface precisa acolher quem chegou por uma música viral e também oferecer desafio a quem acompanha gerações, integrantes e lançamentos. PT-BR e inglês têm o mesmo conteúdo lógico. O primeiro lançamento mantém respostas de múltipla escolha e roda como site estático.

## Direção recomendada

O produto deve começar como uma coleção de partidas curtas, com cinco a dez perguntas, organizadas por tema e nível de pistas. A identidade visual permanece estável entre partidas. Cada tema pode trocar uma cor de destaque e imagens editoriais licenciadas, sem imitar a identidade de um grupo.

A principal diferença do projeto é a combinação entre jogo casual e fatos auditáveis. A tela de resposta revela a justificativa e a fonte sem interromper o ritmo da partida. O jogador pode abrir detalhes técnicos quando quiser.

As referências sugerem quatro padrões que cabem no projeto:

1. Uma regra compreensível antes da primeira interação.
2. Uma rodada curta com progresso sempre visível.
3. Feedback imediato por resposta, expresso por texto, ícone e cor.
4. Resultado compacto que possa ser compartilhado sem expor respostas.
5. Pistas graduais que custam pontos ou reduzem a pontuação máxima.

O redesign e o modelo de dificuldade podem começar antes das novas mecânicas. GeoGrid, caça-palavras, mapas e letras dependem de contratos de dados próprios.

## O que extrair das referências

### GeoGrid

[GeoGrid](https://www.geogridgame.com/) pede um país que satisfaça simultaneamente o critério de uma linha e o de uma coluna. A ideia transferível é a interseção de duas categorias, não a grade geográfica em si.

Aplicação possível: preencher uma célula com um grupo que estreou na década indicada e pertenceu à empresa indicada. Outra combinação seria integrante e país de nascimento. Cada célula precisa aceitar todas as respostas válidas conhecidas pela base. A raridade pode virar bônus somente se o conjunto de respostas estiver completo o bastante para não punir uma resposta correta ausente.

### Wordle

[Wordle](https://www.nytimes.com/games/wordle/index.html) usa uma ação repetida, limite claro de tentativas e retorno posicional após cada palpite. Para K-pop, esse padrão combina com nomes de grupos, integrantes, músicas ou álbuns em campo aberto. Essa mecânica fica fora do primeiro lançamento porque exige normalização forte de aliases, espaços, pontuação, romanização e variantes por idioma.

O padrão útil agora é o resumo compartilhável por blocos, sem revelar as respostas. O projeto deve oferecer um modo de alto contraste e nunca depender apenas das cores dos blocos.

### WhenTaken

[WhenTaken](https://whentaken.com/) combina uma fotografia, um palpite de lugar no mapa e um ano. O jogo reduz pontos conforme a distância espacial e temporal. A adaptação mais direta é "quando foi este comeback?", com foto promocional ou capa licenciada e uma faixa de anos. Outra versão pede a cidade de nascimento, local de show ou origem do grupo em um mapa.

Essa mecânica depende de imagem com licença registrada, data precisa e regras para eventos que têm anúncio, pré-lançamento e lançamento em dias diferentes. O primeiro protótipo deve usar somente data de lançamento definida no contrato editorial.

### NYT Games e Strands

[Strands](https://www.nytimes.com/games/strands) transforma um caça-palavras em descoberta de tema. As palavras podem mudar de direção, todas as letras pertencem a uma resposta e uma expressão central resume a categoria. O artigo oficial [Putting a New Twist on a Classic Puzzle](https://www.nytimes.com/2024/03/04/crosswords/strands-word-search-game.html) descreve a origem do formato.

Uma adaptação de K-pop poderia esconder integrantes de um grupo, músicas de um álbum ou artistas de uma empresa. O nome do grupo, álbum ou empresa funcionaria como tema central. A geração automática precisa provar que a grade tem solução única e que todo texto respeita a grafia exibida no idioma escolhido. Esse trabalho deve vir depois da múltipla escolha.

A coleção [NYT Games](https://www.nytimes.com/crosswords) também mostra o valor de uma página inicial simples, jogos com regras próprias e cadência diária. O projeto deve adotar a coleção e a duração curta. Não deve copiar a grade, as cores, a tipografia ou a linguagem visual do NYT.

## Matriz de mecânicas

| Mecânica | Experiência | Dados necessários | Estado dos dados | Compatível com site estático | Prioridade |
| --- | --- | --- | --- | --- | --- |
| Múltipla escolha temática | 5 a 10 perguntas com retorno imediato | grupos, integrantes, formação, empresa, nascimento e cronologia | disponível | sim | agora |
| Partida diária | uma sessão fixa por data e idioma | banco atual e semente derivada da data | disponível | sim, com arquivos pré-gerados | agora |
| Grade de interseções | resposta que satisfaz linha e coluna | categorias completas, aliases e conjunto de respostas válidas | parcial | sim | depois de ampliar cobertura |
| "Quando foi?" | escolher ano ou ordenar eventos | datas de estreia e lançamento | parcial, lançamentos em coleta | sim | após evidência de lançamentos |
| Foto da pessoa ou grupo | identificar sujeito por imagem | imagem licenciada, atribuição, recorte e identidade confirmada | ausente | sim | após política de mídia |
| Lugar no mapa | apontar origem, nascimento ou show | coordenadas e regra editorial do lugar | ausente | sim, com mapa vetorial local | fase posterior |
| Palavras conectadas | agrupar 16 itens por quatro relações | categorias densas e exclusivas | parcial | sim | fase posterior |
| Caça-palavras temático | encontrar nomes ligados por tema | nomes curtos, grade solucionável e aliases | parcial | sim | fase posterior |
| Nome por tentativas | descobrir grupo, pessoa, música ou álbum | aliases, normalização e retorno por caractere | parcial | sim | depois do campo aberto |
| Trecho de letra | descobrir música ou artista | texto e direito de exibição contratado | bloqueado por licença | sim tecnicamente | não iniciar sem fornecedor |

## Modelo de dificuldade por pistas

Dificuldade deve ser uma propriedade reproduzível da pergunta. O mesmo fato pode gerar versões com níveis diferentes. A pontuação registra quais pistas foram exibidas.

### Nível assistido

O enunciado mostra o nome do grupo quando pergunta sobre uma pessoa. Também pode mostrar geração ou período, empresa e uma imagem licenciada. As alternativas devem pertencer à mesma classe de entidade, com dois distratores mais distantes e um plausível. Timer opcional, desligado por padrão.

Exemplo: "Qual integrante do TWICE nasceu em 29 de dezembro de 1996?" A tela mostra "TWICE", "3ª geração" e uma foto licenciada quando disponível.

### Nível padrão

O enunciado fornece uma pista contextual estável, como geração, década ou empresa, sem entregar o grupo em perguntas sobre pessoas. As quatro alternativas usam distratores plausíveis. Timer visível e ajustável.

Exemplo: "Qual destas integrantes de um grupo da 3ª geração nasceu em 29 de dezembro de 1996?"

### Nível especialista

O enunciado omite grupo, geração, período, empresa e imagem. Os distratores vêm do mesmo intervalo temporal ou da mesma empresa sempre que os dados permitirem. A pergunta continua solucionável pelo fato apresentado. O modo pode usar timer curto, desde que o jogador possa pausar, desligar ou ampliar o tempo conforme WCAG 2.2.

Exemplo: "Quem nasceu em 29 de dezembro de 1996?"

### Contrato sugerido

Cada pergunta deve declarar:

```json
{
  "difficulty": "assisted | standard | expert",
  "clues_available": ["group_name", "generation", "period", "licensed_image"],
  "clues_shown": ["group_name", "generation"],
  "base_points": 100,
  "hint_cost": 15,
  "timer_seconds": null
}
```

`generation` exige uma definição editorial versionada. O termo varia entre fontes e fãs. Até essa regra existir, use década ou intervalo de estreia. A imagem não pode ser a única forma de identificar uma pessoa. O texto alternativo deve preservar a função da imagem sem revelar a resposta durante o palpite.

O jogador escolhe o nível antes da partida. Pistas adicionais durante a rodada custam pontos. O nível não deve alterar qual alternativa é correta, nem esconder a justificativa após a resposta.

## Sistema visual proposto

### Princípio

K-pop troca conceito visual a cada lançamento. Um produto que adote todas essas identidades ao mesmo tempo vira uma colagem difícil de ler. A solução é uma base editorial escura e clara, com cores saturadas em áreas pequenas. Capas, fotos e uma cor temática dão personalidade a cada quiz.

As páginas oficiais da [JYP Entertainment](https://m.jype.com/), [HYBE](https://hybecorp.com/eng/company/artist), [SMTOWN](https://www.smtown.com/) e [Weverse Magazine](https://magazine.weverse.io/?lang=en) usam fotografia em destaque, títulos grandes, muito espaço livre e listas editoriais densas. Weverse também separa conteúdo por categorias e mantém a imagem como parte da narrativa. O projeto pode usar essas relações sem reproduzir marcas, páginas de artistas ou composições específicas.

### Linguagem visual

* Formas: cartões com raio de 8 px, opções com raio de 6 px e chips em formato cápsula somente para filtros e estado.
* Composição: uma coluna de jogo com largura máxima de 52 rem. A imagem, quando houver, ocupa 16:9 ou 4:5 e nunca fica atrás do texto.
* Tipografia: sans-serif variável para interface e uma display sans de peso alto para títulos. Até avaliar fontes e licenças, usar a pilha do sistema. Não usar uma fonte diferente por grupo.
* Movimento: transições de 120 a 180 ms para seleção e troca de pergunta. Respeitar `prefers-reduced-motion`. Não usar flashes, confete contínuo nem movimento de fundo.
* Cor: cada partida escolhe um único `theme-accent`. As cores de acerto, erro, foco e texto não mudam com o tema.
* Densidade: enunciado, pistas e alternativas cabem acima da primeira rolagem em telas de 768 px de altura quando não houver imagem. Em 320 px, a rolagem vertical é permitida e não há rolagem horizontal.

### Tokens claros

| Token | Valor | Uso | Contraste testado |
| --- | --- | --- | --- |
| `canvas` | `#FFF8F0` | fundo geral | `text` 16,07:1 |
| `surface` | `#FFFFFF` | cartão de jogo | `text` 17,15:1 |
| `text` | `#24182B` | texto principal | 16,07:1 sobre `canvas` |
| `text-muted` | `#66566D` | texto secundário | 6,40:1 sobre `canvas` |
| `border` | `#C9BFD0` | divisores e bordas passivas | não usar como único limite de controle |
| `brand` | `#C2185B` | ação principal | 5,87:1 com branco |
| `accent-violet` | `#6A3FC5` | variação temática | 6,71:1 com branco |
| `accent-cyan` | `#007C83` | variação temática | 4,99:1 com branco |
| `accent-yellow` | `#F5C542` | destaque visual | 10,44:1 com `text` |
| `success` | `#147A48` | acerto | 5,37:1 com branco |
| `error` | `#B42318` | erro | 6,57:1 com branco |
| `focus` | `#006BD6` | anel de foco | validar 3:1 nos fundos adjacentes |

### Tokens escuros

| Token | Valor | Uso | Contraste testado |
| --- | --- | --- | --- |
| `canvas` | `#17121C` | fundo geral | `text` 17,50:1 |
| `surface` | `#231A2B` | cartão de jogo | testar pares no componente |
| `text` | `#FFF7FB` | texto principal | 17,50:1 sobre `canvas` |
| `text-muted` | `#CFC3D5` | texto secundário | 10,90:1 sobre `canvas` |
| `border` | `#665B70` | divisores e bordas passivas | não usar como único limite de controle |
| `brand` | `#FF6FAE` | ação principal | 7,14:1 com `canvas` |
| `accent-violet` | `#BCA2FF` | variação temática | 8,56:1 com `canvas` |
| `accent-cyan` | `#56D6D3` | variação temática | 10,49:1 com `canvas` |
| `accent-yellow` | `#FFD95A` | destaque visual | 13,45:1 com `canvas` |
| `success` | `#58D68D` | acerto | 10,02:1 com `canvas` |
| `error` | `#FF8A80` | erro | 8,07:1 com `canvas` |
| `focus` | `#7CC4FF` | anel de foco | validar 3:1 nos fundos adjacentes |

Os valores são candidatos, não tokens aprovados para implementação. O cálculo segue a fórmula de luminância da [WCAG 2.2](https://www.w3.org/TR/WCAG22/). Texto normal precisa de 4,5:1. Texto grande e limites visuais de controles precisam de 3:1. Toda combinação real deve passar por teste automatizado e inspeção nos estados de hover, foco, desabilitado, acerto e erro.

## Componentes e estados

### Página de coleção

* `GameTile` apresenta título, descrição curta, duração, dados disponíveis e nível.
* `DailyGame` destaca a partida do dia sem bloquear o arquivo de partidas anteriores.
* `LanguageSwitch` preserva o jogo e reinicia a sessão somente com confirmação quando houver progresso.
* `ThemeFilter` filtra integrantes, grupos, datas e discografia. O filtro aparece na URL.

Estados obrigatórios: carregando, vazio, erro de manifesto, versão incompatível, offline com arquivo já armazenado e atualização disponível.

### Preparação da partida

* `DifficultyPicker` explica as pistas concretas de cada nível.
* `GameRules` mostra uma regra e um exemplo curto.
* `TimerControl` permite desligar ou ajustar o timer.
* `StartButton` inicia a sessão e move o foco para o enunciado.

### Rodada

* `ProgressHeader` mostra pergunta atual, total, pontos e tempo.
* `QuestionPrompt` contém o enunciado e metadados que não entregam a resposta.
* `LicensedMedia` exibe imagem, crédito, licença e link da fonte. Sem esses campos, o componente não renderiza o arquivo.
* `HintTray` lista pistas disponíveis, custo e pistas já usadas.
* `AnswerList` usa botões nativos. Teclas 1 a 4 podem selecionar opções quando não conflitam com tecnologia assistiva.
* `AnswerFeedback` anuncia acerto ou erro em uma região `aria-live="polite"`, move o foco somente após ação explícita e oferece justificativa.
* `EvidenceDisclosure` mostra fonte legível primeiro e detalhes de revisão sob expansão.

Estados obrigatórios: pronta, respondida correta, respondida incorreta, tempo encerrado, pista revelada, mídia indisponível e erro de integridade. Cor sempre acompanha texto e ícone.

### Resultado

* `ScoreSummary` separa acertos, pontos, tempo e pistas usadas.
* `ShareResult` gera uma grade textual sem respostas, adaptada ao idioma.
* `ReviewAnswers` permite rever pergunta, resposta e evidência.
* `PlayAgain` cria uma semente nova quando o conjunto permite.

### Preferências

Tema claro, escuro ou do sistema. Alto contraste independente do tema. Movimento reduzido acompanha o sistema e pode ser forçado. Timer permanece opcional. Preferências ficam no navegador e não exigem conta.

## Requisitos de acessibilidade

Adotar WCAG 2.2 AA como critério de aceite:

* texto normal com contraste mínimo de 4,5:1;
* componentes e indicadores de foco com 3:1 nos fundos adjacentes;
* alvos de toque com pelo menos 24 por 24 CSS px, com preferência por 44 px nos botões de resposta;
* zoom de 200% e reflow a 320 CSS px sem perda de função;
* ordem de foco igual à ordem visual;
* alternativa a arrastar em mapas, caça-palavras e grades;
* timer ajustável, pausável ou desativável;
* nome, licença e atribuição disponíveis para toda mídia;
* `lang` correto em cada rota e marcação de trechos em outro idioma;
* sem feedback comunicado apenas por cor, som ou animação.

Imagens usadas como pista têm uma tensão de acessibilidade. Um `alt` que nomeia a pessoa entrega a resposta. Nesse estado, usar uma descrição neutra, por exemplo "foto usada como pista desta pergunta", e oferecer uma versão equivalente da pergunta sem depender da imagem. Após a resposta, o componente pode revelar o nome e a descrição completa.

## Roadmap

### Fase A, contrato de dificuldade

Definir `clues_available`, `clues_shown`, custo de pista e critérios de distrator. Gerar as três versões a partir do mesmo fato. Medir taxa de conclusão e acerto por template. Esta fase usa os dados atuais e não requer redesign completo.

### Fase B, redesign da partida atual

Implementar tokens, temas claro e escuro, seletor de dificuldade, estados de pista e resultado compartilhável. Validar teclado, leitor de tela, zoom e larguras de 320, 768, 1024 e 1440 px. Manter Astro, Preact e publicação estática.

### Fase C, página de coleção e partida diária

Separar jogos por tema e duração. Publicar um manifesto diário pré-gerado no build. Manter arquivo local de sessões anteriores enquanto o tamanho total permanecer aceitável.

### Fase D, discografia e tempo

Após aceitar evidências de lançamentos, criar ordenação cronológica e "quando foi?" sem imagens. Acrescentar capas somente depois da política de licença e atribuição.

### Fase E, imagens e mapas

Criar registro de mídia com autor, licença, URL da licença, fonte, sujeito, data de verificação e transformações. Prototipar identificação por foto e mapa com alternativa para teclado. Não baixar nem publicar uma imagem cuja licença não permita o uso definido.

### Fase F, novas famílias de jogo

Escolher uma mecânica por vez. A ordem sugerida é grade de interseções, palavras conectadas, caça-palavras e nome por tentativas. Cada gerador precisa validar soluções, aliases e equivalência entre PT-BR e inglês.

### Fase G, letras

Escolher um fornecedor que licencie exibição no território e no formato do produto. Registrar limites de armazenamento, cache, tamanho do trecho e atribuição. Sem contrato, não coletar, persistir nem publicar letras.

## O que não fazer

* Não criar uma paleta por grupo. Isso multiplica testes de contraste e aproxima o produto das marcas dos artistas.
* Não copiar grade, tipografia, ícones, microtexto ou animações das referências.
* Não lançar cinco mecânicas ao mesmo tempo. Cada uma exige um contrato de dados e testes próprios.
* Não chamar uma pergunta de "difícil" apenas por usar distratores obscuros. O nível decorre das pistas e da proximidade semântica das opções.
* Não usar geração de K-pop como fato antes de definir a classificação editorial.
* Não buscar imagens em mecanismos de pesquisa e republicá-las. A pesquisa visual serve apenas para direção de design.
* Não usar retratos, capas ou logos sem licença e atribuição verificadas.
* Não coletar letras antes de contratar um fornecedor licenciado.
* Não tornar o timer obrigatório.
* Não esconder proveniência para simplificar a tela. O primeiro nível da fonte pode ser curto e os detalhes continuam disponíveis.
* Não transformar o site estático em aplicação com conta, ranking global ou comentários nesta etapa.

## Pré-mortem

Imagine o produto um ano depois do redesign, com pouco uso recorrente.

| Falha provável | Sinal precoce | Prevenção ou resposta |
| --- | --- | --- |
| O visual parece uma colagem de fandoms | usuários não reconhecem a marca do produto; contraste varia por quiz | manter base fixa e limitar cada quiz a uma cor temática |
| O nível especialista vira adivinhação | acerto abaixo de 15% e abandono alto nas duas primeiras perguntas | revisar contexto mínimo e distratores; remover perguntas insolúveis |
| O nível assistido entrega a resposta | acerto acima de 95% com tempo mediano inferior a 2 s | reduzir uma pista ou aproximar distratores |
| A promessa de muitos jogos fragmenta o trabalho | vários protótipos sem cobertura ou testes | concluir uma família e medir uso antes de iniciar a seguinte |
| Imagens criam risco jurídico | mídia sem autor, licença ou URL de atribuição no build | falhar a publicação quando qualquer campo do registro estiver ausente |
| PT-BR e inglês divergem | contagem ou resposta correta diferente entre idiomas | manter um ID semântico e validar paridade no build |
| Partida diária fica repetitiva | retorno em sete dias abaixo de 10% e perguntas repetidas na mesma semana | controlar repetição por ID semântico e ampliar dados antes de aumentar frequência |
| Timer exclui parte do público | abandono maior com timer e reclamações de acessibilidade | oferecer modo sem timer e persistir a preferência |
| Página cresce demais para rede móvel | build de dados e mídia excede o orçamento definido | separar manifestos por jogo, comprimir mídia e carregar apenas a sessão escolhida |

## Hipóteses mensuráveis

1. Pelo menos 65% das pessoas que iniciam uma partida de cinco perguntas chegam ao resultado. Medir `game_started` e `game_completed` sem dados pessoais.
2. O nível assistido mantém acerto entre 55% e 85%. O padrão fica entre 35% e 70%. O especialista fica entre 20% e 55%. Valores fora dessas faixas acionam revisão editorial.
3. Pelo menos 20% das pessoas que concluem uma partida iniciam outra na mesma visita. Medir o clique em `PlayAgain` ou em outro jogo.
4. Menos de 5% das partidas usam uma pista por engano e voltam imediatamente. O evento deve registrar abertura e fechamento, sem conteúdo da resposta.
5. A troca visual aumenta a conclusão sem elevar erros de acessibilidade. Comparar a versão atual e a nova com a mesma sessão de perguntas.
6. A partida diária traz retorno de sete dias acima de 10% entre navegadores que consentirem com armazenamento local.
7. O resumo compartilhável recebe uso em pelo menos 3% das partidas concluídas. Um número menor indica que a função não merece prioridade.

Estas métricas devem funcionar sem conta. Contagens agregadas precisam de uma decisão de privacidade e de hospedagem antes da instrumentação. O MVP estático pode começar com teste moderado e registro manual, sem analytics.

## Suposições que precisam de validação

### Precisam ser verdade

* Os fatos atuais geram perguntas suficientes para que uma sessão curta não repita a mesma relação.
* Pessoas entendem os níveis quando a interface descreve as pistas, sem depender dos rótulos.
* O custo editorial de PT-BR e inglês cabe no ritmo de publicação.

### Afetam bastante o produto

* Partida diária gera retorno maior que catálogo livre.
* Evidência após a resposta aumenta confiança sem atrasar a rodada.
* Uma identidade fixa com um destaque temático parece relacionada a K-pop sem copiar grupos.

### Podem esperar

* Jogadores querem compartilhar resultados.
* Grade de interseções atrai mais retorno que caça-palavras.
* Fotos elevam conclusão no nível assistido.

## Testes antes de ampliar o escopo

1. Protótipo clicável das três dificuldades com o mesmo conjunto de cinco fatos.
2. Cinco sessões moderadas em PT-BR e cinco em inglês, incluindo pessoas com pouco e muito conhecimento de K-pop.
3. Teste de reconhecimento da dificuldade. A pessoa deve explicar quais pistas mudam entre níveis.
4. Teste de contraste automatizado e manual nos temas claro e escuro.
5. Auditoria com teclado, leitor de tela e movimento reduzido.
6. Teste editorial de nomes romanizados e datas localizadas.

## Fontes consultadas

* [GeoGrid, FAQ e regras](https://www.geogridgame.com/)
* [Wordle](https://www.nytimes.com/games/wordle/index.html)
* [WhenTaken, regras e pontuação](https://whentaken.com/)
* [Strands](https://www.nytimes.com/games/strands)
* [Putting a New Twist on a Classic Puzzle](https://www.nytimes.com/2024/03/04/crosswords/strands-word-search-game.html)
* [NYT Games](https://www.nytimes.com/crosswords)
* [Weverse Magazine](https://magazine.weverse.io/?lang=en)
* [JYP Entertainment](https://m.jype.com/)
* [HYBE, artistas](https://hybecorp.com/eng/company/artist)
* [SMTOWN](https://www.smtown.com/)
* [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
* [W3C, contraste mínimo](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum)

## Questões abertas sem bloqueio imediato

* A partida diária deve ter cinco ou dez perguntas?
* O jogador escolhe tema e dificuldade em telas separadas ou na mesma tela?
* O nome público do produto continua "K-pop Quiz" ou ganha uma marca própria?
* O resultado compartilhável mostra pontos absolutos ou somente acertos e pistas?
* Analytics agregados são aceitáveis no primeiro teste público?
