# ADR 044. Redirect 301 da raiz para `/pt-br/`

## Status

Aprovado em 2026-11-19. Substitui o alias canônico da raiz descrito na [ADR 018](018-seo-llm-indexing.md) e na [ADR 020](020-pagina-404-e-sitemap.md).

## Contexto

A raiz `https://kpopquiz.online/` e `/pt-br/` serviam o mesmo quiz em português. A raiz emitia `canonical` para `/pt-br/`, `hreflang` `pt-BR`/`en` e `x-default` para `/en/`. O mesmo conteúdo ficava em duas URLs. O redirect concentra o acesso ao quiz português em `/pt-br/`.

A [ADR 018](018-seo-llm-indexing.md) ainda registrava `x-default` em `/pt-br/` na tabela hreflang, diferente do código (`SEO_DEFAULT_PATH = "/en/"`), do sitemap e do `<head>`.

## Decisão

### Redirect permanente

`web/public/_redirects` passa a declarar `/ /pt-br/ 301` no Cloudflare Pages. A documentação oficial do Pages afirma que redirects são sempre seguidos, mesmo quando um asset estático casa com o pedido ([Redirects](https://developers.cloudflare.com/pages/configuration/redirects/)). O build deixa de gerar `dist/index.html`, porque `web/src/pages/index.astro` foi removido. Assim a raiz deixa de ser página de conteúdo e o 301 é a única resposta útil em produção.

A zona Cloudflare já força HTTPS. `http://kpopquiz.online/` responde `301` para `https://kpopquiz.online/` e preserva a query string nesse salto. Depois do deploy, o caminho completo fica em no máximo dois saltos (`http` → `https` → `/pt-br/`).

### Query string

O `_redirects` do Pages não oferece matching por query string (tabela "Advanced redirects" da mesma documentação). Destinos podem incluir query string explícita. A preservação da query no redirect de path segue o comportamento já observado no próprio site. O redirect existente `GET /pt-br/codigo-piloto/?s=quiz&utm_source=smoke` responde `301` com `Location: /pt-br/codigo/?s=quiz&utm_source=smoke`. A nova regra `/ → /pt-br/ 301` é confirmada depois do deploy. Links de compartilhamento (`seoShareUrl`) já apontam para `/pt-br/...` ou `/en/...`, nunca para `/`.

### O que não muda

- `hreflang`, `x-default` (continua `/en/` por rota) e o sitemap (18 URLs, sem `/`).
- Páginas de privacidade (`/pt-br/privacidade/`, `/en/privacy/`) continuam `noindex`.
- Homologação no GitHub Pages ignora `_redirects`; a raiz de staging passa a 404, aceitável porque a homologação inteira é `noindex` ([ADR 016](016-homologacao-github-pages.md)).
- `WebSite` JSON-LD permanece nas landings do quiz (`/pt-br/` e `/en/`) com `url` em `https://kpopquiz.online/`, identidade do site no domínio.

### Correção da ADR 018

A tabela hreflang da ADR 018 passa a registrar `x-default` em `/en/` (e nas equivalentes em inglês das outras rotas, via `<head>`), alinhada ao código e ao sitemap. A menção à raiz como alias canônico sai; a raiz passa a ser redirect.

### Verificação

`seo:verify` exige ausência de `dist/index.html`, a regra `/ → /pt-br/ 301` em `dist/_redirects`, `WebSite` na landing portuguesa e `noindex` nas páginas de privacidade. O smoke E2E, contra produção, confere o 301 e a preservação de `?s=` e UTMs; no preview local, a raiz responde 404.

## Alternativas consideradas

### Redirect para `/en/`

Levaria quem digita o domínio no Brasil para a versão em inglês e misturaria sinais de uma página em português com outra em inglês. Rejeitado.

### Página de escolha de idioma como `x-default`

Criaria uma URL nova sem conteúdo de jogo e atrasaria a consolidação do índice português. O `x-default` já aponta para `/en/`. Rejeitado.

### Manter `index.html` e confiar só no `_redirects`

A documentação do Pages garante que o redirect vence o asset. Mesmo assim, manter HTML duplicado na raiz ofereceria conteúdo se o arquivo `_redirects` falhasse no deploy. Remover a página elimina essa superfície.

## Consequências

- Buscadores passam a ver `/` como redirect para `/pt-br/`, e o quiz português fica numa URL só.
- Links internos, cartões de compartilhamento, `llms.txt`, sitemap e `seoShareUrl` já usavam `/pt-br/` ou `/en/`.
