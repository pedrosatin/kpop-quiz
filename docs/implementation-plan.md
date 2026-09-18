# Plano de implementação

## Processo de execução

Cada fatia passa pelo mesmo ciclo:

1. um agente implementa código, testes e documentação;
2. outro agente revisa correção, legibilidade, arquitetura, segurança e desempenho;
3. o revisor aplica `unslop-br` à documentação em português;
4. os testes unitários, a compilação e o smoke test precisam passar;
5. a fatia seguinte começa somente após a correção dos achados obrigatórios.

Nenhuma fatia autoriza commit, push, deploy ou inclusão de dados sem licença compatível.

## Fatia 1

Estado: aprovada na revisão de 12 de setembro de 2026.

Objetivo: preservar a resposta usada como evidência e controlar mudanças no schema.

Entregas:

- migrações SQLite versionadas e transacionais;
- snapshots JSON comprimidos por provedor, idioma, `pageid` e `revid`;
- hash SHA-256 calculado sobre uma serialização canônica;
- tabela de revisões com caminho, hash e data da coleta;
- reaproveitamento do snapshot quando revisão e conteúdo não mudarem;
- configuração explícita do diretório de dados brutos;
- testes de migração, idempotência, integridade do hash e falha de gravação.

Aceite: duas coletas da mesma revisão produzem um snapshot e duas execuções concluídas. O banco aponta para um arquivo cujo hash confere com o conteúdo descomprimido.

## Fatia 2

Estado: aprovada na revisão de 12 de setembro de 2026.

Objetivo: transformar páginas da categoria em um catálogo validado de grupos.

Entregas:

- Wikidata QID e metadados de redirecionamento;
- estados `candidate`, `accepted` e `rejected`;
- regras determinísticas para rejeitar listas, desambiguações e páginas sem QID compatível;
- motivo de cada rejeição ligado à revisão analisada;
- relatório CSV de cobertura e rejeições;
- amostra versionada para testes de classificação.

Aceite: páginas de lista não aparecem como grupos aceitos. Repetir a classificação não duplica entidades ou rejeições.

## Fatia 3

Estado: aprovada na revisão de 13 de setembro de 2026.

Objetivo: criar o primeiro conjunto de entidades e fatos estruturados.

Entregas:

- adaptador Wikidata com lotes, timeout, `User-Agent`, `maxlag` e repetição limitada;
- entidades de grupo, pessoa, organização e lugar;
- aliases em português, inglês, coreano e romanização quando disponíveis;
- formação, origem, gravadora, gênero e integrantes do grupo;
- nascimento, local de nascimento, cidadania, idioma, instrumento e vínculo da pessoa;
- precisão temporal, qualificadores, referências e rank do Wikidata;
- evidência da Wikipedia para fatos que não tenham referência suficiente no Wikidata;
- relatório de cobertura em 30 grupos.

Aceite: cada fato aceito aponta para uma revisão ou referência. Conflitos permanecem registrados e não geram perguntas.

Entrega concluída em 13 de setembro de 2026: migração 4, extrator `wikidata-facts-v2`, opções `--facts`, `--facts-limit` e `--facts-report` e [ADR 004](decisions/004-wikidata-facts-and-evidence.md). A revisão adicionou validação bilateral de integrantes, política versionada de fontes e uma fixture editorial de evidência. Duas execuções com 30 grupos mantiveram 197 entidades e 763 fatos. Cada execução teve 100 fatos aceitos, 565 rejeitados, 95 em conflito e 3 substituídos.

## Fatia 4

Estado: aprovada na revisão de 13 de setembro de 2026.

Objetivo: publicar perguntas bilíngues de múltipla escolha em JSON estático.

Entregas:

- templates versionados em português e inglês;
- quatro alternativas distintas e do mesmo tipo;
- sessões determinísticas de dez perguntas;
- filtros por idioma, tema, grupo e dificuldade;
- timer opcional registrado na configuração da sessão;
- explicação, data de referência e link de evidência;
- nove tipos iniciais de pergunta;
- exportação JSON validada por schema.

Aceite: uma amostra de 30 grupos gera ao menos 100 perguntas aceitas. A mesma versão dos dados, template e semente reproduz a sessão byte a byte.

Entrega inicial implementada em 12 de setembro de 2026. A revisão final de 13 de setembro atualizou o gerador para `quiz-generator-v3`. Os templates usam `quiz-templates-v2` e o relatório usa `kpop-quiz-generation-report-v2`. A CLI continua disponível em `python -m kpop_scraping.quiz_cli`. A decisão está na [ADR 005](decisions/005-static-quiz-datasets.md).

