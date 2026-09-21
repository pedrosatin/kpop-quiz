# ADR 006: aplicação web estática com Astro e Preact

## Status

Substituída pela ADR 013

## Data

2026-09-13

## Contexto

O primeiro lançamento precisa executar quizzes de múltipla escolha em português e inglês. O gerador Python já publica datasets e sessões determinísticas em JSON. A interface não precisa de conta, placar compartilhado ou escrita no servidor nesta fase. O GitHub Pages atende ao orçamento inicial e publica apenas arquivos estáticos.

A interface precisa manter pouco JavaScript, funcionar a partir de `/kpop-scraping/` e preservar o contrato `kpop-quiz-session-v1`. O componente do quiz exige estado no navegador para progresso, pontuação e cronômetro.

## Decisão

Usar Astro com saída estática e `base=/kpop-scraping`. Páginas Astro geram as rotas `/pt-br/` e `/en/`. O caminho raiz redireciona para português. Um único componente Preact controla a rodada no navegador.

Os textos da interface ficam em catálogos TypeScript separados dos dados das perguntas. A Fatia 7 substituiu a sessão incluída no bundle por `fetch` dos artefatos publicados pelo gerador. A [ADR 007](007-publicacao-de-sessoes-web.md) registra o contrato de publicação.

O workflow usa as ações oficiais `upload-pages-artifact` e `deploy-pages`. Ele testa e compila o diretório `web` antes da publicação. O repositório precisa habilitar GitHub Pages com GitHub Actions para o primeiro deploy.

## Alternativas consideradas

### Astro sem componente cliente

HTML e JavaScript manual reduziriam uma dependência. Essa opção espalharia regras de estado e manipulação do DOM, o que dificultaria os testes de teclado, cronômetro e avanço entre perguntas.

### Vite com Preact

Vite atende ao componente interativo. Astro gera rotas, metadados e HTML estático com menos JavaScript na página. A aplicação também poderá adicionar páginas editoriais sem transformar todo o site em uma aplicação cliente.

### Next.js com exportação estática

O projeto não usa recursos de servidor nesta fase. Next.js adicionaria convenções e dependências sem atender a um requisito adicional.

## Consequências

- GitHub Pages pode hospedar a interface sem processo de servidor.
- Links internos usam `BASE_URL`; assets e rotas continuam válidos no subdiretório do repositório.
- O navegador recebe JavaScript apenas para o quiz interativo.
- Novos idiomas exigem catálogo, rota e variantes de perguntas.
- O placar fica no navegador e desaparece ao recarregar a página.
- O componente carrega arquivos versionados em `public/data`; o bundle não contém uma sessão editorial.
