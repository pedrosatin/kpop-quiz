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

A interface Astro e Preact gera páginas estáticas em português e inglês. O componente mantém pontuação, cronômetro e foco no navegador. Na época, o build usava `/kpop-scraping/` no GitHub Pages. Desde a [ADR 013](decisions/013-cloudflare-pages.md), a produção fica na raiz de `kpopquiz.online`.

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

## Fatia 15 concluída

Objetivo: implementar o gerador determinístico em Python e a CLI da Grade de Interseções.

- gerador determinístico em `kpop_scraping/grid_generator.py` com suporte aos critérios ortogonais das três categorias do jogo;
- avaliação de fatos e evidências de banco SQLite local com cálculo de interseções por célula;
- seleção de grade 3x3 orientada por semente com garantia de solubilidade e atribuição distinta de grupos;
- cálculo de identificador `grid_id` canônico via SHA-256 sobre o artefato;
- interface de linha de comando em `kpop_scraping/grid_cli.py` com escrita atômica e suporte a partidas diárias via `--date`;
- testes em `tests/test_grid_generator.py` para determinismo estrito, solubilidade, unicidade, integridade de schema e CLI.

## Fatia 16 concluída

Objetivo: implementar a interface web acessível da Grade de Interseções no Astro e Preact.

- tipagem em `web/src/lib/quiz-types.ts` e validador em tempo de execução `isIntersectionGrid`;
- carregador web `web/src/data/grid-loader.ts` com tratamento de erro e fixture estático para publicação;
- componentes modulares sob `web/src/components/Grid/` (`IntersectionGrid`, `GridBoard`, `GridCell`, `EntityPicker`, `GridResults`, `GridReview`), todos com menos de 200 linhas;
- regras da partida: limite de 9 palpites, regra estrita de unicidade por grupo, navegação por teclado e foco acessível;
- compartilhamento sem spoilers em emoji ou caracteres monocromáticos para alto contraste e painel de revisão com links externos seguros;
- rotas `/pt-br/grid/` e `/en/grid/`, integração na coleção de jogos e auditoria de acessibilidade automatizada com axe-core sem violações.

## Fatia 17 concluída

Objetivo: implementar a mecânica completa de Palavras Conectadas (Connections), incluindo especificação, gerador determinístico com prova de partição única, interface web acessível e validação no pipeline de publicação.

- ADR 009 e JSON Schema v1 `schemas/connections-puzzle-v1.json`;
- validador de esquema e escrita atômica em `kpop_scraping/connections_schema.py`;
- gerador determinístico `connections_generator.py` com solver de unicidade de partição (`count_valid_partitions == 1`) e CLI em `connections_cli.py`;
- interface web modular sob `web/src/components/Connections/`, máquina de estados em `useConnectionsGame.ts`, rotas bilíngues `/pt-br/conexoes/` e `/en/connections/`;
- validação real de acessibilidade com axe-core com zero violações e testes em navegador real em 4 resoluções sem transbordamento horizontal;
- integração da validação de `connections.daily.json` no script `web_publish.py --verify` e no fluxo de CI do GitHub Actions.

## Fatia 18 concluída

Objetivo: especificar a mecânica de adivinhação de nomes por tentativas (Wordle temático), incluindo ADR 010, JSON Schema v1, validador de esquema, algoritmo de retorno posicional com tratamento de duplicatas e suíte de testes de contrato.

- elaboração da ADR 010 em `docs/decisions/010-mecanica-nome-por-tentativas.md`;
- definição do JSON Schema Draft 2020-12 em `schemas/name-guess-v1.json`;
- implementação do validador e escrita atômica em `kpop_scraping/name_guess_schema.py`;
- implementação do algoritmo de retorno posicional em duas passagens, normalização alfabética e resumo compartilhável;
- suíte de testes unitários e de conformidade em `tests/test_name_guess_schema.py`.

## Fatia 19 concluída

Objetivo: implementar o gerador determinístico de partidas e a interface de linha de comando para a mecânica de nome por tentativas.

- implementação de `kpop_scraping/name_guess_generator.py` com seleção determinística de entidade-alvo, extração de pistas contextuais (ano de estreia, agência, integrantes, descrição) e agregação de evidências auditadas;
- construção do conjunto fechado de palpites válidos (`valid_guesses`) a partir dos nomes e aliases do catálogo e vocabulário suplementar;
- implementação da CLI em `kpop_scraping/name_guess_cli.py` com suporte aos parâmetros `--database`, `--output`, `--seed`, `--date`, `--word-length` e `--max-attempts`;
- suíte de testes unitários do gerador e da CLI em `tests/test_name_guess_generator.py`.

## Fatia 20 concluída

Objetivo: implementar a interface web acessível, componentes modulares, máquina de estados e rotas bilíngues para a mecânica de nome por tentativas.

- definição de contratos de dados em `web/src/lib/quiz-types.ts` e carregador assíncrono em `web/src/data/name-guess-loader.ts`;
- componentes modulares de interface em `web/src/components/NameGuess/` com limite de 200 linhas por arquivo;
- suporte a teclado físico e virtual, persistência de modo alto contraste e feedback acessível via `aria-live` e `aria-label`;
- criação das rotas `/pt-br/adivinhe/` e `/en/guess/` com integração no seletor de jogos e catálogo bilíngue;
- suíte de testes de máquina de estados, componentes e auditoria automatizada de acessibilidade via axe-core com zero violações.

## Fatia 21 concluída

Objetivo: validar a mecânica em navegador real e integrar os artefatos diários de adivinhação ao pipeline de publicação e verificação em CI.

