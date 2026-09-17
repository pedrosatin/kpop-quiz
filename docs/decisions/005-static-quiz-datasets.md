# ADR 005 sobre datasets estáticos de quiz

## Status

Aprovada em 2026-09-13.

## Contexto

A primeira versão do produto precisa de perguntas de múltipla escolha em português e inglês. A fonte local contém fatos com estados, evidências e precisão temporal. O mesmo banco também preserva fatos rejeitados e conflitos para auditoria. O arquivo publicado não pode depender da ordem de inserção no SQLite nem do horário em que o comando rodou.

## Decisão

### Geração separada da coleta

`python -m kpop_scraping.quiz_cli` abre um banco existente em modo de leitura e grava três artefatos possíveis: dataset, relatório e sessão. O gerador não chama Wikipedia ou Wikidata. Uma mudança na coleta passa primeiro pela validação da Fatia 3.

O dataset e a sessão usam schemas separados. O código valida o objeto antes da escrita. A gravação cria um arquivo temporário no diretório de destino, chama `fsync` e troca o destino com `os.replace`.

### Identidade de conteúdo

`dataset_version` é o SHA-256 de JSON canônico. A entrada contém fatos, estados, evidências, nomes, templates, data de referência e versões do gerador, schema e política de fontes. Consultas ordenam os registros por identidades externas. IDs autoincrementais e datas de execução ficam fora do hash.

Uma pergunta lógica tem um `logical_id`, um `semantic_id` e uma lista `fact_base_ids`. O `semantic_id` combina o tipo da pergunta com os fatos que sustentam a resposta. Cada idioma recebe outro `id`, derivado do `logical_id` e do código do idioma. O relatório conta perguntas lógicas, IDs factuais distintos e variantes de idioma em campos diferentes.

### Elegibilidade temporal

Perguntas de idade usam somente `born_on` com precisão de dia. O cálculo recebe uma data de referência explícita. Perguntas sobre integrante em uma data exigem limites inicial e final com precisão de dia nos dois lados da relação. Os limites precisam coincidir e ter evidência de validade. A falta de `P582` não autoriza uma afirmação sobre o presente.

`group_for_member` informa que a fonte associa a pessoa ao grupo. O texto não usa "atual". Esse tipo aceita vínculos sem intervalo porque não faz uma afirmação temporal.

### Alternativas e comparações

Cada pergunta tem quatro valores distintos com um único `value_type`. Datas concorrentes têm a mesma precisão. O gerador escolhe anos e datas próximos dentro dos fatos elegíveis. Pessoas e grupos vêm de entidades ligadas a fatos elegíveis.

Perguntas de grupo para integrante usam uma afirmação `has_member` como base. O gerador exclui dos distratores todas as pessoas associadas ao grupo por outro fato aceito. Na direção integrante para grupo, o gerador exclui outros grupos aceitos para a mesma pessoa. Perguntas reversas de gravadora para grupo exigem que uma única entidade de grupo esteja associada à gravadora nos fatos aceitos. Perguntas de grupo para gravadora exigem uma única gravadora aceita para o grupo.

Comparações cronológicas usam quatro fatos com a mesma precisão. `fact_base_ids` contém os quatro IDs porque a comparação depende de todas as datas. O fato mais antigo define a resposta. As três datas posteriores mais próximas formam as alternativas. Cada fato aparece como resposta em no máximo uma comparação de seu tipo. Recombinar a mesma resposta com outras alternativas não cria outra pergunta lógica.

### Sessões

Uma sessão aplica idioma, tema, grupo e dificuldade. Um hash da semente, da versão do dataset e do ID da pergunta define a seleção. Outro hash ordena as alternativas. A validação exige dez `semantic_id` distintos. A sessão falha quando os filtros deixam menos de dez perguntas. O timer opcional fica salvo na configuração e não altera os fatos do dataset.

## Alternativas consideradas

### Persistir perguntas no SQLite

Essa opção exigiria migração, invalidação e limpeza de linhas. O JSON já é o contrato de publicação e pode ser recriado a partir dos fatos. A implementação não adiciona tabelas nesta fatia.

### Usar IDs SQLite na versão

Duas bases com o mesmo conteúdo poderiam produzir versões diferentes por causa da ordem de inserção. A identidade usa QIDs, IDs de afirmação, revisões e localizadores.

### Preencher datas ausentes

Essa opção aumentaria a quantidade de perguntas de integrantes. Ela transformaria ausência de qualificador em vínculo atual. O gerador registra `membership_interval_not_eligible` e mantém o tipo sem perguntas até haver evidência temporal.

## Consequências

- O frontend pode servir arquivos estáticos sem acesso ao banco.
- Uma alteração em evidência, estado, nome ou template muda `dataset_version`.
- PT-BR e inglês compartilham a mesma pergunta lógica e preservam nomes próprios.
- A amostra de 30 grupos gera 107 perguntas lógicas sobre 84 fatos-base e 214 variantes de idioma.
- O relatório separa contagens por template e predicado.
- O número de perguntas por tipo depende da cobertura da Fatia 3. O relatório registra tipos com zero perguntas.
