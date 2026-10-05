# ADR 022. Rastreio de /data/, texto estático nas rotas de jogo e IndexNow

## Status

Aceita. Substitui o `Disallow: /data/` da [ADR 018](018-seo-llm-indexing.md) e a justificativa de rastreio citada na [ADR 020](020-pagina-404-e-sitemap.md).

## Data

2026-10-05

## Contexto

As rotas de jogo servem um HTML com 126 a 153 palavras. O H1 tinha uma ou duas palavras e não citava K-pop ("Conexões", "Caça-palavras", "Adivinhe o nome"), e a página não tinha H2 fora da ilha. O conteúdo de cada jogo chega pela ilha Preact, que baixa `/data/*.daily.json` no navegador.

O `robots.txt` de produção bloqueava `/data/`. O Googlebot renderiza as páginas com o Web Rendering Service (WRS), que obedece ao `robots.txt` também nos recursos que a página pede. Com o bloqueio, o WRS não baixava os JSON e indexava a ilha no estado "Carregando...". O bloqueio também anulava o `X-Robots-Tag: noindex` de `web/public/_headers`, porque o Google só lê o cabeçalho de uma URL que ele tem permissão para rastrear. Uma URL bloqueada pode entrar no índice sem conteúdo quando outra página aponta para ela.

O Search Console mostrou impressões para "caça palavras kpop". Faltavam páginas que respondessem a "kpop connections", "kpop wordle" e "jogo kpop diário".

## Decisão

### Rastreio de /data/

O `robots.txt` de produção passa a ter `Disallow: /data/next/`, `Allow: /` e a linha do sitemap. O diretório `/data/next/` guarda os jogos do dia seguinte, publicados pelo cron das 15:00 UTC entre 12:00 e 24:00 em Brasília, e essas respostas ficam fora do rastreio. O resto de `/data/` fica rastreável. O `_headers` continua enviando `X-Robots-Tag: noindex` em `/data/*`, então os JSON servem à renderização e ficam fora do índice. As ilhas continuam funcionando com o bloqueio: `preferNextDaily` e `nextDailySession` em `web/src/data/` caem no artefato principal quando o fetch de `next/` falha ou traz conteúdo inválido. O sitemap continua sem URLs de `/data/`, e nenhum HTML aponta para esses arquivos com `<a href>`. A homologação mantém `Disallow: /`.

A decisão da ADR 020 sobre `<lastmod>` não muda. O HTML das 14 rotas continua mudando só quando o código muda. O conteúdo diário mora nos JSON, que não entram no sitemap.

### H1 e texto estático

O H1 das 12 rotas de jogo cita K-pop, em português e em inglês: "Conexões de K-pop" e "K-pop Connections", "Caça-palavras de K-pop" e "K-pop Word Search", "Adivinhe o nome: Wordle de K-pop" e "Guess the Name: K-pop Wordle", "Grade de interseções de K-pop" e "K-pop Intersection Grid", "Quiz de mapa de K-pop: BLACKPINK" e "K-pop Map Quiz: BLACKPINK", "Linha do Tempo do K-pop" e "K-pop Timeline". O título e a descrição do jogo de nomes passam a citar "Wordle de K-pop" e "K-pop Wordle", sem dois-pontos na descrição. O título em português da linha do tempo encurtou para caber nos 60 caracteres da ADR 018.

O componente `web/src/components/GameAbout.astro` renderiza no HTML, abaixo da ilha, três seções com H2 que citam o nome do jogo: "Como jogar Conexões de K-pop", "De onde vêm os dados das Conexões de K-pop" e "Perguntas sobre Conexões de K-pop" (em inglês, "How to play K-pop Connections", "Where the K-pop Connections data comes from" e "K-pop Connections FAQ"). As perguntas usam H3. O texto fica em `web/src/i18n/game-about.ts`, exposto como `messages.about`, com 305 a 452 palavras por rota. A maior parte das perguntas da seção de perguntas é própria do jogo, como "Por que um nome parece caber em dois grupos?" nas Conexões e "Por que (G)I-DLE vira GIDLE?" no Wordle; cada jogo mantém uma entrada genérica (grátis, conta ou idiomas), alternada entre as rotas. Cada afirmação confere com o código: o cron das 15:00 UTC em `daily-puzzles-cron.yml`, a troca à meia-noite de São Paulo em `web/src/data/daily-artifact.ts`, os geradores em `kpop_scraping/` e a atualização mensal do mapa em `map-pilot-refresh.yml`. A rota do mapa descreve a própria cadência, porque a rodada sai da data e a lista de shows é refeita uma vez por mês.

