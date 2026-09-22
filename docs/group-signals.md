# Sinais externos de grupos

`python -m kpop_scraping.group_signals_cli` gera um relatório local sobre os grupos aceitos no catálogo. O relatório não altera sessões nem artefatos publicados.

## Wikidata

A coleta lê o ID de canal do YouTube (`P2397`), o handle (`P11245`) e contagens de seguidores (`P8687`) por `wbgetentities`. Cada valor mantém o QID solicitado, o QID resolvido, a revisão da entidade, a propriedade, o GUID da declaração e o localizador dentro da resposta. Declarações descontinuadas e contagens sem vínculo explícito com um canal ou handle do grupo são descartadas.

Os dados estruturados do Wikidata são disponibilizados sob [CC0](https://www.wikidata.org/wiki/Wikidata:Licensing). A cobertura depende das contribuições existentes. Datas e contagens podem estar ausentes ou defasadas. Um canal compartilhado por mais de um grupo é registrado, mas não é considerado individual para ordenação.

## YouTube Data API

As estatísticas atuais de canal são opcionais e servem apenas para inspeção local. A chave é lida de `YOUTUBE_API_KEY`; não há argumento de linha de comando para a credencial. O relatório não contém a chave.

Esses dados seguem os [Termos dos Serviços da API do YouTube](https://developers.google.com/youtube/terms/api-services-terms-of-service) e as [Políticas para Desenvolvedores](https://developers.google.com/youtube/terms/developer-policies), não uma licença aberta do projeto. Estatísticas públicas obtidas sem autorização do canal não devem permanecer armazenadas por mais de 30 dias: atualize ou apague o relatório. Elas não entram no cálculo de relevância, não são publicadas no site e não devem ser adicionadas ao Git.

Limitações conhecidas:

- `subscriberCount` é arredondado para baixo a três algarismos significativos e pode ficar oculto pelo canal.
- `viewCount` soma formatos distintos. O YouTube passou a contar inícios e repetições de Shorts em 31 de março de 2025 e estendeu a contagem por início a vídeos longos e transmissões ao vivo em 24 de agosto de 2026.
- O endpoint não fornece volume de buscas, downloads nem uma medida comparável de audiência fora do YouTube.
- Um ID de canal presente no Wikidata pode ter sido removido ou não aparecer na resposta atual da API.

A definição atual dos campos está na [documentação de canais](https://developers.google.com/youtube/v3/docs/channels). Como a semântica e as políticas podem mudar, confirme essas páginas antes de ampliar o uso dos dados.

## Execução

Sem estatísticas ao vivo:

```bash
python -m kpop_scraping.group_signals_cli \
  --database data/kpop.db \
  --output data/group-signals.json
```

Para uma inspeção local com a API do YouTube, leia a chave sem exibi-la no terminal e exporte a variável antes de executar o mesmo comando:

```bash
read -rs YOUTUBE_API_KEY
export YOUTUBE_API_KEY
python -m kpop_scraping.group_signals_cli \
  --database data/kpop.db \
  --output data/group-signals.json
unset YOUTUBE_API_KEY
```
