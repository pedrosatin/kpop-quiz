# ADR 041 sobre a CSP da homologação e as URLs https

## Status

Aprovado em 2026-11-14. Resolve o ticket 18 da auditoria de segurança de novembro de 2026, que reuniu os itens de endurecimento dos achados h-client e h-deploy do run-1. Muda o `csp-verify`, o build servido com `base`, o `script-src` de produção, a validação de URLs no navegador e o schema `licensed-media-v1`.

## Contexto

A produção recebe a Content Security Policy pelo `web/public/_headers`, que o Cloudflare Pages transforma em cabeçalhos. A homologação no GitHub Pages ([ADR 016](016-homologacao-github-pages.md)) usa o mesmo build com `ASTRO_BASE=/kpop-quiz`. O GitHub Pages ignora o `_headers`, então a homologação saía sem CSP, sem `X-Frame-Options` e sem HSTS, na origem `pedrosatin.github.io`.

O `csp-verify.mjs` aceitava `Content-Security-Policy-Report-Only` como se fosse a política aplicada. Um cabeçalho Report-Only só relata violações e não bloqueia nada.

O `script-src` liberava o host inteiro `https://www.googletagmanager.com`. Esse host serve o `gtm.js` e o `gtag/js` de qualquer conta do Google, e o site só precisa do loader do GA4 que o banner de consentimento pede.

Os validadores de URL do cliente divergiam. `word-search-types.ts` e `map-pilot.ts` comparavam o prefixo com `startsWith("https://")`, enquanto `quiz-types.ts` e `timeline-types.ts` faziam parse com `new URL`. O teste de prefixo aceita `https://` sem host e `https://exa mple.com`, que o navegador não consegue abrir. O `musicbrainz_event_url` do jogo do mapa ia para um `href` sem validação nenhuma. Em mídia licenciada, `asset_url` e `license_url` aceitavam http no Python, no JSON Schema e no TypeScript.

A página de privacidade não citava o envio da avaliação pós-partida para `tbbc.app` ([Feedback do quiz](../feedback.md)).

## Decisão

### CSP da homologação por meta tag

A integração `stagingCsp`, em `web/scripts/csp-policy.mjs`, entra na lista de integrações do `web/astro.config.mjs`. Ela trata como homologação o build cujo `base` do Astro tem prefixo, a mesma regra do `isStaging` do `BaseLayout.astro`. O workflow já define `ASTRO_BASE`, e nenhuma variável nova foi criada. No hook `astro:build:done`, a integração lê `dist/_headers`, monta a política e insere `<meta http-equiv="Content-Security-Policy">` logo depois do `<meta charset>` de cada HTML. Uma política por meta tag só vale para o markup que vem depois dela, e por isso a tag fica antes de qualquer script.

A meta tag copia o cabeçalho com duas diferenças. A primeira tira `frame-ancestors`, `report-uri`, `report-to` e `sandbox`, que os navegadores ignoram numa meta tag. A segunda tira as fontes de `cloudflareinsights.com`, `googletagmanager.com`, `google-analytics.com` e `analytics.google.com`. A homologação nunca carrega medição ([ADR 017](017-web-analytics.md)), e o passo "Guard against analytics in staging" do `staging.yml` falha quando um HTML cita um desses hosts. Uma diretiva que fique sem fonte recebe `'none'`, que é o significado de uma lista vazia.

Depois de inserir a tag, a integração roda `verifyDist` com `requireMeta` e derruba o build quando um script inline não tem hash no `script-src` ou um script externo vem de fonte não permitida. Os testes Playwright rodam com `bypassCSP: true`, então essa checagem no build é o que impede uma política que quebre a homologação. Os hashes de produção já cobrem o build com `base`, porque nenhum script inline depende do prefixo. O build de produção, servido na raiz, sai sem a meta tag.

O `frame-ancestors` não funciona por meta tag, e o GitHub Pages não deixa o site definir `X-Frame-Options` nem HSTS. A homologação continua enquadrável por outro site.

### `csp-verify`

O verificador exige `Content-Security-Policy` no `_headers` e falha quando só existe a versão Report-Only. A checagem de scripts externos passou a casar a fonte inteira, com caminho, pela regra da CSP Level 3: um caminho terminado em `/` casa como prefixo, qualquer outro casa exatamente, e a query string não conta. Uma página com meta tag precisa trazer exatamente a forma de homologação da política do cabeçalho, antes do primeiro script. A opção `--require-meta` exige a tag em todas as páginas, como a integração faz no build de homologação.

