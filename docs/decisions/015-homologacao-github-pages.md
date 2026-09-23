# ADR 015. Homologação no GitHub Pages a partir da branch dev

## Status

Aceita

## Data

2026-09-22

## Contexto

A [ADR 013](013-cloudflare-pages.md) moveu a produção para o Cloudflare Pages, no domínio `kpopquiz.online`. O último deploy no GitHub Pages foi feito em 2026-09-21, antes da troca de hospedagem, e usa a base `/kpop-scraping/`. O site continua público e exibe dados desse dia.

O repositório foi renomeado para `kpop-quiz`. O GitHub Pages publica sites de projeto no subdiretório com o nome do repositório, e o endereço do site é `pedrosatin.github.io/kpop-quiz/`. O HTML do deploy antigo aponta CSS, fontes e scripts para `/kpop-scraping/`, que retorna 404. A produção gera rotas e assets a partir da raiz.

## Decisão

O GitHub Pages serve somente a homologação. O workflow `.github/workflows/staging.yml` roda em push na branch `dev` e por `workflow_dispatch`. Ele executa as mesmas verificações do deploy de produção: testes Python, `compileall`, verificação dos artefatos de `web_publish` e `npm test`. Depois gera o build e publica `web/dist` com `actions/upload-pages-artifact` e `actions/deploy-pages` no environment `github-pages`. O job de deploy só roda quando o workflow parte da branch `dev`.

O `web/astro.config.mjs` lê duas variáveis de ambiente. `ASTRO_SITE` substitui `site` e `ASTRO_BASE` define `base`. Sem as variáveis, o Astro usa `https://kpopquiz.online` na raiz, como antes. O workflow de homologação preenche as duas com as saídas `origin` e `base_path` de `actions/configure-pages`. Neste repositório, os valores são `https://pedrosatin.github.io` e `/kpop-quiz`.

Os caminhos com prefixo vêm de três mecanismos. Layouts e páginas usam `import.meta.env.BASE_URL`. Os carregadores de dados montam `data/<arquivo>` sobre o mesmo `BASE_URL`. O Vite reescreve as URLs absolutas de `url()` que apontam para `web/public`, como `/fonts/...` em `global.css`, e acrescenta o `base` no CSS gerado. Por isso o `global.css` não mudou.

Quando `BASE_URL` tem prefixo, o `BaseLayout.astro` emite `<meta name="robots" content="noindex">`. Assim as páginas da homologação não disputam resultados de busca com `kpopquiz.online`. O build de produção não recebe essa tag.

O deploy de produção em `.github/workflows/pages.yml` continua restrito a `master` e não define as variáveis.

## Alternativas consideradas

### Desativar o GitHub Pages

Essa opção remove o endereço antigo, mas deixa o projeto sem ambiente para validar mudanças antes de `master`.

### Preview do Cloudflare Pages para a branch dev

O `wrangler pages deploy --branch=dev` gera um preview na raiz de um subdomínio `pages.dev`, sem prefixo. Essa opção não testa o build com `base` e depende dos mesmos secrets da produção. O deploy no GitHub Pages usa o `GITHUB_TOKEN` e o token OIDC do workflow, sem credencial extra.

## Consequências

- `pedrosatin.github.io/kpop-quiz/` mostra o conteúdo da branch `dev`. A produção fica somente em `kpopquiz.online`.
- O build de produção sem variáveis gera arquivos idênticos aos gerados pela configuração anterior.
- A política de branches do environment `github-pages` precisa aceitar a branch `dev`.
- O cron commita os puzzles diários em `master`. A homologação mostra dados novos só depois de um merge de `master` na `dev`.
