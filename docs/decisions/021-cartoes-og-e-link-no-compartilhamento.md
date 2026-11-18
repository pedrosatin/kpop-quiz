# ADR 021. Cartões Open Graph por rota e link no compartilhamento

## Status

Aceita

## Data

2026-10-05

## Contexto

A [ADR 018](018-seo-llm-indexing.md) apontou o `og:image` de todas as páginas para `apple-touch-icon.png` (180x180) com `twitter:card=summary` e deixou o cartão dedicado para depois. Um link do site colado no WhatsApp, no X ou no Discord mostrava só o ícone, igual em todos os jogos.

O texto de resultado dos sete jogos também saía sem link, com exceção da Linha do Tempo, que montava a URL à mão e caía em `https://kpopquiz.online` quando não recebia origem. Quem recebia o resultado não tinha como chegar ao jogo, e a medição da [ADR 017](017-web-analytics.md) não separava essas visitas.

## Decisão

### Link no resultado

`seoShareUrl(key, locale)` em `web/src/lib/seo-routes.ts` monta a URL de produção da rota no idioma do jogador com um único parâmetro curto `?s=<jogo>`. O valor de `s` é o último segmento do caminho em inglês (`quiz`, `grid`, `connections`, `guess`, `word-search`, `map`, `timeline`, `code`, `crossword`), então as duas línguas de um jogo somam na mesma campanha. A origem vem de `SEO_PROD_ORIGIN`, a constante que o canonical já usa.

Depois do consentimento, `ConsentBanner` lê `?s=` e chama `gtag("config", …)` com os campos padrão do GA4 `campaign_source=share`, `campaign_medium=social` e `campaign_name=<jogo>` (`shareCampaignConfig`). Não há dimensão personalizada a cadastrar no painel. UTMs legados ou externos na URL têm precedência e o site não sobrescreve a atribuição.

O texto diário abre com `K-pop Quiz #N · <Jogo>`. `N` sai de `dailyChallengeNumber` em `web/src/lib/daily-challenge.ts`: dias corridos desde o primeiro `reference_date` publicado daquele jogo (`FIRST_DAILY_DATE`), contando o primeiro como `#1`. A data é a do artefato, então PT e EN e o replay do mesmo dia compartilham o mesmo número; jogo livre e datas anteriores ao marco saem sem `#N`. Os marcos iniciais foram conferidos no histórico de `web/public/data` e no `git log` (alguns artefatos de exemplo ou piloto ficam antes do primeiro dia publicado e, por isso, não numeram):

| Jogo | Primeiro dia (`FIRST_DAILY_DATE`) | Origem do marco |
|---|---|---|
| Grade | 2026-09-17 | Primeiro `grid.daily.json` |
| Conexões | 2026-09-17 | Primeiro `connections.daily.json` |
| Quiz | 2026-09-18 | Primeiro seed `kpop-daily-2026-09-18` |
| Adivinhe | 2026-09-18 | Primeiro `name-guess.daily.json` |
| Caça-palavras | 2026-09-18 | Primeiro `word-search.daily.json` |
| Linha do Tempo | 2026-09-19 | Primeiro `timeline.daily.json` com essa data (o commit inicial ainda trazia 2026-09-20 de exemplo) |
| Mapa | 2026-09-25 | Publicação do piloto DEADLINE |
| Código | 2026-10-19 | Primeira publicação diária (`code-groups.daily.json`; o piloto usa 2026-10-12) |
| Cruzadinha | 2026-10-31 | Primeiro `crossword.daily.json` |

Os geradores que usam `withShareUrl` (Quiz/`ShareResult`, Grade, Conexões, Adivinhe, Caça-palavras, Mapa, Linha do Tempo) e os textos próprios de Código e Cruzadinha terminam com essa URL numa linha própria. O texto vai inteiro, com o link na última linha, tanto para o share sheet (`navigator.share({ text })`) quanto para a área de transferência e para o campo de cópia manual. Assim nenhum destino perde o link.

A homologação compartilha a mesma URL de produção. O link leva quem recebe ao jogo publicado, e o host da homologação tem `noindex` e dados de outra branch. O canonical da ADR 018 já usa esse host, e nenhum guard de homologação proíbe `kpopquiz.online` no `dist`.

### Cartões de 1200x630

