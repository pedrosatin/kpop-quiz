# ADR 015. Homologação no GitHub Pages a partir da branch dev

## Status

Aceita

## Data

2026-09-22

## Contexto

A [ADR 013](013-cloudflare-pages.md) moveu a produção para o Cloudflare Pages, no domínio `kpopquiz.online`. O GitHub Pages continuou servindo um build antigo em `pedrosatin.github.io/kpop-scraping/`, sem atualização desde a troca de hospedagem. Esse endereço exibe dados e telas desatualizados como se fossem o site publicado.

O repositório passou a se chamar `kpop-quiz`. O GitHub Pages publica sites de projeto no subdiretório com o nome do repositório, então o endereço passa a ser `pedrosatin.github.io/kpop-quiz/`. A produção gera rotas e assets a partir da raiz.

## Decisão

O GitHub Pages serve somente a homologação. O workflow `.github/workflows/staging.yml` roda em push na branch `dev` e por `workflow_dispatch`. Ele executa `npm test`, gera o build e publica `web/dist` com `actions/upload-pages-artifact` e `actions/deploy-pages` no environment `github-pages`.

O `web/astro.config.mjs` lê duas variáveis de ambiente. `ASTRO_SITE` substitui `site` e `ASTRO_BASE` define `base`. Sem as variáveis, o Astro usa `https://kpopquiz.online` na raiz, como antes. O workflow de homologação preenche as duas a partir das saídas `origin` e `base_path` de `actions/configure-pages`, o que resulta em `https://pedrosatin.github.io` e `/kpop-quiz`.

Os caminhos com prefixo vêm de três mecanismos. Layouts e páginas usam `import.meta.env.BASE_URL`. Os carregadores de dados montam `data/<arquivo>` sobre o mesmo `BASE_URL`. O Vite reescreve as URLs absolutas de `url()` que apontam para `web/public`, como `/fonts/...` em `global.css`, e acrescenta o `base` no CSS gerado. Por isso a CSS não precisou mudar.

O deploy de produção em `.github/workflows/pages.yml` continua restrito a `master` e não define as variáveis.

## Alternativas consideradas

### Desativar o GitHub Pages

Remove o endereço antigo. O projeto ficaria sem ambiente para validar mudanças antes de chegarem a `master`.

### Preview do Cloudflare Pages para a branch dev

O `wrangler pages deploy --branch=dev` gera um preview na raiz de um subdomínio `pages.dev`, sem prefixo. Essa opção não exercita o build com `base` e depende dos mesmos secrets da produção. O GitHub Pages usa o `GITHUB_TOKEN` do workflow e não exige credencial extra.

## Consequências

- `pedrosatin.github.io/kpop-quiz/` mostra o conteúdo da branch `dev`. A produção fica somente em `kpopquiz.online`.
- O build de produção sem variáveis gera arquivos idênticos aos gerados pela configuração anterior.
- A regra de deploy do environment `github-pages` precisa aceitar a branch `dev`.
- Os puzzles diários são commitados em `master`. A homologação só recebe dados novos quando `dev` é atualizada a partir de `master`.
