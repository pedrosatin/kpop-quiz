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

## Hints de paráfrase

Perguntas sobre lançamentos aceitam um hint de uma frase com a ideia geral da faixa, sem citar letra ou tradução. O hint não entra nos fatos graduados. A resposta continua nos fatos `performed_by` ou `released_on` aceitos. O hint tem no máximo 140 caracteres, sem sequência de 3 ou mais palavras da letra, sem hooks, slogans ou nomes próprios inventados na música, e sem números de charts. O review log registra editor, data, fontes consultadas, busca exata com zero acertos, slide de 3-gramas sem sobreposição e segunda leitura. O hint só publica com zero acertos, zero sobreposições e aprovação registrada. Os hints seguem o versionamento do bundle de templates.

## Pistas de década

Uma pista de década só sai de fato `accepted` com evidência (revisão e localizador) e data com precisão de ano ou melhor.

- Perguntas cuja resposta é uma data ou uma idade (`formation_year`, `birth_date_or_place`, `age_on_date`, `release_year`) usam o fato da própria pergunta.
- Perguntas `group_for_member`, `group_for_record_label`, `group_for_release`, `member_for_group` e `release_for_group` usam o fato datado da entidade-resposta: formação do grupo, lançamento ou nascimento. A pista cita esse fato com a evidência dele, que não faz parte de `fact_base_ids` da pergunta. A validação exige evidência para cada fato citado.
  - Um cliente publicado antes desta regra rejeita a sessão inteira que traga uma pista assim, e lê `manifest-v2.json` a cada partida. Por isso `manifest-v2.json` só lista sessões cujas pistas citam fatos da própria pergunta (`validate_legacy_clues`: a publicação recusa e `--verify` falha se uma sessão listada ali violar). As sessões com pistas relacionadas ficam em `manifest-v3.json`, de mesmo formato, com os mesmos `session_id`, IDs de pergunta, alternativas e evidências das sessões do v2 (`validate_enrichment`); só `clues_available` e `clues_shown` mudam, uma pergunta que já tinha pista a mantém e o modo Especialista fica idêntico. O manifesto v3 sai apenas com `--related-clues` (o cron passa a opção quando a variável de repositório `QUIZ_RELATED_CLUES` é `true`). O cliente atual lê o v3 primeiro e volta ao v2 quando ele não existe ou não serve; o cliente antigo nunca o pede. Sem a opção, a saída é a anterior e o relatório conta o motivo `related_clues_not_enabled`.
- `chronological_comparison`, `earliest_release` e `record_label_for_group` não têm pista: o enunciado ou as alternativas já mostram datas, ou a resposta não tem data.
- A entidade-resposta precisa ter uma única década entre seus fatos datados aceitos. Uma alternativa só é descartada pela pista quando todos os fatos datados aceitos dela apontam outra década. Alternativa sem fato datado continua possível.
- A pista é rejeitada quando não descarta nenhuma alternativa (`clue_does_not_narrow_options`), quando deixa só a correta (`clue_would_isolate_answer`), quando a resposta não tem uma data aceita e inequívoca (`clue_answer_date_missing_or_ambiguous`) ou quando o texto repete o rótulo da resposta (`clue_text_repeats_answer`).
- Sem pista segura, a pergunta publica `clues_available: []`. Não se troca a resposta nem se cria outra pergunta para fabricar uma pista.

O relatório traz `clue_coverage` (perguntas e pistas por tipo e motivos de ausência: é a cobertura do banco gerado, não do que o jogador recebe). O publicador informa, por modo, quantas perguntas e sessões publicadas têm pista, separando o que o `manifest-v2.json` entrega a qualquer cliente do que o `manifest-v3.json` entrega ao cliente atual.

## Rejeição

O sistema rejeita fatos sem fonte, datas incompatíveis, nomes ambíguos, intervalos abertos quando a pergunta exige duração e contagens baseadas em listas sem cobertura declarada. O relatório de rejeição é uma métrica do pipeline.

## Contrato JSON implementado

`quiz-generator-v3` lê somente fatos aceitos com evidência. Um conflito aberto para o mesmo valor de vínculo, ou para o mesmo predicado de valor único, retira o fato do conjunto elegível. A identidade do dataset é o SHA-256 do conteúdo canônico de fatos, evidências, entidades, templates e versões de política. IDs SQLite e horários de execução não entram no cálculo.

O dataset separa `logical_question_count` de `language_variant_count`. Uma pergunta lógica pode ter uma variante `pt-BR` e outra `en`. Os textos traduzem o enunciado e a explicação. Nomes próprios vêm dos labels e aliases preservados no banco.

Cada alternativa declara `value_type`. As quatro alternativas usam o mesmo tipo e têm valores, IDs e rótulos distintos. Datas concorrentes mantêm a mesma precisão. Comparações cronológicas não misturam precisão de ano, mês e dia.

Uma comparação cronológica usa um fato como resposta e as três datas posteriores mais próximas que tenham valores distintos. `fact_base_ids` contém os quatro fatos comparados. O gerador publica uma comparação por fato-resposta. Trocar apenas o conjunto de alternativas não cria outra pergunta lógica.

Sessões contêm dez perguntas. A configuração registra idioma, semente, tema, grupo, dificuldade e timer opcional. Os filtros são cumulativos. O comando falha se restarem menos de dez perguntas.

O tipo `member_at_date` exige `valid_from` e `valid_to` com precisão de dia nos dois lados do vínculo. Os intervalos devem coincidir e não podem ter `validity_not_evidenced`. Um vínculo sem `P582` continua disponível para `group_for_member`, cujo texto cita apenas a associação registrada. Ele não declara vínculo atual.

O relatório `kpop-quiz-generation-report-v4` separa contagens por template e predicado. Ele também informa perguntas lógicas, IDs factuais distintos e variantes por idioma.
