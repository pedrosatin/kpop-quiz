# ADR 042 sobre o `next/` já servido no gate de troca de tabuleiro

## Status

Aprovado em 2026-11-14. A decisão muda `kpop_scraping/board_swap_gate.py`. O gate compara o `next/` da árvore de trabalho com o `next/` do commit base quando a data dele já está no ar. Acrescenta a opção `--now` e a função `reference_zone` em `kpop_scraping/quiz_utils.py`. O workflow, o runner diário, o arquivo de declarações e os artefatos continuam iguais.

## Contexto

O cron roda `python -m kpop_scraping.board_swap_gate` entre a geração e o upload. Antes desta mudança, o gate comparava só o dia do diretório principal com a mesma data no commit base, servida pelo diretório principal ou pelo `next/`. O gate nunca comparava o `next/` da árvore de trabalho. Cada run gera de novo o conjunto do dia seguinte, e até a meia-noite em São Paulo nenhum jogador o carregou.

Os carregadores da web, pela função `preferNextDaily` de `web/src/data/daily-artifact.ts`, servem o tabuleiro de `next/` com data X quando o diretório principal é mais antigo e X é menor ou igual à data de hoje em São Paulo. Um run que mantém o dia anterior no diretório principal e gera o `next/` de X de novo, depois da meia-noite de X, troca um tabuleiro que os jogadores já estão jogando. Isso acontece num `workflow_dispatch` com `date` de ontem, ou num run que termina perto da meia-noite. O gate deixava a troca passar. A auditoria de segurança de novembro de 2026 registrou o caso como endurecimento, porque só o operador dispara esses runs.

Do gate ao deploy no ar, o dado passa pelo job `publish` e pelo `pages.yml`. No run de 2026-11-13, o passo do gate terminou às 21:16:14 UTC e o `publish` fez o merge às 21:16:54. Entre 2026-11-03 e 2026-11-11, os deploys do `pages.yml` disparados pelo cron e concluídos com sucesso levaram de 30 a 37 minutos.

## Decisão

### Quando uma data de `next/` conta como servida

A data X do `next/` conta como servida quando é menor ou igual à data de São Paulo no instante `now + SERVE_LEAD`. `now` é o relógio do gate, e `SERVE_LEAD` vale 45 minutos. A função `last_served_day(now)` faz essa conta com o fuso `America/Sao_Paulo`, por meio de `reference_zone`, a mesma função que dá a data de referência do runner. Sem o fuso instalado, o gate falha em vez de usar UTC.

O gate não sabe quando o deploy vai entrar no ar. Por isso pergunta se X já estará no ar quando o dado deste run chegar ao site. Os 45 minutos cobrem os 37 minutos do deploy mais lento medido, o minuto até o merge e uma folga.

### O que é comparado

O gate faz três comparações:

1. o dia do diretório principal com o diretório principal do base;
2. o dia do diretório principal com o `next/` do base, o caso da promoção;
3. o dia do `next/` com o `next/` do base, só quando esse dia conta como servido.

A terceira é nova. A data precisa ser a mesma dos dois lados, como nas outras. As regras de aceite também são as mesmas: `--regenerate` aceita a troca, e a declaração do runner a aceita para aquele jogo e aquela data. A linha da troca termina com `in web/public/data/next`, que a separa da comparação da promoção.

O gate não compara um `next/` que avança para o dia seguinte nem um `next/` que o run apaga. No segundo caso, nenhum tabuleiro novo vai ao ar para aquela data, e o site serve o diretório principal, com o dia anterior marcado como atrasado. O aviso `StaleDailyNotice` aparece no Quiz, nas Conexões, no Adivinhe, no Caça-palavras, na Linha do Tempo e no Código. A Grade mostra o tabuleiro anterior sem esse aviso. A Cruzadinha só aceita o tabuleiro do dia e avisa que a cruzadinha de hoje ainda não foi publicada.

### Relógio explícito

