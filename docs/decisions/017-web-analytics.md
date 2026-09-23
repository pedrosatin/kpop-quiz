# ADR 017. Medição dual com Cloudflare e GA4 sob consentimento

## Status

Aceita (revisada em 2026-09-23: acréscimo do GA4)

## Data

2026-09-23

## Contexto

A produção serve `kpopquiz.online` a partir da raiz ([ADR 013](013-cloudflare-pages.md)) e a homologação serve `pedrosatin.github.io/kpop-quiz/` com `base` e `noindex` ([ADR 016](016-homologacao-github-pages.md)). O projeto precisa medir visitas reais sem misturar tráfego de homologação e sem coletar dados pessoais além do necessário.

## Decisão

Usar o Cloudflare Web Analytics (medidor privacy-first baseado no beacon `static.cloudflareinsights.com/beacon.min.js`, sem cookies próprios e sem armazenar identificação pessoal do visitante). O snippet só é emitido quando as duas condições valem:

- o build não é de homologação (`!isStaging`, reaproveitando o `const` existente no `BaseLayout.astro`, que deriva de `BASE_URL` com prefixo);
- `import.meta.env.PUBLIC_CF_BEACON_TOKEN` está presente e não vazio.

O workflow `.github/workflows/pages.yml` repassa `secrets.PUBLIC_CF_BEACON_TOKEN` como `PUBLIC_CF_BEACON_TOKEN` no passo `npm run build`. Secret ausente ou vazio significa build sem snippet. `CLOUDFLARE_API_TOKEN` não foi tocado: ele continua restrito ao deploy.

Nenhum cabeçalho CSP foi adicionado (`web/public/_headers` não criado): o site hoje não tem CSP, e criar uma só para o host do beacon exigiria `unsafe-inline` para os scripts `is:inline` existentes. Escopo fora desta trilha.

## Revisão de 2026-09-23: Google Analytics 4 com consentimento

O operador optou por adicionar o Google Analytics 4 para abrir o leque de anúncios (públicos, remarketing, conversões no Google Ads). O Cloudflare Web Analytics entra no build quando `PUBLIC_CF_BEACON_TOKEN` está configurado e opera sem cookies. O GA4 só carrega após aceite explícito:

- o componente `ConsentBanner` (montado no `BaseLayout` somente quando `!isStaging && PUBLIC_GA4_ID` presente) exibe o banner quando não há escolha gravada em `kpop-quiz-consent`;
- aceitar grava `accepted` e injeta `gtag/js` + `config` em runtime; recusar grava `rejected` e nada do Google é carregado;
- `pages.yml` repassa `secrets.PUBLIC_GA4_ID`; o build de homologação recebe um ID dummy e o guard de staging falha se `googletagmanager.com` ou `google-analytics.com` aparecer em `web/dist`;
- nenhum ID `G-` real é commitado; o teste `web/src/tests/ga4-consent.test.ts` trava o gate e a ausência de ID fixo;
- o import estático do `ConsentBanner` faz o Astro emitir o chunk da ilha mesmo em builds que não a montam (ex.: homologação). O chunk não referenciado não executa sem tag `<script>` que aponte para ele; por isso o guard de staging varre só `*.html`. Tentativa de import dinâmico condicional foi revertida: quebra a hidratação da ilha no build de produção.

Passos de operador pendentes: criar a propriedade GA4 e cadastrar `PUBLIC_GA4_ID` nos secrets do repositório. Sem o secret, a produção sai sem banner e sem GA4, como antes.

## Alternativas consideradas

### Google Analytics / gtag sem consentimento

Carregaria cookies de terceiros sem aceite. Rejeitado por LGPD: o GA4 entra somente via banner de opt-in.

### Beacon sem gate por ambiente

Emitiria pageviews da homologação e de previews locais. Rejeitado: poluiria a métrica de produção.

## Consequências

- A produção com o secret configurado emite o beacon em todas as rotas (todas usam `BaseLayout`).
- A homologação (`ASTRO_BASE=/kpop-quiz`) nunca emite o beacon, mesmo com o secret presente, e mantém o `noindex`.
- O teste `web/src/tests/analytics-beacon.test.ts` trava o gate no código-fonte, e o passo "Guard against analytics in staging" em `.github/workflows/staging.yml` falha o build de homologação se `cloudflareinsights.com` aparecer em `web/dist` ou se algum HTML perder o `noindex`.
- Passos de operador pendentes: criar o site/token no painel do Cloudflare Web Analytics (A2) e cadastrar `PUBLIC_CF_BEACON_TOKEN` nos secrets do repositório (A6).