### GTM restrito ao loader do gtag

O `script-src` de produção passou a listar `https://www.googletagmanager.com/gtag/js`. O caminho sem barra final casa só com `/gtag/js`, com qualquer query, e bloqueia o `gtm.js` e o resto do host.

Os testes e2e de analytics (`consent-compact`, `code-visible-feedback` e `grid-mobile-actions`, 38 testes) passam com a mudança, mas rodam com `bypassCSP` e não exercitam a política. A evidência veio de um teste à parte no Chromium 156 headless, com o ID de GA4 de produção e os hits de coleta abortados para não chegar à propriedade. A página carregou o gtag.js sob uma CSP com o host inteiro e sob outra com só `/gtag/js`. Nas duas, o único script pedido ao host foi `/gtag/js`, `google_tag_manager` ficou definido e nenhuma violação de `script-src` apareceu. A CSP ignora o caminho depois de um redirecionamento. Se o Google passar a carregar outro script do mesmo host, o navegador o bloqueia e o GA4 para de medir até o `_headers` mudar, sem efeito no resto do site.

### Validador único de URL https

`web/src/lib/https-url.ts` exporta `parseHttpsUrl` e `isHttpsUrl`. As duas fazem parse com `new URL` e aceitam só `https:` com host. `quiz-types.ts`, `timeline-types.ts`, `word-search-types.ts`, `map-pilot.ts` e `source-label.ts` usam esse módulo, e um teste falha se outro arquivo de `web/src` voltar a comparar prefixo de `http`, definir um `isHttp*` próprio ou comparar `protocol` com `https:`. O validador não recusa credenciais na URL. Quem recusa é `sourceTarget`, que não cria link para elas. `isMapPilotDataset` passou a validar o `musicbrainz_event_url` de cada evento.

### Mídia só com https

`asset_url` e `license_url` passaram a exigir https em `kpop_scraping/media_registry.py`, em `schemas/licensed-media-v1.json` e em `isLicensedMedia`. Antes da mudança, a varredura dos 1439 arquivos JSON de `web/public/data` não achou nenhum registro de mídia e achou 24527 `source_url`, todos https. Os 31 `musicbrainz_event_url` de `data/map-pilot/deadline-events.json` também são https. O `photo_pool.py` monta `asset_url` a partir de `--site-base`, cujo padrão é `https://kpopquiz.online`, e só tem URLs de licença https em `LICENSE_DEED_URLS`. Um `--site-base` http passa a ser recusado.

### Avaliação na página de privacidade

As páginas `/pt-br/privacidade/` e `/en/privacy/` ganharam uma seção sobre a avaliação pós-partida. Ela diz que o voto e o comentário vão para a TBBC em `tbbc.app`, sem cookies, referer nem identificador de jogador, e que a TBBC recebe o IP como em qualquer conexão direta. Um teste lê o `connect-src` do `_headers` e falha quando um host de terceiro dessa lista não aparece nas duas páginas.

## Alternativas consideradas

### CSP nativa do Astro

O Astro gera hashes e emite a política em meta tag. Essa política seria calculada a partir do build, separada do `_headers`, e a homologação deixaria de testar a política que a produção envia.

### Meta tag escrita pelo `BaseLayout.astro`

O layout poderia importar o `_headers` e emitir a tag. A checagem dos hashes contra o HTML final continuaria fora do build, e o build de homologação passaria mesmo com uma política que bloqueasse um script.

### Rodar o `csp-verify` como passo do `staging.yml`

A integração já roda a mesma verificação dentro do `npm run build` de homologação, e um passo a mais no workflow repetiria a checagem.

## Consequências

- A homologação aplica a política de produção aos scripts, conexões, imagens e fontes, sem os hosts de medição. Um hash que falte quebra o build de homologação antes do deploy.
- A homologação continua sem `frame-ancestors`, `X-Frame-Options` e HSTS.
- Se o loader do GA4 mudar de caminho, a medição de produção para até o `_headers` ser atualizado.
- Um registro de mídia com URL http deixa de passar na validação, no pipeline e no navegador.
- Para reverter a meta tag, basta tirar `stagingCsp()` do `astro.config.mjs`. Voltar a aceitar http em mídia exige mudar juntos o Python, o JSON Schema e o `isLicensedMedia`.
