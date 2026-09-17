# Roadmap

O detalhamento executável, os critérios de aceite e o ciclo de revisão estão em [Plano de implementação](implementation-plan.md).

## Fatia 0 concluída

- descoberta pela Action API
- paginação por token de continuação
- resumo e revisão de cada página
- SQLite com `UPSERT` e histórico de execução
- CLI sem efeitos durante import
- testes unitários e smoke test real

## Fatia 1 concluída

Objetivo: preservar a resposta usada como evidência e controlar mudanças no schema.

- guardar respostas brutas por revisão e hash
- adicionar migrações de schema
- registrar revisões e sua participação em cada execução
- configurar o diretório de dados brutos

Aceite: duas coletas da mesma revisão produzem um snapshot e duas execuções concluídas. O hash do banco confere com o JSON descomprimido.

## Fatia 2 concluída

Objetivo: transformar páginas da categoria em um catálogo validado de grupos.

- obter Wikidata QID e detectar redirecionamentos
- classificar páginas candidatas e registrar rejeições
- rejeitar listas, desambiguações e páginas sem QID compatível
- exportar relatório CSV de cobertura e rejeições

Aceite: páginas de lista não aparecem como grupos aceitos. Repetir a classificação não duplica entidades ou rejeições.

Implementação e revisão concluídas em 12 de setembro de 2026. O smoke test repetido classificou cinco páginas sem duplicar entradas ou snapshots.

## Fatia 3 concluída

Objetivo: criar o primeiro conjunto de entidades e fatos estruturados.

- entidades de grupo e pessoa
- formação, estreia e dissolução
- nascimento e local de nascimento
- vínculos de membros com validade temporal
- validação de precisão e conflito

Aceite: uma amostra de 30 grupos tem relatório de cobertura e cada afirmação aceita aponta para evidência.

A implementação e a revisão terminaram em 13 de setembro de 2026. Duas execuções da amostra de 30 grupos repetiram as mesmas contagens e mantiveram 197 entidades e 763 fatos. O escopo executado segue o [plano de implementação](implementation-plan.md). Estreia, dissolução e hiatos ficaram para uma fatia posterior.

## Fatia 4

Estado: aprovada na revisão de 13 de setembro de 2026.

Objetivo: publicar perguntas bilíngues de múltipla escolha em JSON estático.

- implementar nove templates iniciais
- gerar alternativas plausíveis com semente
- produzir explicação e link da fonte
- publicar JSON estático para a webpage
- validar a exportação com um schema

Aceite: gerar ao menos 100 perguntas aceitas e reproduzir uma sessão de dez perguntas, byte a byte, com a mesma semente.

A revisão retirou recombinações cronológicas que repetiam o mesmo fato-resposta. A correção acrescentou relações de integrante e gravadora com resposta única entre as quatro alternativas. Cada comparação declara os quatro fatos usados, e os distratores omitem outros grupos aceitos para a mesma pessoa. A amostra de 30 grupos gera 107 perguntas lógicas sobre 84 fatos-base e 214 variantes de idioma. Vínculos sem intervalo fechado e comprovado não geram perguntas sobre uma data.

## Fatia 5 concluída

O gerador foi dividido em módulos menores. `quiz_generator.py` passou de 998 para 96 linhas sem alterar os JSONs.

## Fatia 6 concluída

A interface Astro e Preact gera páginas estáticas em português e inglês. O componente mantém pontuação, cronômetro e foco no navegador. O build usa `/kpop-scraping/` no GitHub Pages.

## Fatia 7 concluída

O frontend carrega sessões publicadas pelo pipeline Python em `web/public/data`. Um manifesto liga os dois idiomas à mesma versão do dataset e registra o hash de cada arquivo. O CI valida os artefatos antes do build.

A revisão terminou em 13 de setembro de 2026. Os testes cobrem ausência, adulteração, troca de arquivo, travessia de diretório e divergências de idioma, dataset e sessão. O componente cancela o cronômetro assim que registra uma resposta.

## Fatia 8 concluída