O bloco fica abaixo do jogo para não empurrar o tabuleiro para fora da primeira tela.

### IndexNow

`web/public/f1d8e02bd6db4073f482ac4de7e15cf8.txt` publica a chave IndexNow com o próprio valor como conteúdo. O protocolo prevê que a chave seja pública. Ela só prova que quem envia as URLs controla o host. O job `deploy` de `.github/workflows/pages.yml`, depois do `wrangler pages deploy`, envia as URLs do `sitemap.xml` para `https://api.indexnow.org/indexnow` em um POST JSON com `host`, `key`, `keyLocation` e `urlList`. O passo lê a chave do nome do arquivo em `web/dist`, usa `continue-on-error` e só emite aviso quando a resposta não é 200 nem 202.

O passo roda em push para `master` e em `workflow_dispatch`. Os deploys disparados pelo cron diário (`workflow_run`) não enviam ping. Um push que não muda o HTML das rotas, por exemplo só em `kpop_scraping/**`, dispara deploy e ping do mesmo jeito, porque o filtro de paths do workflow aceita esses diretórios. O reenvio das mesmas 14 URLs nesse cenário é aceito pelo volume pequeno. A homologação não tem esse passo. O build de homologação também copia o arquivo da chave. Isso não tem efeito, porque o `robots.txt` de homologação bloqueia tudo e o arquivo só vale para `kpopquiz.online`.

### Verificação

O `seo:verify` passou a exigir:

- `robots.txt` de produção com uma única linha `Disallow`, exatamente `Disallow: /data/next/`;
- H1 com "K-pop" nas 14 rotas;
- nas 12 rotas de jogo, o bloco `.game-about` com três H2 no idioma da rota, cada um começando com "Como jogar", "De onde vêm os dados" e "Perguntas sobre" (em inglês, "How to play", "Where the ... data comes from" e "FAQ"), e pelo menos 300 palavras;
- um arquivo `<32 hex>.txt` na raiz do build com a própria chave como conteúdo.

Os testes do Vitest cobrem o `robots.txt`, o H1 com K-pop, o limite de 300 a 500 palavras, a hierarquia de headings e uma auditoria axe do componente.

## Alternativas consideradas

### Manter o bloqueio e pré-renderizar o jogo do dia no HTML

O build de produção roda depois de cada publicação diária, então daria para embutir o puzzle no HTML. Isso exporia a resposta no código-fonte e faria o HTML mudar todo dia, o que contradiz a decisão de `<lastmod>` da ADR 020. A ilha continua lendo o JSON.

### Texto na ilha

A ilha só monta depois do JavaScript e do JSON. O texto no `.astro` chega no HTML servido para qualquer leitor, inclusive robôs que não executam JavaScript.

### Ping do IndexNow a cada deploy diário

Os deploys disparados pelo cron diário reenviariam as mesmas 14 URLs sem mudança no HTML. O IndexNow pede envio só de URLs alteradas. Um push de código que não mexe no HTML também reenvia as mesmas URLs, e esse caso foi aceito (ver IndexNow).

## Consequências

- O Googlebot consegue renderizar as ilhas com o puzzle do dia, e os JSON continuam fora do índice pelo `X-Robots-Tag`. As respostas do dia seguinte em `/data/next/` ficam fora do rastreio.
- Cada rota de jogo passa de cerca de 150 para 305 a 452 palavras no HTML servido.
- Bing e os outros participantes do IndexNow recebem as 14 URLs depois de cada deploy de código, inclusive quando o push só muda o coletor.
- Mudar o texto de um jogo exige conferir o fato no código e manter a faixa de 300 a 500 palavras do teste.