- extensão do publicador `kpop_scraping/web_publish.py` com suporte à escrita atômica e verificação de `name-guess.daily.json`;
- inclusão da flag `--require-name-guess` na CLI e atualização de `.github/workflows/pages.yml` e `web/package.json`;
- validação em navegador real via Chrome DevTools em quatro resoluções (320px, 768px, 1024px e 1440px), com checagem de contraste, acessibilidade e jogabilidade;
- suíte de testes unitários em `tests/test_web_publish.py` para publicação e validação estrita.

## Caça-palavras concluído

Mecânica de caça-palavras temático com especificação na [ADR 011](decisions/011-mecanica-caca-palavras.md), contrato em `schemas/word-search-puzzle-v1.json`, gerador determinístico com CLI (`word_search_cli.py`), interface web acessível com rotas bilíngues e partidas diárias (`word-search.daily.json`) integradas ao ciclo de publicação e verificação em CI.

## Linha do tempo ("Quando foi?") concluída

Desafio cronológico em que o jogador ordena cinco eventos do mais antigo ao mais recente, com especificação na [ADR 012](decisions/012-mecanica-linha-do-tempo.md), contrato em `schemas/timeline-puzzle-v1.json`, gerador determinístico com CLI (`timeline_cli.py`), interface web acessível com rotas bilíngues e partidas diárias (`timeline.daily.json`) integradas ao ciclo de publicação e verificação em CI.

## Publicação em produção concluída

Produção no Cloudflare Pages em <https://kpopquiz.online>, conforme a [ADR 013](decisions/013-cloudflare-pages.md). A homologação usa a branch `dev` no GitHub Pages com `noindex`, conforme a [ADR 016](decisions/016-homologacao-github-pages.md), sem disputar busca com a produção.

## Relevância por pageviews concluída

Pontuação de relevância por pageviews da Wikipedia em inglês (`group_relevance_cli` e `group_relevance_score_cli`), com cálculo definido na [ADR 014](decisions/014-pageview-relevance.md). O filtro por relevância ajusta os modos de quiz sem afetar sessões quando a coleta não cobre o catálogo inteiro. O relatório de sinais de grupo é diagnóstico e não entra na pontuação.

## Piloto do jogo de mapas em andamento

Contrato de dados proposto na [ADR-015](decisions/015-contrato-de-dados-do-jogo-de-mapas.md): relatório geográfico somente leitura, validador de eventos de turnê sintéticos e crosswalk de países para feições Natural Earth por código ISO. O piloto não coleta agendas reais, não resolve cidades a partir de nomes e não gera perguntas de mapa.

## Ciclo diário automatizado concluído

Runner unificado e workflow `daily-puzzles-cron.yml`: reconstrói o banco com cache incremental, gera os seis jogos diários (`grid`, `connections`, `name-guess`, `word-search`, `timeline` e as sessões diárias nos dois idiomas), valida cada artefato contra seu schema em diretório temporário e publica por troca atômica somente quando todas as verificações passam. A semente de cada jogo deriva da data (`kpop-{jogo}-daily-{AAAA-MM-DD}`).

## Próxima etapa: analytics de acesso e navegação

Estado: implementada no código ([ADR 017](decisions/017-web-analytics.md)). Cloudflare Web Analytics entra no build de produção quando `PUBLIC_CF_BEACON_TOKEN` está configurado. O GA4 exige consentimento explícito e `PUBLIC_GA4_ID`. A ativação depende do operador registrar o site no painel Cloudflare Web Analytics, criar a propriedade GA4 e adicionar os dois secrets.

Objetivo: entender os usuários agora que o site está publicado em domínio amplo (`kpopquiz.online`): volume de acessos, jogos mais usados, idiomas e fluxo de navegação.

- escolher solução compatível com site estático e sem backend próprio (ex.: Cloudflare Web Analytics, Plausible ou Umami) e registrar a escolha em ADR: privacidade, cookies, LGPD/GDPR, custo e limites de uso;
- medir por rota e por jogo (quiz, grade, conexões, adivinhação, caça-palavras, linha do tempo), por idioma (`pt-br`/`en`) e por origem (direto, busca, referência);
- Cloudflare sem cookies nem dados pessoais; GA4 carregado somente depois do consentimento explícito;
- excluir a homologação (`dev` no GitHub Pages) das métricas de produção;
- documentar no README quais métricas são coletadas e onde fica o painel.

Aceite: o painel mostra acessos por página, jogo, idioma e origem; a homologação fica fora das métricas; o GA4 não carrega antes do consentimento; a documentação descreve o comportamento entregue.

## Etapa seguinte: SEO e indexação para buscadores e LLMs

Estado: implementada no código ([ADR 018](decisions/018-seo-llm-indexing.md)); pendente verificação de propriedade no Search Console e submissão do sitemap (operador).

Objetivo: deixar a página indexada, bem rankeada no Google e legível por LLMs.

- `sitemap.xml` e `robots.txt` liberando a produção e mantendo `noindex` só na homologação;
- URLs canônicas, `hreflang` pt/en, títulos e meta descriptions por rota e idioma, e tags Open Graph;
- propriedade verificada no Google Search Console (e Bing Webmaster) com monitoramento de indexação e Core Web Vitals;
- conteúdo legível por LLMs (ex.: `llms.txt` e versões Markdown das páginas principais);
- registrar a estratégia em ADR: o que é indexável, o que fica fora (artefatos JSON de dados, homologação) e como medir evolução de rank e citações.

Aceite: sitemap válido referenciado no `robots.txt`; Search Console sem erros de cobertura nas rotas principais; páginas de produção sem `noindex`; arquivo para LLMs publicado e documentado.