Implementação de modos de jogo assistido, padrão e especialista, pistas de década com evidências auditáveis e manifesto v2. As sessões incorporam `challenge_rating`, `play_mode` e dedução de pontos por pistas reveladas. Testes em Python e Vitest validam a geração determinística e o cálculo de pontuação.

## Fatia 9 concluída

Sistema de design com tokens semânticos, fontes Space Grotesk e Noto Sans autohospedadas em formato WOFF2 sob licença OFL 1.1 e alternância entre temas claro e escuro. Prevenção de FOUC, sincronização entre abas, suporte a `forced-colors` e `prefers-reduced-motion`, com razão de contraste validada segundo WCAG 2.2 AA.

## Fatia 10 concluída

Modularização do componente `Quiz.tsx` em componentes com menos de 200 linhas de código sob `web/src/components/`, incluindo tela de preparação `GameSetup`, `DifficultyPicker`, `TimerControl`, `ProgressHeader`, `QuestionCard`, `HintTray` e `AnswerFeedback`. Máquina de estados explícita, cancelamento imediato do temporizador na submissão e controle acessível de foco.

## Fatia 11 concluída

Tela de resultados com `ScoreSummary`, compartilhamento sem spoilers via `ShareResult` com suporte a `navigator.share` e fallbacks para área de transferência, além de revisão educativa de respostas em `ReviewAnswers` com justificativa e links de evidência externos protegidos. Catálogo de mensagens bilíngue expandido.

## Fatia 12 concluída

Página de coleção de jogos com `GameCollection`, suporte a partida diária determinística via semente `kpop-daily-{YYYY-MM-DD}` pela CLI Python e sincronização bidirecional de parâmetros de URL `?mode=` e `?theme=` sem recarga de página e com preservação de consultas na troca de idioma.

## Fatia 13 concluída

Registro de mídia com validação estrita de licenças em `kpop_scraping/media_registry.py` e schema JSON Draft 2020-12 com oito campos obrigatórios e enum de doze licenças comerciais ou editoriais permitidas. Componente `LicensedMedia` com texto alternativo neutro pré-resposta, atribuição completa pós-resposta, tratamento de erro de carregamento e contenção de Cumulative Layout Shift via CSS.

## Fatia 14 concluída

Objetivo: formalizar a especificação técnica e os contratos de dados da Grade de Interseções como nova família de jogos determinística e compatível com publicação estática.

- especificação técnica na [ADR 008](decisions/008-grade-de-intersecoes.md) com grade 3x3 ortogonal, critérios (`formed_on`, `record_label`, `has_member`), gabarito factual auditado em SQLite, limite de palpites, regra de unicidade e resumo compartilhável sem spoilers;
- contrato formal JSON Draft 2020-12 estrito em `schemas/intersection-grid-v1.json` com `additionalProperties: false` e catálogo de candidatos para seleção assistida;
- validador e escrita atômica em `kpop_scraping/grid_schema.py`;
- testes unitários e de contrato em `tests/test_grid_schema.py` com cobertura de casos positivos e negativos.

## Fatia 15 em andamento

Objetivo: implementar o gerador determinístico em Python e a CLI da Grade de Interseções.

- gerador determinístico em `kpop_scraping/grid_generator.py` com suporte aos critérios ortogonais das três categorias do jogo;
- avaliação de fatos e evidências de banco SQLite local com cálculo de interseções por célula;
- seleção de grade 3x3 orientada por semente com garantia de solubilidade e atribuição distinta de grupos;
- cálculo de identificador `grid_id` canônico via SHA-256 sobre o artefato;
- interface de linha de comando em `kpop_scraping/grid_cli.py` com escrita atômica e suporte a partidas diárias via `--date`;
- testes em `tests/test_grid_generator.py` para determinismo estrito, solubilidade, unicidade, integridade de schema e CLI.

## Fatias posteriores

Concluída a implementação do gerador na Fatia 15, o planejamento foca na implementação da interface web e componente acessível do jogo 3x3, seguido pelas demais famílias: palavras conectadas, caça-palavras temático e adivinhação de nomes por tentativas. Frentes adicionais de dados abrangem discografia com datas auditáveis de lançamento ("Quando foi?"), desafios com mapas locais e integração de letras com fornecedor licenciado.