A revisão encontrou 257 comparações cronológicas derivadas de 19 fatos temporais. As combinações repetiam a mesma resposta com outros conjuntos de alternativas. O gerador agora publica uma comparação por fato usado como resposta e registra `semantic_id` e `fact_base_ids`.

A correção adicionou perguntas de grupo para integrante e perguntas nas duas direções entre grupo e gravadora. Os distratores excluem outras respostas aceitas para o mesmo enunciado. A direção gravadora para grupo exige que a gravadora tenha um único grupo aceito na amostra. A direção grupo para gravadora exige que o grupo tenha uma única gravadora aceita. O relatório separa perguntas lógicas, variantes de idioma, IDs factuais, templates e predicados.

A revisão final incluiu os quatro fatos comparados em `fact_base_ids` e retirou dos distratores outros grupos aceitos para a mesma pessoa. A amostra real de 30 grupos produz 107 perguntas lógicas sobre 84 fatos-base e 214 variantes de idioma. O tipo `member_at_date` permanece sem perguntas porque os 25 vínculos bilaterais aceitos não têm intervalo fechado com validade comprovada.

## Fatia 5

Estado: aprovada na revisão de 13 de setembro de 2026.

Objetivo: separar o gerador de perguntas em módulos menores sem alterar os artefatos.

Entrega: `quiz_generator.py` passou de 998 para 96 linhas. Os JSONs permaneceram idênticos e os testes cobrem a divisão entre repositório, rascunhos, renderização e sessão.

## Fatia 6

Estado: aprovada na revisão de 13 de setembro de 2026.

Objetivo: entregar a primeira interface estática bilíngue.

Entrega: Astro, Preact e TypeScript geram `/pt-br/` e `/en/` sob a base `/kpop-scraping`. O quiz tem dez perguntas, cronômetro, pontuação, fontes, foco após mudanças de estado e layout responsivo. O workflow do GitHub Pages prepara o build sem executar deploy local. A decisão está na [ADR 006](decisions/006-static-astro-web-app.md).

## Fatia 7

Estado: aprovada na revisão de 13 de setembro de 2026.

Objetivo: ligar os artefatos do pipeline Python ao frontend estático.

Entregas:

- comando de publicação a partir do SQLite ou de duas sessões exportadas;
- sessões PT-BR e inglês derivadas da mesma versão do dataset;
- manifesto com versão, IDs e hashes dos arquivos;
- validação Python antes da escrita e no workflow;
- carregador web por `fetch` com suporte ao `BASE_URL`;
- estados distintos para arquivo ausente e inválido;
- remoção da amostra editorial do bundle de produção.

Aceite: `--verify` detecta ausência, adulteração e troca de sessão. O build inclui os três JSONs em `dist/data`, e as duas rotas carregam sessões válidas sob `/kpop-scraping/`. A revisão acrescentou testes para escrita atômica por arquivo, travessia de diretório, identidade de idioma, dataset e sessão. O cronômetro agora cancela seu agendamento no envio da resposta. A interface apresenta domínio e revisão da fonte, sem expor o localizador interno da afirmação. A decisão está na [ADR 007](decisions/007-publicacao-de-sessoes-web.md).

## Fatia 8

