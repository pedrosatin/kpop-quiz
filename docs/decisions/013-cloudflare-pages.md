# ADR 013. Hospedagem estática no Cloudflare Pages

## Status

Aceita

## Data

2026-09-21

## Contexto

O domínio `kpopquiz.online` precisa servir a interface estática do K-pop Quiz na raiz do site. O GitHub Pages publica o projeto no subdiretório `/kpop-scraping/`. Por isso, o Astro configura `base` e os caminhos de assets com esse prefixo.

O diretório `web/dist` contém somente arquivos estáticos. Não há funções, banco de dados ou segredos em tempo de execução.

## Decisão

Hospedar o diretório `web/dist` no Cloudflare Pages, no projeto `kpopquiz`, associado ao domínio `kpopquiz.online`. O Astro usa `https://kpopquiz.online` como `site` e gera rotas e assets a partir da raiz.

O workflow `.github/workflows/pages.yml` executa as verificações Python, os testes web e o build. O job de deploy executa `wrangler pages deploy` para publicar `web/dist` quando o repositório contém os secrets `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`.

## Alternativas consideradas

### GitHub Pages no subdiretório do repositório

Essa opção mantém o endereço `pedrosatin.github.io/kpop-scraping/`. O domínio próprio exige redirecionamento ou configuração adicional e preserva o prefixo em todos os caminhos de assets.

### Hospedagem com servidor de aplicação

O conteúdo já é gerado como arquivos estáticos. Um servidor acrescentaria operação e custo sem requisito de execução no backend.

## Consequências

- O site atende o domínio `kpopquiz.online` na raiz.
- A configuração do Astro gera assets com caminhos iniciados em `/`.
- A publicação contínua depende de um token Cloudflare com permissão Pages Edit armazenado como secret do GitHub.
- A interface continua estática e os jogos mantêm os dados publicados em `web/public/data`.
- Desde a [ADR 015](015-homologacao-github-pages.md), o GitHub Pages publica só a homologação da branch `dev`.
