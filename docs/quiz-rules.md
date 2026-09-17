# Regras de quiz

## Contrato de publicação

Uma pergunta publicável contém template e versão, entidade alvo, afirmação aceita, resposta tipada, alternativas, explicação, revisão da fonte e data de referência.

O gerador produz o mesmo resultado quando recebe a mesma semente, versão do template e versão dos dados. Perguntas afetadas por uma nova revisão voltam para validação.

Cada pergunta declara um `semantic_id` e os `fact_base_ids` que sustentam a resposta. O dataset contém no máximo uma pergunta de cada tipo para a mesma base factual. A sessão rejeita identidades semânticas repetidas.

## Critérios de aceitação

- A afirmação tem evidência localizável.
- A precisão da fonte atende ao texto da pergunta.
- O fato tem `status = 'accepted'` em `facts`. Estados `rejected`, `conflict` e `superseded` não geram perguntas.
- Não existe conflito aberto para o fato usado.
- Perguntas de idade exigem `born_on` sem a marca `insufficient_precision_for_age`. Perguntas sobre período de vínculo exigem datas sem a marca `validity_not_evidenced`.
- A resposta permanece válida na data declarada.
- As alternativas têm o mesmo tipo e são distintas.
- Há candidatos suficientes para criar alternativas plausíveis.
- O texto não revela a resposta por comprimento, gênero gramatical ou formato.

## Tipos implementados

- ano de formação ou estreia de um grupo
- integrante associado a um grupo em uma data
- data ou local de nascimento de um integrante
- idade de uma pessoa em uma data explícita
- grupo associado a um integrante
- integrante associado a um grupo entre quatro alternativas
- grupo associado a uma gravadora que aparece em um único grupo aceito
- gravadora associada a um grupo que tem uma única gravadora aceita
- comparação cronológica entre quatro fatos

## Alternativas

Datas devem vir de fatos semelhantes e próximos no tempo. Pessoas devem respeitar o tipo de entidade e, quando útil, a mesma geração ou período. Números aleatórios sem relação com o catálogo criam pistas artificiais.

Perguntas de grupo para integrante excluem dos distratores todas as pessoas que outro fato aceito associa ao grupo. Na direção integrante para grupo, as alternativas omitem outros grupos aceitos para a mesma pessoa. Perguntas de gravadora para grupo entram no dataset somente quando os fatos aceitos ligam a gravadora a um grupo. A direção inversa exige uma única gravadora aceita para o grupo. Essas regras impedem duas respostas corretas entre as quatro alternativas.

## Rejeição

O sistema rejeita fatos sem fonte, datas incompatíveis, nomes ambíguos, intervalos abertos quando a pergunta exige duração e contagens baseadas em listas sem cobertura declarada. O relatório de rejeição é uma métrica do pipeline.

## Contrato JSON implementado

`quiz-generator-v3` lê somente fatos aceitos com evidência. Um conflito aberto para o mesmo valor de vínculo, ou para o mesmo predicado de valor único, retira o fato do conjunto elegível. A identidade do dataset é o SHA-256 do conteúdo canônico de fatos, evidências, entidades, templates e versões de política. IDs SQLite e horários de execução não entram no cálculo.

O dataset separa `logical_question_count` de `language_variant_count`. Uma pergunta lógica pode ter uma variante `pt-BR` e outra `en`. Os textos traduzem o enunciado e a explicação. Nomes próprios vêm dos labels e aliases preservados no banco.

Cada alternativa declara `value_type`. As quatro alternativas usam o mesmo tipo e têm valores, IDs e rótulos distintos. Datas concorrentes mantêm a mesma precisão. Comparações cronológicas não misturam precisão de ano, mês e dia.

Uma comparação cronológica usa um fato como resposta e as três datas posteriores mais próximas que tenham valores distintos. `fact_base_ids` contém os quatro fatos comparados. O gerador publica uma comparação por fato-resposta. Trocar apenas o conjunto de alternativas não cria outra pergunta lógica.

Sessões contêm dez perguntas. A configuração registra idioma, semente, tema, grupo, dificuldade e timer opcional. Os filtros são cumulativos. O comando falha se restarem menos de dez perguntas.

O tipo `member_at_date` exige `valid_from` e `valid_to` com precisão de dia nos dois lados do vínculo. Os intervalos devem coincidir e não podem ter `validity_not_evidenced`. Um vínculo sem `P582` continua disponível para `group_for_member`, cujo texto cita apenas a associação registrada. Ele não declara vínculo atual.

O relatório `kpop-quiz-generation-report-v2` separa contagens por template e predicado. Ele também informa perguntas lógicas, IDs factuais distintos e variantes por idioma.
