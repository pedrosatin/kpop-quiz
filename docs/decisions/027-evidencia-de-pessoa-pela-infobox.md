# ADR 027 sobre evidência de pessoa pela infobox da própria página

## Status

Aprovado em 2026-10-29. Altera a regra de atributos de pessoa da [ADR-004](004-wikidata-facts-and-evidence.md), repetida na [ADR-019](019-evidencia-da-infobox.md), apenas para `born_on` e `born_in`.

## Contexto

A ADR-004 aceita atributos de pessoa somente com referência confiável do Wikidata, porque o projeto não coletava páginas de pessoas e a página do grupo não comprova esses atributos. No banco de 19 de outubro de 2026, 843 fatos `born_on` e 926 `born_in` estavam rejeitados por `missing_evidence` (1.091 pessoas), e só 2% das datas de nascimento estavam aceitas. Isso bloqueia perguntas de idade, décadas e distratores de pessoa.

Uma medição sobre 100 pessoas sorteadas entre as 636 rejeitadas com sitelink `enwiki` (ordem `sha256` de semente fixa, 7 requisições, revisões de 19 de outubro de 2026) mostrou:

- 88 títulos levavam à página da própria pessoa; 12 redirecionavam para a página do grupo, cuja infobox traz `origin = [[Seoul]]` e casaria com o local de nascimento por coincidência.
- Nas 88 páginas próprias, a primeira infobox é `Infobox person` (83) ou `Infobox musical artist` (5) e confirmou por igualdade exata 50 de 52 datas e 68 de 80 locais. Houve 1 data e 9 locais divergentes e 3 campos vazios ou ausentes. A conferência manual dos 118 aceitos não achou valor errado.
- Resumo, corpo e categorias erram mais: a regra de frase no corpo aceita "grew up in Goyang" e "raised in Incheon" como nascimento, e as categorias "Musicians from X" não afirmam nascimento. O resumo não acrescenta nada à infobox para datas e quase nunca cita o local.
- Cinco divergências são conflitos reais (1 data, 4 locais). Em duas delas o Wikidata parece ter registrado o lugar onde a pessoa cresceu.

A reaplicação da regra implementada às mesmas 100 páginas dá 50 datas e 68 locais aceitos, 1 data e 9 locais divergentes, 1 local ambíguo e 3 campos sem veredito.

## Decisão

### Fonte única

`born_on` e `born_in` podem ser provados pela primeira infobox da página da própria pessoa na Wikipedia em inglês, nos campos `birth_date` e `birth_place`. A primeira infobox da página, de qualquer tipo, precisa ser `Infobox person` ou `Infobox musical artist`; se for de outro tipo, a página não prova nada, mesmo que uma infobox posterior seja de pessoa. Infoboxes dentro de comentário ou `<nowiki>` não existem para o parser. Resumo, corpo do wikitext, categorias, outros campos da infobox e página de grupo não provam atributo de pessoa. Os demais atributos (`citizenship`, `speaks_language`, `plays_instrument`) continuam exigindo referência do Wikidata, e `member_of` continua como na ADR-004.

A referência confiável do Wikidata continua tendo prioridade. A infobox só é consultada quando nenhuma referência sustenta o fato. Um fato aceito por referência não é rebaixado por divergência da infobox.

### Identidade da página

A página só serve de evidência quando o título do sitelink `enwiki` do Wikidata resolve sem redirecionamento, a página não é de desambiguação, `pageprops.wikibase_item` é igual ao QID da pessoa (o QID resolvido, quando a entidade foi redirecionada) e o wikitext da revisão foi obtido. O validador confere de novo `wikibase_item` e o indicador de redirecionamento antes de ler a infobox. Falhando qualquer condição, a página não prova nem contradiz, e o fato mantém o motivo anterior (`missing_evidence`, `unreliable_reference_source` ou `unreviewed_reference_source`).

### Equivalência

Data (`birth_date`). O campo precisa conter uma só data, lida de um destes modos: template `birth date`, `birth date and age`, `bda` ou `dob` com ano, mês e dia numéricos e uma data civil válida (as opções `df` e `mf` são ignoradas), ou data escrita por extenso (`March 9, 1989`, `9 March 1989`, `1989-03-09`, com ou sem links), com nota final entre parênteses, referência, comentário e tag de quebra fora da conta. Com precisão de dia no Wikidata, ano, mês e dia precisam ser iguais. Com precisão de ano, só o ano é comparado. Outras precisões e outros calendários ficam sem veredito: o gate não as cobre.

Local (`birth_place`). O campo é dividido em itens pela regra da ADR-019. Um item prova o valor quando é o próprio valor: alvo ou texto de um link, ou texto simples, igual (sem diferenciar maiúsculas) ao nome ou a um alias em inglês ou português do lugar, ou a uma romanização. Um nome contido num item maior não prova nada. Quando o item que casa não é o primeiro, o valor do Wikidata é mais grosseiro que a infobox e a evidência recebe a marca `coarse_place` (por exemplo, país no Wikidata e cidade e país na infobox).

### Rejeições

- `wikipedia_value_differs`: o campo é legível e afirma outra data ou outros lugares. Vale também quando o Wikidata é mais fino que a infobox (`Seongbuk District` contra `Seoul, South Korea`). O fato fica `rejected`, nunca aceito.
- `wikipedia_value_ambiguous`: o campo tem texto, mas não permite concluir sem adivinhar: data parcial, duas datas, template desconhecido, data impossível, item com texto além do link, ou item que só qualifica o valor (`Nam District, Busan` contra `Nam District`).
- Campo ausente ou vazio, e precisões fora do gate, não geram rejeição nova.

