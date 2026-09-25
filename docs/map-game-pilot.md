# Piloto do jogo de mapas

## Resultado

O piloto funcional foi implementado nas rotas `/pt-br/mapa/` e `/en/map/`. Cada rodada escolhe até 10 das 31 datas candidatas da DEADLINE WORLD TOUR de BLACKPINK, pergunta em qual país a agenda oficial listou uma apresentação naquela data e aceita a feição de país resolvida no mapa. O jogo não afirma que a apresentação ocorreu.

As páginas têm `noindex` e não entram no sitemap. Esses controles não restringem acesso direto: o build estático contém as rotas e o bundle client-side com os eventos candidatos. Um deploy disponibiliza o jogo e esses dados a qualquer pessoa com o URL. A amostra não passa pelo pipeline de publicação dos outros jogos, mas já está incluída no build deste protótipo. O modo mostra, após cada resposta, o link da [agenda oficial da YG](https://artist.ygfamily.com/ARTISTS/BLACKPINK/concert/2025TOUR/index2.html), o registro candidato do MusicBrainz, a data da conferência e o aviso de que a agenda não confirma a realização do show. O mapa local usa Natural Earth Admin 0, versão 5.1.1, escala 1:10m, domínio público.

## Cobertura e identidade geográfica

A agenda da YG lista 33 datas em 16 destinos. Foram consultados individualmente 31 registros da [série DEADLINE no MusicBrainz](https://musicbrainz.org/series/510f1af4-7a2e-40f2-abd4-776d8da29b94); os 31 coincidem com a agenda por data e local. A série não tem candidatos para 28 de novembro de 2025 em Singapura nem 26 de janeiro de 2026 em Hong Kong. O piloto cobre 14 áreas de país/cartográficas.

O crosswalk identifica feições Natural Earth por QID Wikidata, com ISO alpha-2 como fallback apenas quando a feição não tem QID válido. Hong Kong resolve hierarquicamente para China (`Q148`, `CN`, feição `CHN`); Taiwan resolve para `TW`/`TWN`. Portanto, o quiz marca China como resposta para datas no Kai Tak Stadium. Isso segue a hierarquia geográfica dos dados usados pelo piloto; não é uma regra universal de nomenclatura política.

O arquivo de execução é [deadline-candidate-events.json](../data/map-pilot/deadline-candidate-events.json). Os registros mantêm IDs estáveis, data, localizador da entrada, URL, data de conferência e estado `candidate`/`unreviewed`. Respostas brutas da API MusicBrainz não foram retidas. A agenda normalizada, o relatório de cobertura e o crosswalk de pesquisa ficam como arquivos locais de revisão.

## Limite de uso das fontes

Dados publicamente acessíveis não significam automaticamente que qualquer coleta ou reutilização é permitida. MusicBrainz declara os dados principais da base como CC0 ([licenciamento](https://musicbrainz.org/doc/About/Data_License)); Natural Earth declara seus dados em domínio público ([termos](https://www.naturalearthdata.com/about/terms-of-use/)). A revisão não encontrou licença da YG que autorize coleta automatizada ou persistência da agenda, e o site declara proteção autoral. A lei sul-coreana prevê direitos de produtores de bases de dados (artigos 91 e 93 da [Copyright Act](https://www.law.go.kr/lsInfoP.do?ancYnChk=0&lsId=000798)). Isso não determina que o uso factual deste piloto seja ilícito; significa que a fonte permanece `unreviewed` para coleta automatizada e publicação até revisão apropriada.

O piloto registra fatos e IDs, sem copiar prosa, imagens, HTML ou capturas da fonte. O código, os JSONs e o bundle client-side estão no repositório e entram no build estático. `noindex` controla indexação por mecanismos de busca; não é controle de acesso. Antes de fazer deploy, rever a política de fontes em [source-policy.md](source-policy.md), aprovar a fonte para esse uso e concluir a revisão editorial das 31 linhas. Alternativamente, remover as rotas e dados do build até essa revisão.

## Implementação e verificação

- `kpop_scraping/country_crosswalk.py`: associação offline entre países revisados e feições do mapa; sem joins por nome.
- `kpop_scraping/tour_events.py`: validação de candidatos, mantendo separado `schedule_status=listed` de realização do evento.
- `scripts/build_map_pilot_map.py`: geração do mapa SVG local a partir do GeoJSON Natural Earth, com timeout e User-Agent identificável.
- `web/src/data/map-pilot.ts`: validação do conjunto local e seleção determinística de até 10 datas por dia.
- `web/src/components/MapPilot/MapPilotGame.tsx`: jogo acessível por mapa ou lista de países, PT/EN, feedback e fontes por resposta.
- Rotas Astro: `web/src/pages/pt-br/mapa.astro` e `web/src/pages/en/map.astro`, ambas `noindex`.

Testes de regressão cobrem preferência por QID diante de ISO conflitante, unicidade dos eventos, distribuição geográfica, seleção diária estável, feedback de acerto/erro e links de evidência.

Comandos canônicos executados:

```bash
python -m unittest discover -v
cd web && npm test
cd web && npm run build
```

## Continuação

O objetivo de viabilidade e o protótipo jogável estão concluídos. Próximo passo: revisar as capturas e os dados do piloto; decidir se a YG pode ser mantida como fonte para esse uso ou se a amostra deve ser substituída. Até essa decisão, não fazer deploy deste estado: `noindex` e a ausência no sitemap não impedem acesso ao bundle. A rota já pode ser removida do build se o restante do site precisar ser publicado antes da revisão.
