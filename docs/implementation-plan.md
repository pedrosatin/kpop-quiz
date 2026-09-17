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

Estado: em andamento na branch `feat/intersection-grid-spec` (17 de setembro de 2026).

Objetivo: formalizar a especificação técnica e a modelagem de contratos da Grade de Interseções como nova família de jogos determinística e compatível com publicação estática.

Entregas:

- ADR 008 em `docs/decisions/008-grade-de-intersecoes.md` com definição formal da mecânica de grade 3x3, eixos ortogonais independentes, critérios (`formed_on`, `record_label`, `has_member`), coordenadas de células, respostas válidas baseadas exclusivamente em fatos auditados do SQLite, limites de palpites (9 a 12 tentativas ou até 3 erros), regra de unicidade por partida, resumo compartilhável sem spoilers com suporte a alto contraste e compatibilidade integral com publicação estática;
- schema formal JSON Draft 2020-12 estrito em `schemas/intersection-grid-v1.json` com `additionalProperties: false` em todos os nós, com os campos `schema_version`, `grid_id`, `dataset_version`, `reference_date`, `dimensions`, `row_criteria`, `col_criteria`, `cells` e `candidate_pool`;
- módulo de validação e escrita atômica em `kpop_scraping/grid_schema.py` com validação de tipos, integridade de coordenadas e não vacuidade de respostas válidas;
- suite de testes unitários em `tests/test_grid_schema.py` com validação de fixture completo contra o schema oficial e testes negativos para células sem respostas válidas, campos ausentes, tipos incorretos e violações estruturais.

Aceite: fixture completo validado com sucesso contra `schemas/intersection-grid-v1.json` e pelo validador do domínio. Células sem respostas válidas e estruturas com campos ausentes ou tipos inválidos falham imediatamente na validação. Documentação técnica aprovada e livre de vícios de redação.

## Etapas posteriores

Com a especificação e os contratos da grade de interseções estabelecidos na Fatia 14, o desenvolvimento avança para a implementação do gerador factual no pipeline Python e da interface web interativa.

Próximas mecânicas planejadas conforme `docs/ideas/game-mechanics-and-visual-system.md`:

1. Gerador e interface da grade de interseções: extração de dados do SQLite, exportação estática e componente web acessível para o tabuleiro 3x3.
2. Palavras conectadas: agrupamento de dezesseis elementos em quatro conjuntos temáticos mutuamente exclusivos.
3. Caça-palavras temático: grade com solução única demonstrada para identificar entidades associadas a um tema central.
4. Nome por tentativas: identificação de grupo, pessoa, música ou álbum com limites de tentativas, normalização textual e retorno posicional por caractere.

Frentes condicionadas a contratos de dados ou licenciamento:

- ordenação cronológica e desafio temporal ("Quando foi?") condicionados à coleta de datas auditáveis de lançamentos e discografia;
- desafios com mapas geográficos condicionados ao levantamento de coordenadas locais e suporte a navegação por teclado;
- identificação de trechos de letras condicionada à contratação de fornecedor com licença de exibição territorial.


