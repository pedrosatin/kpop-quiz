# Instruções para agentes

## Objetivo

Construir um conjunto de dados citável e uma aplicação de quizzes de K-pop. A correção e a proveniência dos fatos têm prioridade sobre a quantidade de perguntas.

## Arquitetura e Ponteiros

- **Frontend web**: `web/` — Aplicação Astro estática + Preact islands + Vitest + Playwright.
- **Backend / Coleta**: `kpop_scraping/` — Pipeline determinístico em Python padrão.
- **Decisões arquiteturais (ADRs)**: `docs/decisions/` (ADRs 001 a 023 com contratos de minigames e SEO).
- **Grafo de conhecimento**: `graphify-out/GRAPH_REPORT.md`.

## Comandos canônicos

```bash
# Verificação completa (Python + Web):
npm run check

# Python:
python -m unittest discover -v
python -m compileall -q .
python main.py --limit 3 --database /tmp/kpop-quiz-smoke.db

# Frontend (web/):
npm --prefix web test
npm --prefix web run build
```

## Invariantes

- Importar um módulo não pode iniciar rede nem gravar no banco.
- Toda consulta HTTP define timeout e `User-Agent` identificável.
- Requisições à Wikimedia são sequenciais e usam `maxlag`.
- Identidades externas usam `pageid`, `revid` ou Wikidata QID. Ordem de coleta nunca serve como identidade.
- Toda afirmação publicável aponta para uma revisão e um local dentro da fonte.
- Idade e duração são calculadas para uma data de referência.
- Dados externos são validados antes da publicação.
- Planilhas são exportações para revisão editorial. SQLite é a fonte local do MVP.

## Forma de trabalhar

- Mantenha coleta, extração, normalização, validação e geração de perguntas separadas.
- Adicione teste de regressão para cada correção de parser.
- Atualize o README ao alterar contratos ou escopo públicos.
- Registre decisões caras de reverter na descrição da PR e preserve o contexto essencial no README.
- Não adicione uma fonte sem documentar licença, atribuição, limites de uso e cobertura.

## Definição de pronto

Uma fatia está pronta quando os testes passam, o comando de exemplo funciona, os dados têm proveniência, as falhas ficam registradas e a documentação descreve o comportamento entregue.
