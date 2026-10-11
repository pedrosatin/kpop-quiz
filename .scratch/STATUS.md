# K-pop Quiz

Fase: running
Resumo: Jogos diários de K-pop em português e inglês, com respostas apoiadas em fontes registradas.
Atualizado: 2026-10-10

## Sobre
Oferece quiz, grade de interseções, conexões, adivinhação de nomes e caça-palavras sobre grupos e artistas. A coleta em Python registra fontes e revisões de Wikipedia e Wikidata; a interface em Astro e Preact apresenta os jogos e suas evidências.

O projeto também contém Linha do Tempo e um piloto de mapa baseado na agenda oficial da turnê DEADLINE. O [README](../README.md) descreve a coleta, a publicação e o contrato dos dados.

## Funcionalidades
- Quiz com modos assistido, padrão e especialista [live]
- Grade, Conexões, Adivinhe e Caça-palavras [live]
- Publicação automática dos jogos diários [live]
- Evidências das respostas e validação dos arquivos de dados [live]
- Linha do Tempo com ordenação de eventos
- Mapa da turnê com países conferidos por fontes

## Status
- O workflow de publicação diária e o deploy para Cloudflare Pages terminaram com sucesso em 10/10/2026. A raiz [kpopquiz.online](https://kpopquiz.online/) respondeu HTTP 200 à consulta de cabeçalhos; a consulta de conteúdo em `/pt-br/` pelo cliente de preparação recebeu 403.
- O histórico local inclui o botão Desistir, a trava de palpite repetido e a correção da Grade na [PR #149](https://github.com/pedrosatin/kpop-quiz/pull/149), além da validação da data de publicação na [#150](https://github.com/pedrosatin/kpop-quiz/pull/150).
- A consulta ao GitHub não encontrou PRs abertas. Os tickets locais da interface do jogo de fotos e da segunda turnê estão registrados como `wontfix`.

## Em andamento

## Perguntas abertas

## Decisões recentes