Nos dois casos o texto lido na infobox e o localizador ficam em `fact_issues` (código igual ao motivo, detalhe com o ID da afirmação, o trecho e o localizador), para o operador decidir se o problema está no Wikidata. Esse trecho não é evidência e não entra em `fact_evidence`.

### Localizador

`wikipedia:en:pageid=<pageid>:revid=<revid>#wikitext[início:fim]`, em pontos de código Unicode do wikitext da revisão. Para data, o intervalo é o do template ou do texto da data. Para local, é o do item. Referências e comentários que seguem o valor ficam fora do intervalo. `fact_evidence.snippet` guarda o campo e o valor, como `birth_date = {{Birth date and age|1993|1|12}}`.

### Coleta

Na extração de fatos, para cada pessoa com `born_on` ou `born_in` sem referência confiável e com sitelink `enwiki`, o pipeline resolve o título (lotes de 20, em sequência, com `maxlag`), guarda a revisão como snapshot imutável (ADR-002) em `source_pages` e `source_revisions` sem criar entrada de catálogo, e baixa o wikitext em lotes de 50 para `source_revision_wikitext` (ADR-019). Revisões já guardadas não são baixadas de novo. A migração 10 cria `person_source_pages`, uma linha por pessoa com a revisão mantida ou o motivo da recusa (`page_missing`, `page_redirect`, `page_disambiguation`, `page_wikidata_mismatch`, `wikitext_unavailable`). A execução só coleta quando recebe um cliente de pessoa; `python main.py --facts` passa a fornecê-lo. O resumo da página é guardado pelo snapshot da revisão, mas o validador recebe a página sem resumo.

`EVIDENCE_RULES_VERSION` passa a `text-evidence-v7` e `EXTRACTOR_VERSION` a `wikidata-facts-v3`. `SOURCE_POLICY_VERSION` não muda: nenhuma origem de referência foi reclassificada.

### Rastro

Coleta (`collection_runs`, `person_source_pages`, `source_revisions`) → fato (`facts.status`, `status_reason`, `quality_flags_json`; `fact_issues` para divergência e ambiguidade) → evidência (`fact_evidence` com `source_revision_id` e `#wikitext[...]`) → consumo (`quiz_repository` monta a URL `curid=<pageid>&oldid=<revid>` da revisão da pessoa) → artefato (`evidence` e a versão do conjunto de dados). Uma nova revisão da página cria outro snapshot e a evidência passa a apontar para ela; os snapshots anteriores permanecem.

## Alternativas consideradas

### Resumo e corpo do wikitext

Rejeitada. O resumo não acrescenta cobertura. O corpo acrescenta 5 aceitos de local, dos quais 1 está errado e 1 é ambíguo, por regras de frase que confundem onde a pessoa cresceu com onde nasceu.

### Categorias e página do grupo

Rejeitada. "Musicians from X" não afirma nascimento, e `origin = [[Seoul]]` do grupo descreve o grupo.

### Aceitar divergência quando o Wikidata é mais fino

Rejeitada. Sem a hierarquia `P131` o sistema não sabe se `Seoul` contém `Seongbuk District`, e a mesma regra aceitaria os dois casos em que o Wikidata erra o lugar de nascimento.

### Outras Wikipedias

Fora do escopo. A kowiki usa outra infobox e outro formato de data, e 455 das 1.091 pessoas não têm `enwiki`.

## Licença, atribuição e limites

- O wikitext da Wikipedia é CC BY-SA 4.0. O projeto guarda o trecho citado, o `pageid` e o `revid`. Qualquer exibição mantém o link da revisão (`oldid`), que dá acesso ao histórico de autores. O Wikidata continua CC0.
- Requisições à Wikipedia seguem as invariantes do projeto: sequenciais, `maxlag`, timeout e `User-Agent` identificável.
- Cobertura: só pessoas com sitelink `enwiki` (cerca de 58% das rejeitadas), primeira infobox de pessoa, `birth_date` com precisão de dia ou ano e `birth_place` por igualdade de item inteiro. Romanizações diferentes do mesmo lugar não casam.
- Aliases curtos ou históricos do Wikidata (`Silla` para a Coreia do Sul) valem como nome do lugar quando o item inteiro é igual a eles.
- Dois lugares diferentes com o mesmo nome em texto simples continuam indistinguíveis. A regra rejeita o item qualificado, mas aceita o item igual ao alias.

## Consequências

- Esta ADR e a mudança de código não reprocessam o banco nem publicam dados. A próxima extração completa coleta cerca de 45 requisições para as pessoas com `enwiki` e muda o estado de fatos já gravados. A auditoria editorial por amostra e o reprocessamento ficam para a fatia seguinte, antes de qualquer fato novo chegar a um puzzle publicado.
- O critério de aceite do reprocessamento: pelo menos 50% dos `born_on` e `born_in` hoje rejeitados de pessoas com `enwiki` passam a aceitos; a auditoria de 30 fatos aceitos por predicado aceita zero erros em `born_on` e no máximo um em `born_in`; todo fato rejeitado por divergência aparece com o trecho da infobox.
- Fatos aceitos pela infobox deixam de ser aceitos se uma revisão posterior da página mudar o campo, porque a validação é refeita a cada execução. A revisão antiga permanece guardada.
- `born_in` ainda não é predicado do gerador de quizzes; `born_on` é, e perguntas de idade exigem a precisão de dia.