Cada uma das 14 rotas indexáveis tem um PNG de 1200x630 em `web/public/og/`, com o mesmo nome do Markdown em `web/public/llms/` (`pt-br-conexoes.png`, `en-word-search.png`). A rota do quiz também é a página inicial, então o cartão dela é o genérico do site, com `K-pop Quiz` e a frase "Jogos diários de K-pop com fontes". Privacidade, 404 e a raiz `/` usam esse cartão genérico pela chave `quiz`. Os cartões dos outros seis jogos trazem o nome do jogo como aparece na navegação, o rótulo `K-pop Quiz`, a frase e o domínio.

O `BaseLayout.astro` emite `og:image` absoluto no host de produção, `og:image:type`, `og:image:width`, `og:image:height`, `og:image:alt`, `twitter:card=summary_large_image`, `twitter:image` e `twitter:image:alt`. O texto alternativo sai de `seoOgImageAlt`, no idioma da página, no formato "<Jogo>, jogo diário do K-pop Quiz em kpopquiz.online". A URL do `og:image` e do `twitter:image` leva `?v=<8 hex>`, os primeiros caracteres do SHA-256 do PNG, calculado no build. Quem guarda o cartão por URL busca de novo quando `npm run og:generate` muda a imagem.

Os PNGs ficam versionados. `npm run og:generate` roda `web/scripts/generate-og.mjs` e recria todos. O script carrega `catalog.ts` e `seo-routes.ts` pelo Vite (`createServer` em modo middleware e `ssrLoadModule`), a mesma resolução do build. Importações sem extensão e de tipos dentro desses módulos continuam funcionando, o que não vale para o Node importando o `.ts` direto. Depois monta um HTML com as cores do tema claro de `tokens.css` e as fontes variáveis de `web/public/fonts/`, e tira o screenshot no Chromium do Playwright, que já é devDependency dos testes e2e. Os PNGs saem num diretório temporário e só substituem `public/og/` no fim, então uma falha não deixa o repositório sem cartões. O build não roda o script e não ganha dependência nova; o Vite já vem com o Astro.

### Verificação

`seo-routes.test.ts` confere que cada rota aponta para um PNG existente com 1200x630 no cabeçalho IHDR, que não sobra cartão órfão em `public/og/` e que a URL de compartilhamento de cada rota bate com o canonical. O `seo:verify` passa a exigir, nas 14 rotas, na raiz e no 404, `summary_large_image`, `twitter:image` igual ao `og:image`, largura, altura e alt declarados, o arquivo correspondente no `dist` com 1200x630 e a query `?v=` igual ao hash do arquivo.

## Alternativas consideradas

### Gerar os cartões no build

Satori com resvg, ou o Chromium no `astro build`, gerariam os PNGs a cada deploy. O conteúdo do cartão só muda quando muda o nome de um jogo ou o layout, e o build de produção roda todo dia depois do cron. Gerar no build acrescentaria segundos e uma dependência de navegador ao deploy sem mudar o resultado.

### resvg com SVG

O `@resvg/resvg-js` renderiza SVG sem navegador. Ele não lê WOFF2 nem aplica o eixo `wght` das fontes variáveis do site. O teste com ele desenhou os títulos em uma fonte de reserva. Usá-lo exigiria versionar instâncias TTF estáticas das duas fontes só para os cartões.

### Um único cartão para o site inteiro

Um cartão único também teria 1200x630, e todos os links dos jogos chegariam com a mesma imagem. O nome do jogo no cartão diz a quem recebe o link qual jogo vai abrir.

### URL no campo `url` do share sheet

Separar a última linha e chamar `navigator.share({ title, text, url })` deixaria o destino montar o cartão de prévia. Alguns destinos descartam o `url`, e o "Copiar" do share sheet do iOS copia só a URL quando ela existe, sem o resultado. A área de transferência também não tem campo de URL. Com o texto inteiro e o link na última linha, nenhum destino perde o link e o resultado copiado é o mesmo que o compartilhado.

## Consequências

- Alterar o nome de um jogo no catálogo, a frase do cartão ou as cores pede `npm run og:generate` e commit dos PNGs. O teste de tamanho não detecta cartão desatualizado, só cartão ausente, órfão ou com tamanho errado.
- O screenshot depende da versão do Chromium do Playwright, então regenerar em outra máquina pode mudar bytes sem mudar o conteúdo visível.
- Visitas vindas de resultados compartilhados aparecem no GA4 com campanha `share` / `social` / `<jogo>` quando a medição está ativa e o visitante aceitou o banner; o Cloudflare continua vendo só o `?s=`.
- `generateTimelineShareText` e `useTimelineGame` perderam o parâmetro `origin`, que nenhum chamador de produção passava.
