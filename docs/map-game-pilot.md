# Piloto do jogo de mapas

## Jogo

As rotas `/pt-br/mapa/` e `/en/map/` fazem até 10 perguntas por rodada sobre as datas da DEADLINE WORLD TOUR de BLACKPINK. Cada pergunta mostra uma data e pede o país em que a agenda oficial listou o show. O jogador responde clicando no mapa ou na lista de países. Depois da resposta, o jogo mostra o link da [agenda oficial da YG](https://artist.ygfamily.com/ARTISTS/BLACKPINK/concert/2025TOUR/index2.html), o link do evento no MusicBrainz e a data da última conferência.

A pergunta descreve o que a agenda publicou. Uma data listada não prova que o show aconteceu. Em telas com mais de 420px, o jogo mostra esse aviso junto da resposta. Em qualquer tela, o aviso está em "Como jogar", no texto lido pelo leitor de tela após a resposta e no painel "Ver fonte" do resultado.

O navegador sorteia a rodada depois de carregar a página, a partir da data de São Paulo (America/Sao_Paulo), a mesma dos jogos diários. A rodada muda à meia-noite em São Paulo, e o registro salvo usa a mesma data. O HTML estático mostra só um aviso de carregamento, então a página gerada no build e a primeira renderização no navegador são iguais.

As rotas aparecem no menu de jogos como "Mapa" e "Map", estão no sitemap e têm resumo em `web/public/llms/`. O jogo usa a largura comum das páginas (64rem). A partir de 60rem, a lista dos 14 países fica ao lado do mapa, em duas colunas de botões de 44px; em telas menores, os mesmos países ficam num seletor na barra de ação, com o botão "Responder". O recorte do mapa vai de 84°N a 60°S, porque a Antártida e o Ártico não têm datas da turnê.

O progresso da rodada fica no `localStorage` do navegador, na chave `kpop-map-<data da rodada>`, com os MBIDs dos eventos da rodada, o país escolhido em cada data e a data na tela. Recarregar a página retoma a pergunta ou o resultado. O jogo descarta um registro de outra rodada, com país fora da lista ou com contagens que o jogo não produz. Ao carregar, o jogo apaga os registros de outras datas. No fim, a barra mostra o placar, por exemplo "7 de 10 certas.", e os botões "Compartilhar resultado", "Jogar novamente" e "Ver fonte". O painel lista cada data com o país correto, a resposta do jogador, o link da agenda com o local na fonte, o evento no MusicBrainz, o QID e a revisão do Wikidata usados para o país e a data de conferência. "Jogar novamente" apaga o registro e recomeça as mesmas datas do dia, como no Adivinhe e no Conexões, sem mexer nas estatísticas. O texto compartilhado marca cada data com 🟩 (certa) ou ⬛ (errada).

## Fontes

| Fonte | Dado usado | Licença e atribuição |
| --- | --- | --- |
| Agenda oficial da YG | cidade, local e datas de cada destino | Fatos de agenda publicados para o público. O projeto guarda cidade, local e data, sem copiar texto, imagem ou HTML da página. Cada pergunta leva o link da agenda. |
| MusicBrainz | MBID do evento, artista, local e hierarquia de áreas até o país | CC0 nos dados principais. Cada pergunta leva o link do evento. |
| Wikidata | país atual (`P17`) da área onde fica o local | CC0. O conjunto registra o QID e a revisão consultada. |
| Natural Earth Admin 0, 5.1.1, 1:10m | contorno dos países, `ADM0_A3`, `WIKIDATAID` e `ISO_A2` | Domínio público. O rodapé do jogo cita a fonte. |

## Atualização

`python -m kpop_scraping.map_pilot_refresh` refaz `data/map-pilot/deadline-events.json` a partir das fontes. O comando baixa a agenda uma vez e consulta o MusicBrainz em sequência, com intervalo mínimo de 1,1 s entre chamadas, timeout de 30 s e `User-Agent` com a URL do repositório. Ao Wikidata, faz uma chamada `wbgetentities` com `maxlag=5`. Se o Wikidata responder que está atrasado, o comando tenta de novo até 8 vezes, com espera dobrada a cada vez, somando até 255 s. Uma execução completa faz cerca de 110 chamadas e termina em aproximadamente dois minutos.

A data é a chave entre a agenda e o MusicBrainz, porque a turnê tem no máximo um show por dia. Um evento entra no conjunto quando todas estas condições valem:

1. A agenda da YG lista a data, e a cidade da agenda coincide com o nome do evento no MusicBrainz ou com uma das áreas do local.
2. O MusicBrainz registra um show não cancelado, em um único dia, com BLACKPINK como atração principal em um único local.
3. O artista no MusicBrainz aponta para o QID `Q25056945` no Wikidata.
4. A hierarquia de áreas do local chega a um país com um código ISO e um QID.
5. O `P17` atual da área do local no Wikidata inclui esse país. O validador descarta declarações com data de término (`P582`) e declarações depreciadas.
6. O QID do país corresponde a uma única feição do mapa Natural Earth.

Um evento que falha em alguma condição fica fora do conjunto, e o comando imprime o motivo. Datas da agenda sem evento aceito vão para `unmatched_schedule_dates`. O validador `validate_map_pilot_dataset` roda nos testes e confere o arquivo versionado sem acesso à rede.

O workflow `map-pilot-refresh.yml` executa o comando às 02:00 UTC do dia 1 de cada mês e depois roda os testes do piloto. Se o comando falhar, o workflow tenta de novo até 4 vezes, com 15 minutos entre as tentativas. Durante o dia, o Wikidata costuma responder `maxlag` aos runners do GitHub por mais tempo que a espera do próprio cliente. Se o arquivo mudou, o workflow faz o commit na `master`. O deploy do Cloudflare Pages começa quando esse workflow termina com sucesso. Uma falha de rede, uma mudança de layout na página da YG ou um conjunto vazio interrompe o workflow antes do commit, e o site mantém os dados anteriores.

## Cobertura em 25 de setembro de 2026

A agenda da YG lista 33 datas em 16 destinos. A série da turnê no MusicBrainz tem 31 eventos, e os 31 passaram nas seis condições. As datas 28 de novembro de 2025, em Singapura, e 26 de janeiro de 2026, em Hong Kong, não têm evento no MusicBrainz. Elas entram no jogo na primeira atualização depois que alguém registrar os eventos.

Os 31 eventos cobrem 14 países. O MusicBrainz registra Hong Kong como subdivisão da China, e o `P17` da área Kowloon City District no Wikidata é `Q148`. Por isso o jogo aceita China nas datas do Kai Tak Stadium. Taiwan resolve para `TW` e para a feição `TWN`.

Na primeira execução, o QID associado ao Rogers Stadium no MusicBrainz apontava para outro estádio, com país Estados Unidos. O validador consulta o `P17` da área do local, North York, em vez do QID do estádio, e por isso esse vínculo errado não afeta a resposta.

## Arquivos

- `kpop_scraping/official_schedule.py` lê cidade, local e datas da página da YG e interrompe a execução se o layout mudar.
- `kpop_scraping/musicbrainz.py` é o cliente sequencial da API do MusicBrainz.
- `kpop_scraping/map_pilot_refresh.py` faz a coleta, o cruzamento, a validação e a gravação do conjunto.
- `kpop_scraping/country_crosswalk.py` associa QIDs de país às feições do mapa pelo `WIKIDATAID`, com ISO alpha-2 como alternativa para feições sem QID.
- `kpop_scraping/tour_events.py` valida o formato e os identificadores de cada evento.
- `scripts/build_map_pilot_map.py` gera o mapa SVG a partir do GeoJSON Natural Earth, com QID e ISO em cada feição.
- `web/src/data/map-pilot.ts` valida o conjunto no build e sorteia as datas da rodada.
- `web/src/components/MapPilot/MapPilotGame.tsx` é o jogo em PT e EN.
- `web/src/components/MapPilot/MapPilotResult.tsx` mostra o resultado na barra, o compartilhamento e o painel de fontes.
- `web/src/components/MapPilot/map-pilot-save.ts` define, lê e valida o progresso salvo.

Os testes em `tests/test_map_pilot_refresh.py` usam uma amostra real de três eventos do MusicBrainz e uma agenda sintética com o layout da página da YG. Eles cobrem o leitor da agenda, o intervalo e as novas tentativas do cliente, a leitura do `P17` e as regras de exclusão. Os testes em `web/src` cobrem o formato do conjunto, o sorteio diário, o fluxo da rodada e a renderização do jogo.