Estado: aprovada na revisão de 16 de setembro de 2026 (PR #8).

Objetivo: criar modos de jogo assistido, padrão e especialista, pistas temporais de década ligadas a fatos e evidências auditáveis e manifesto v2.

Entregas:

- campos `challenge_rating` para complexidade factual original e `play_mode` para configuração de partida;
- pistas de década com evidências auditáveis vinculadas a revisões da fonte;
- geração determinística de seis sessões e manifesto v2;
- pontuação com dedução de custo por pista revelada;
- testes unitários e de integração em Python e Vitest.

Aceite: sessões v2 geradas deterministicamente com hash SHA-256 no nome do arquivo. Manifesto v2 validado antes da substituição atômica. Pontuação reflete o custo exato das pistas reveladas.

## Fatia 9

Estado: aprovada na revisão de 16 de setembro de 2026 (PR #9).

Objetivo: estabelecer sistema de design com tokens semânticos, fontes autohospedadas e alternância de temas acessíveis.

Entregas:

- autohospedagem das fontes Space Grotesk e Noto Sans variáveis em WOFF2 sob licença OFL 1.1;
- remoção de requisições externas em tempo de execução;
- tokens semânticos de cor, espaçamento, sombras e raios para temas claro e escuro;
- script de prevenção de FOUC e persistência de preferência com sincronização entre abas;
- suporte a alto contraste sob `forced-colors` e movimento reduzido sob `prefers-reduced-motion`;
- testes automatizados de razão de contraste WCAG 2.2 AA com mínimo de 4.5:1 para texto e 3:1 para controles.

Aceite: zero requisições externas para fontes no navegador. Todas as combinações de cores passam no teste automatizado de contraste WCAG 2.2 AA.

## Fatia 10

Estado: aprovada na revisão de 16 de setembro de 2026 (PR #10).

Objetivo: modularizar o frontend do quiz e implementar tela de preparação e regras.

Entregas:

- divisão de `Quiz.tsx` em componentes modulares sob `web/src/components/`, incluindo `GameSetup`, `DifficultyPicker`, `TimerControl`, `ProgressHeader`, `QuestionCard`, `HintTray` e `AnswerFeedback`;
- limite estrito de 200 linhas de código por componente;
- máquina de estados explícita com os estados `loading`, `setup`, `question.ready`, `question.answered` e `complete`;
- gerenciamento acessível de foco com redirecionamento para o feedback após submissão e para o título da questão ao avançar;
- cancelamento imediato de temporizador ao registrar resposta;
- isolamento de persistência local com tratamento de exceção defensivo.

Aceite: transição estável entre estados da partida. Foco acessível verificado no fluxo de navegação. Temporizador imune a re-renderizações intermediárias.

## Fatia 11

Estado: aprovada na revisão de 16 de setembro de 2026 (PR #11).

Objetivo: apresentar tela de resultados detalhada, exportação de desempenho e auditoria pós-partida.

Entregas:

- componente `ScoreSummary.tsx` com exibição de acertos, pontuação acumulada, tempo total decorrido e pistas usadas;
- componente `ShareResult.tsx` com geração de texto em blocos sem spoilers no formato `■■■■□`, suporte a `navigator.share`, fallback para área de transferência e fallback com área de texto editável;
- componente `ReviewAnswers.tsx` com revisão de respostas, gabarito, justificativa e links de evidência protegidos por `rel="noopener noreferrer"`;
- catálogo bilíngue de mensagens expandido em conformidade com as regras de redação técnica em português brasileiro.

Aceite: texto de compartilhamento não revela nomes de entidades, perguntas ou respostas. Links de revisão permanecem auditáveis e isolados do contexto de execução. Limpeza adequada de temporizadores de feedback confirmada nos testes.

## Fatia 12

Estado: aprovada na revisão de 16 de setembro de 2026 (PR #12).

Objetivo: suportar partida diária determinística e seleção de tema com persistência na URL.

Entregas:

- argumento `--date` no publicador Python para gerar partidas com semente `kpop-daily-{YYYY-MM-DD}`;
- determinismo estrito na geração onde a mesma data e idioma produzem o mesmo identificador de sessão e o mesmo hash SHA-256;
- componente `GameCollection.tsx` para alternância entre temas e partida diária;
- sincronização de parâmetros de busca `?mode=` e `?theme=` sem recarregar a página e com preservação dos parâmetros ao alternar o idioma;
- indicador com data no texto de compartilhamento de partidas diárias.

Aceite: testes de determinismo comprovam igualdade de hash para a mesma data e variação para datas distintas. Links de idioma preservam query strings sem duplicar o caractere `?`.

## Fatia 13

Estado: aprovada na revisão de 17 de setembro de 2026 (PR #13).

Objetivo: integrar suporte a imagens com proveniência factual estrita e validação de licenças compatíveis.

Entregas:

- schema JSON Draft 2020-12 estrito em `schemas/licensed-media-v1.json` com oito campos obrigatórios e enum de doze licenças permitidas para redistribuição comercial ou editorial (CC0, CC BY 2.0 a 4.0, CC BY-SA 2.0 a 4.0, Public Domain e OFL 1.1);
- validação Python em `kpop_scraping/media_registry.py` com rejeição de licenças restritivas não comerciais NC, sem derivações ND ou uso aceitável sem licença explícita fair use;
- componente `LicensedMedia.tsx` com texto alternativo neutro antes da resposta, créditos e links pós-resposta e tratamento de erro no evento `onError` com fallback visual;
- estabilização de Cumulative Layout Shift por meio de `min-height` e `aspect-ratio` na classe `.media-figure`;
- testes unitários e de integração completos em Python e Vitest.

Aceite: nenhuma mídia entra no sistema sem os oito campos obrigatórios ou com licença fora da enumeração permitida. Fallback visual opera quando a imagem falha ou o campo de mídia é nulo. O processo de build falha diante de qualquer violação de schema.

## Fatia 14

Estado: aprovada na revisão de 17 de setembro de 2026 (PR #16).

Objetivo: formalizar a especificação técnica e a modelagem de contratos da Grade de Interseções como nova família de jogos determinística e compatível com publicação estática.

Entregas:

- ADR 008 em `docs/decisions/008-grade-de-intersecoes.md` com definição formal da mecânica de grade 3x3, eixos ortogonais independentes, critérios (`formed_on`, `record_label`, `has_member`), coordenadas de células, respostas válidas baseadas exclusivamente em fatos auditados do SQLite, limites de palpites (9 a 12 tentativas ou até 3 erros), regra de unicidade por partida, resumo compartilhável sem spoilers com suporte a alto contraste e compatibilidade integral com publicação estática;
- schema formal JSON Draft 2020-12 estrito em `schemas/intersection-grid-v1.json` com `additionalProperties: false` em todos os nós, com os campos `schema_version`, `grid_id`, `dataset_version`, `reference_date`, `dimensions`, `row_criteria`, `col_criteria`, `cells` e `candidate_pool`;
- módulo de validação e escrita atômica em `kpop_scraping/grid_schema.py` com validação de tipos, integridade de coordenadas e não vacuidade de respostas válidas;
- suite de testes unitários em `tests/test_grid_schema.py` com validação de fixture completo contra o schema oficial e testes negativos para células sem respostas válidas, campos ausentes, tipos incorretos e violações estruturais.

Aceite: fixture completo validado com sucesso contra `schemas/intersection-grid-v1.json` e pelo validador do domínio. Células sem respostas válidas e estruturas com campos ausentes ou tipos inválidos falham imediatamente na validação. Documentação técnica aprovada e livre de vícios de redação.

## Fatia 15

Estado: aprovada na revisão de 17 de setembro de 2026 (PR #17).

Objetivo: implementar o gerador determinístico em Python e a CLI da Grade de Interseções a partir de fatos auditados em SQLite.

Entregas:

- carregamento de entidades, fatos e evidências de banco SQLite via `_load_entities`, `_load_facts`, `_load_evidence` e `_dataset_version` de `quiz_repository.py`;
- definição de critérios ortogonais nas categorias `formed_on` (décadas de 1990 a 2020), `record_label` (gravadoras conhecidas e dinâmicas) e `has_member` (contagens exatas e faixas comparativas);
- avaliação determinística de critérios e evidências para cada grupo aceito no catálogo;
- cálculo de interseção de entidades válidas e consolidação de evidências auditadas por coordenada `(row_index, col_index)`;
- algoritmo de seleção determinística de grade 3x3 orientado por semente (`seed`) com garantia de solubilidade (nenhuma célula vazia) e unicidade via teste de emparelhamento bipartido para as 9 células;
- cálculo de `grid_id` canônico via SHA-256 sobre o payload estruturado;
- CLI em `kpop_scraping/grid_cli.py` com suporte aos parâmetros `--database`, `--output`, `--seed` e `--date` com escrita atômica via `write_intersection_grid_atomic`;
- suíte de testes unitários em `tests/test_grid_generator.py` cobrindo avaliação de critérios, determinismo estrito, solubilidade, unicidade de atribuição, validação de schema e comportamento da CLI.

Aceite: grades geradas com a mesma semente e dados produzem exatamente os mesmos bytes e o mesmo `grid_id`. Todas as 9 células possuem ao menos uma resposta válida e existe solução completa sem repetição de grupos. O arquivo gerado cumpre integralmente `schemas/intersection-grid-v1.json` e é validado por `validate_intersection_grid`.

## Fatia 16

Estado: em andamento na branch `feat/intersection-grid-ui` (17 de setembro de 2026).

Objetivo: implementar a interface web acessível da Grade de Interseções com componentes modulares, validação de palpites no cliente, regra de unicidade e compartilhamento de resultado.

Entregas:

- tipagem estrita e validação em tempo de execução em `web/src/lib/quiz-types.ts` (`IntersectionGrid`, `GridCriterion`, `GridCellData`, `CandidateEntity`, `GridEvidence` e validador `isIntersectionGrid`);
- carregador de dados estáticos em `web/src/data/grid-loader.ts` com tratamento de erro tipado em `GridArtifactError`;
- componentes modulares sob `web/src/components/Grid/` estritamente abaixo de 200 linhas cada: `IntersectionGrid.tsx`, `GridBoard.tsx`, `GridCell.tsx`, `EntityPicker.tsx`, `GridResults.tsx`, `GridReview.tsx`, `types.ts` e hook de máquina de estados `useGridGame.ts`;
- regras de partida: matriz 3x3, limite de 9 palpites, regra estrita de unicidade que impede o reuso de grupo musical na mesma partida, anúncio de erros e acertos com foco acessível;
- seletor assistido `EntityPicker` com busca em tempo real imune a maiúsculas e acentos, suporte a navegação por teclado e indicação de grupos já utilizados;
- tela de conclusão `GridResults` com pontuação, matriz de compartilhamento sem spoilers em emoji ou blocos monocromáticos para alto contraste, cópia para área de transferência com feedback acessível e painel de revisão factual `GridReview` com links para fontes protegidos por `rel="noopener noreferrer"`;
- páginas e rotas `/pt-br/grid/` e `/en/grid/` integradas ao `BaseLayout.astro` e link acessível em `GameCollection.tsx`;
- internacionalização completa em `web/src/i18n/catalog.ts` em conformidade com as regras de redação técnica;
- estilos responsivos em `web/src/styles/global.css` cobrindo resoluções de 320px até telas largas, temas claro e escuro e alto contraste;
- suíte de testes unitários no Vitest e auditoria de acessibilidade automatizada com `axe-core` em `web/src/tests/grid-a11y.test.tsx` com zero violações.

Aceite: 100% dos testes passando, zero violações no axe-core, build estático gerando as rotas da grade com zero erros e zero avisos.

## Fatia 17

Mecânica completa de Palavras Conectadas (Connections):

- ADR 009 em `docs/decisions/009-mecanica-palavras-conectadas.md` definindo topologia 4x4, quatro níveis de dificuldade, particionamento estrito e evidências auditadas;
- especificação JSON Schema v1 em `schemas/connections-puzzle-v1.json`, validador de esquema e escrita atômica em `kpop_scraping/connections_schema.py`;
- gerador determinístico em `kpop_scraping/connections_generator.py` com algoritmo solver de unicidade de partição (`count_valid_partitions == 1`) e interface de linha de comando em `kpop_scraping/connections_cli.py`;
- interface web modular sob `web/src/components/Connections/`, máquina de estados em `useConnectionsGame.ts`, rotas `/pt-br/conexoes/` e `/en/connections/`, contraste WCAG 2.2 AAA em todos os quatro níveis;
- validação de acessibilidade com zero violações em testes axe-core e validação em navegador real em quatro resoluções;
- integração da verificação de `connections.daily.json` em `web_publish.py --verify --require-connections` e no fluxo de CI do GitHub Actions.

Aceite: 100% dos testes Python e Vitest passando, build estático gerando rotas sem erros, validação no CI bem-sucedida.

## Fatia 18

Especificação formal, contrato e validação da mecânica de Nome por Tentativas (Wordle temático):

- elaboração da ADR 010 em `docs/decisions/010-mecanica-nome-por-tentativas.md` com definição de comprimento variável entre 3 e 10 letras, limite de tentativas (padrão 6), normalização alfabética ASCII A-Z e dicionário fechado de palpites válidos (`valid_guesses`);
- contrato formal JSON Schema Draft 2020-12 em `schemas/name-guess-v1.json` com `schema_version = "kpop-name-guess-puzzle-v1"`;
- validador de domínio e escrita atômica em `kpop_scraping/name_guess_schema.py` com validação de integridade referencial, tipos estritos, datas ISO e hashes SHA-256;
- implementação de funções utilitárias: `normalize_name` com decomposição NFKD, `compute_guess_feedback` com algoritmo determinístico em duas passagens para duplicatas e `generate_share_summary` com grade de emojis e suporte a alto contraste;
- suíte de testes de contrato e regras de domínio em `tests/test_name_guess_schema.py`.

Aceite: aprovação integral da suíte de testes contra o validador de domínio e o esquema Draft 2020-12, cobertura comprovada de duplicatas no algoritmo de feedback e escrita atômica validada.

## Etapas posteriores

Com as especificações da Fatia 18 estabelecidas, a entrega avança para o gerador determinístico (Fatia 19) e a interface web acessível (Fatia 20). Frentes posteriores abrangem caça-palavras temático, desafios cronológicos ("Quando foi?") e desafios com mapas geográficos.




