# ADR 045. Páginas de grupo indexáveis

## Status

Aceita

## Data

2026-11-19

## Contexto

As rotas indexáveis do site eram só os jogos diários (ADR 018). Consultas
como `quiz stray kids` não tinham URL própria. Publicar um grupo exige
fatos aceitos com revisão, elenco atual e ex-integrantes separados, e
conteúdo próprio em português e inglês — sem inventar biografias nem
misturar respostas do desafio diário no HTML (ADR 022).

O piloto escolhe Stray Kids (`Q46134670`): profundidade aceita suficiente
para quiz e caça-palavras; Linha do Tempo de lançamentos fica de fora
enquanto houver menos de 10 datas aceitas.

## Decisão

### Rota e allowlist

Cada grupo publicado ganha `/pt-br/<slug>/` e `/en/<slug>/`, com
`hreflang` recíproco e `x-default` na URL em inglês. O slug entra numa
lista explícita (`GROUP_PAGES` em `web/src/lib/group-pages.ts`). Slugs
reservados (segmentos de jogos e privacidade) são rejeitados na carga do
módulo. Slug fora da lista não gera página.

### SEO

As rotas de grupo entram em `GROUP_SEO_ROUTES` e somam-se a
`INDEXABLE_SEO_ROUTES` (jogos + grupos). O sitemap, os cartões OG, o
`seo:verify` e os resumos `llms/*.md` usam o conjunto indexável. O menu
de jogos (`SEO_ROUTES`) permanece só com os jogos diários.

### Conteúdo e artefatos

A página traz fatos aceitos com link da revisão, elenco atual e
ex-integrantes, quiz fixo de 10 perguntas e, quando o gate de nomes
sustenta, caça-palavras dos integrantes. Artefatos ficam em
`web/public/data/group-pages/<slug>/` com o mesmo `X-Robots-Tag: noindex`
de `/data/*`. O HTML da página não embute respostas do desafio diário.

### Mini-jogos

- Caça-palavras: mesmos gate e unicidade do diário (ADR 011). Nomes com
  menos de três letras após normalizar ficam de fora. Alias publicado
  pode substituir o canônico quando a forma curta impede o preenchimento
  sem ocorrência acidental.
- Linha do Tempo de lançamentos: só com 10 ou mais datas aceitas.
- Adivinhe e Conexões por grupo ficam de fora deste padrão.

### O que a ADR não registra

Métrica de Search Console, consulta-alvo e análise de concorrente ficam
fora do repositório público. A decisão de escalar para outros grupos
depois da janela de medição é do operador.

## Alternativas consideradas

- Publicar BTS primeiro: dependia de profundidade ainda em aberto no
  ticket 01; Stray Kids já passava no gate.
- Gerar páginas para todo grupo com `has_member` aceito: risco de
  conteúdo fino e colisão com rotas de jogo; a allowlist evita os dois.
- Reusar só `SEO_ROUTES` para grupos: misturaria landing de grupo com o
  menu de jogos diários.