`check_board_swaps` recebe `now`, e a CLI aceita `--now` com data, hora e fuso em ISO 8601. Sem a opção, o gate usa a hora atual. Uma hora sem fuso faz o gate falhar com "could not run". O `--now` permite repetir o gate sobre commits antigos, como na verificação abaixo.

### Verificação sobre o histórico

O gate novo rodou sobre os 78 commits de `origin/master` que mudam `web/public/data`, de 2026-09-14 a 2026-11-13. O "depois" de cada commit veio da árvore dele, o "antes" do primeiro pai, e `now` da hora do commit. As declarações dos runs antigos não ficaram guardadas, então a verificação não aceitou nenhuma. A comparação nova não recusou nenhum commit.

Só o commit `987894b`, publicado em 2026-10-04 às 20:13 em São Paulo, gerou de novo o `next/` de uma mesma data com outros tabuleiros. Essa data era 2026-10-05, que só entraria no ar às 23:15 pela regra. Pela regra, o commit `8cf7d06`, de 2026-10-19 às 23:16 em São Paulo, já contaria 2026-10-20 como servida. Esse run manteve os tabuleiros de `next/`, então nada mudou para ele. As recusas no diretório principal caem em oito datas, e a regra delas não mudou. Seis estão na lista do [ADR 030](030-partida-diaria-por-jogo-e-data.md): 2026-09-19, 09-22, 10-04, 10-16, 10-18 e 10-19. As outras duas são 2026-09-17, refeita pelos commits de funcionalidade `e91f60a` e `b532c8c` antes do cron, e 2026-09-25, cujo caça-palavras o commit `8718da4` refez.

## Alternativas consideradas

### Comparar o `next/` sempre

Recusaria todo run que gera de novo o dia seguinte depois que o banco mudou, como o `987894b`. O `next/` serve justamente para ser refeito até a meia-noite.

### Usar a meia-noite sem margem

Deixaria passar um run cujo gate roda às 23:40 e cujo deploy entra no ar depois da meia-noite, com o tabuleiro trocado depois de servido. A margem cria outro risco. O gate recusa um run às 23:20 em São Paulo que muda o `next/`, mesmo que o deploy talvez terminasse antes da meia-noite. O operador repete o run com `--regenerate` ou espera o dia seguinte.

### Ler a data de publicação do deploy

O gate roda antes do commit e não tem acesso ao Cloudflare Pages. Uma consulta ao deploy anterior também não diria quando o próximo vai entrar no ar.

## Consequências

- Um run que gera de novo um dia já servido em `next/` falha antes do upload e cita o jogo, a data e o diretório, a menos que tenha `--regenerate` ou declaração.
- Os runs de rotina do meio do dia não mudam de resultado, porque o `next/` deles tem a data de amanhã.
- Um deploy que entra no ar mais de 45 minutos depois do gate, por falha ou cancelamento seguido de outro deploy, fica fora da regra. O gate decide pela hora em que rodou. Entre 2026-11-03 e 2026-11-13, três runs do `pages.yml` disparados pelo cron não chegaram ao job `deploy`. Em 2026-11-05 o `build` estourou o tempo no Playwright. Em 2026-11-08 o push do merge da PR #340 em `master` cancelou o run, porque o `pages.yml` usa o mesmo grupo de concorrência, `cloudflare-pages-refs/heads/master`, para o `workflow_run` e para o push em `master`, com `cancel-in-progress`. Em 2026-11-12 o `build` falhou na verificação Python. Nos três casos o dado do cron entrou no ar com um deploy seguinte. Em 2026-11-13 o `deploy` terminou 26 minutos depois do gate, e só o `smoke-prod` passou do tempo. Por isso a margem de 45 minutos falha mais vezes do que a medida dos deploys bem-sucedidos sugere.
- Um aparelho com o relógio adiantado carrega o `next/` antes da meia-noite. O gate não cobre esse jogador.
- O teste `test_a_change_only_in_next_passes`, que fixava o comportamento anterior, agora fixa a hora antes da meia-noite e se chama `test_a_change_only_in_next_passes_before_the_day_is_served`.
