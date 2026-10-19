# Jogo de código de grupos

## Jogo

As rotas `/pt-br/codigo/` e `/en/code/` apresentam o código do dia: uma
sequência secreta de 4 grupos de K-pop distintos, escolhidos entre os 6
símbolos do tabuleiro. O jogador escolhe um grupo para cada posição e envia
até 10 tentativas. Depois de cada uma, o jogo mostra quantos grupos estão na
posição exata e quantos pertencem ao código, mas estão em outra posição — a
mesma informação agregada do Mastermind, sem indicar quais posições acertaram.

A sequência é um desafio de lógica, não um fato: o jogo não afirma nenhuma
relação entre os grupos que formam o código. O resultado do fim revela a
sequência e lista cada símbolo com o link da revisão do Wikidata que registra
a classificação de tipo musical (`P31`) do grupo.

O jogo entrou no ar como piloto `noindex` em `/pt-br/codigo-piloto/` e
`/en/code-pilot/` e foi promovido a jogo segundo o checklist da
[ADR 023](decisions/023-promocao-de-piloto-a-jogo.md): BaseLayout com banner
de consentimento, textos no catálogo bilíngue, menu, sitemap, resumos em
`web/public/llms/`, cartões OG, GameAbout/FAQ, skipLinks, GA4 com consent,
estatísticas locais, persistência e compartilhamento. As rotas antigas
respondem `301` no Cloudflare Pages pelo `web/public/_redirects`.

## Artefato diário

`code-groups.daily.json` segue o contrato `code-groups-pilot-v1`
(`schemas/code-groups-pilot-v1.json`): seis símbolos com QID, nome e fonte
(`claims.P31`, revisão e URL), a sequência secreta com 4 QIDs distintos,
`max_attempts: 10` e o `puzzle_id`, que é o SHA-256 do conteúdo canônico
(chaves ordenadas, separadores padrão do JSON em Python) de
`[schema_version, dataset_version, reference_date, seed, symbols, secret]`. O
componente web recalcula esse hash e recusa carga com identidade diferente, e
a estrutura do arquivo é validada antes do hash.

A semente do dia é `kpop-code-groups-daily-<data>`, derivada da data, então o
mesmo dia e o mesmo catálogo produzem o mesmo código, e todo mundo joga a
mesma sequência. A publicação é parcial: se o gerador falhar, o lote do dia
sai sem o arquivo, `code_groups_skipped` registra o motivo e a página mostra
o estado de indisponível com botão "Tentar novamente", sem bloquear os outros
jogos. O artefato piloto fixo (`code-groups.pilot.json`, seed
`group-code-pilot`) continua publicado como exemplo fixo do contrato.

```bash
python -m kpop_scraping.code_groups_cli --database data/kpop.db --date 2026-10-12 --seed group-code-pilot --output web/public/data/code-groups.pilot.json
python -m kpop_scraping.code_groups_cli --verify web/public/data/code-groups.pilot.json --database data/kpop.db
```

## Persistência, estatísticas e compartilhamento

O progresso da partida fica no `localStorage`, na chave
`kpop-code-<data da rodada>`, com os QIDs de cada tentativa e a seleção em
curso. As contagens não são salvas: elas são recalculadas a partir da
sequência secreta, então um registro editado nunca mostra um palpite que o
jogo não produziu. Um registro com grupo fora dos seis símbolos, grupo
repetido, mais tentativas que o limite ou seleção inválida é descartado, e ao
carregar o jogo apaga os registros de outras datas.

A partida concluída entra nas estatísticas locais (janela de estatísticas,
aba "Código" / "Code") uma única vez, marcada pela chave
`kpop-match-recorded-code-<puzzle_id>`; um resultado restaurado do
`localStorage` não repete o evento nem os eventos de GA4 (`game_start`,
`game_complete`, `share`, deduplicados por partida e visita em
`web/src/lib/game-analytics.ts`).

O texto compartilhado traz a data, o veredito ("Código descoberto em N
tentativas."), a linha de tentativas e uma linha de pegs por palpite (🟩
exatos, 🟨 deslocados, ⬜ o resto), sem nenhum nome de grupo, e termina com o
link do jogo no idioma do jogador
(`utm_source=share&utm_medium=social&utm_campaign=code`).

## Arquivos

- `kpop_scraping/code_groups_cli.py` gera e verifica o artefato, lendo o
  SQLite somente para leitura.
- `schemas/code-groups-pilot-v1.json` é o contrato versionado.
- `web/src/data/code-groups.ts` valida a estrutura, recalcula o hash de
  identidade e carrega o artefato diário (com `preferNextDaily` para o
  conjunto do dia seguinte em `data/next/`).
- `web/src/components/CodeGroups/useCodeGroupsGame.ts` guarda a máquina de
  estados e a persistência.
- `web/src/components/CodeGroups/CodeGroupsGameContent.tsx` renderiza o jogo
  e o resultado, com o texto de compartilhamento.
- `web/src/components/CodeGroups/CodeGroupsGame.tsx` carrega o artefato e
  apresenta os estados de carregando, indisponível e erro.

Os testes em `tests/test_daily_puzzles_runner.py` e `tests/test_web_publish.py`
cobrem a publicação diária. Os testes em `web/src/components/CodeGroups/`
cobrem carga, palpites, recusa de carga inválida, retomada de progresso,
deduplicação de estatísticas e compartilhamento. `web/e2e/code.spec.ts` e
`web/e2e/pilot-visual-a11y.spec.ts` cobrem os fluxos nos dois idiomas, temas,
viewports, teclado, toque e acessibilidade.
