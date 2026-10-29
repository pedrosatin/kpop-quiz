# ADR 024. Cruzadinha diária e prova de atribuição única

## Status

Aceita. Geração offline desde 2026-10-22; integrada ao runner diário, à publicação e à página em 2026-10-29.

## Data

2026-10-21

## Contexto

O jogo publicado usa `crossword-pilot-v1` e um tabuleiro fixo auditado. A geração
diária precisa de histórico explícito, geometria verificável e limites de busca,
preservando o contrato publicado enquanto o runner ainda não a consome.

## Decisão

O novo contrato `crossword-daily-v1` contém data, seed, identidade da base factual,
contexto anterior, limites, contagem de tentativas e uma partida ou omissão
explícita. O checksum cobre todo esse conteúdo, inclusive proveniência. A mesma
base, data, seed, limites e QIDs anteriores geram bytes idênticos pelo escritor
canônico. QIDs anteriores são ordenados; não há partição do catálogo por data.

A comparação factual considera **todos os grupos canônicos da base**, antes do
corte de comprimento ou exclusão da véspera. A base inicial medida tem 567 QIDs.
Pistas usam integrante isolado ou formação + gravadora. As relações são
documentadas e podem ser históricas. Uma pista só é elegível quando a interseção
dos fatos aceitos com evidência e sem conflito aberto é exatamente seu QID.
O gerador e o validador recalculam essa interseção. A unicidade vale dentro da
base consultada; ausência de evidência não demonstra inexistência mundial.

Respostas usam o nome canônico normalizado pelo helper do piloto, preservando
dígitos. Aliases conflitantes impedem a coexistência na mesma partida, sem
excluir esses grupos globalmente. As grades têm 3 a 5 entradas e no máximo 9×9,
com cruzamentos conectados, origem mínima (0,0), entradas em ordem de posição e
numeração compartilhada por início. Toda sequência máxima de duas ou mais
células em qualquer direção deve corresponder a um slot declarado. Isso impede
adjacências e extensões acidentais. Nomes de uma célula continuam permitidos pelo
contrato de normalização e precisam participar dos cruzamentos declarados.

### O que constitui solução única

O jogador recebe **slots e pistas fixados**. O solver enumera atribuições de
(QID, resposta canônica normalizada) compatíveis com cada pista, comprimento e
cruzamentos, sem repetir QID. As letras da solução armazenada não restringem a
busca; servem apenas para obter o comprimento dos slots. Contamos até duas
atribuições: zero rejeita, uma aceita somente após esgotar a busca, duas refutam
unicidade. Não exigimos unicidade entre todos os layouts possíveis.

Cada pista já precisa de correspondência factual singleton. A enumeração torna
explícita e verificável a atribuição aos slots; não transforma ambiguidade factual
em pista aceitável por exclusão geométrica. O resultado registra nós e conclusão,
recalculados pelo validador. Esgotar o limite de nós interrompe a prova e rejeita
a tentativa; nunca produz `ready` com prova parcial.

### Histórico e falha

Nenhum grupo pode repetir em dias consecutivos. O contexto é um destes:

- `bootstrap`: primeira partida declarada, com a própria data e QIDs vazios;
- `played`: data exata da véspera e os 3 a 5 QIDs jogados;
- `omitted`: data exata da véspera, omissão confirmada e QIDs vazios.

Histórico ausente, data errada ou estado desconhecido impedem geração. Uma lista
explícita é uma declaração do chamador, cuja data e estrutura são verificadas;
o CLI não pode comprovar sozinho que ela representa a publicação real. Um
artefato anterior é validado contra a base fornecida antes de derivar o contexto.
Se a base mudou, o chamador precisa fornecer o contexto explícito preservado;
não há regeneração recursiva nem coleta automática para recuperar histórico.

O orçamento inicial é de 200 tentativas por data, com 5.000 nós de posicionamento
por tentativa e 10.000 nós de prova. Limites de nós, em vez de cortes pelo relógio,
preservam determinismo. O trabalho de cada nó é limitado pelo universo finito e
pelos limites de grade; o benchmark mede o tempo real separadamente. Esgotar as
tentativas produz `omitted`, com `puzzle: null`. A integração futura omitirá
**somente Cruzadinha** naquele dia. Não há garantia de evitar repetição em outras
janelas nem de gerar uma grade para toda base possível.

## Integração e histórico

O runner hoje preserva apenas `current/next`. Antes de integrar, a publicação
precisa manter um registro durável e datado por jogo, com estado, QIDs publicados,
checksum da partida e identidade da base. O registro deve acompanhar a mesma
transação de promoção que torna o manifest visível. Uma omissão também precisa
ser registrada. Preparar `next` não equivale a publicar uma partida.

A geração de D+1 deve consumir o registro confirmado de D ou a saída preparada de
D quando ambos pertencem à mesma promoção planejada e verificável. Retentativas
precisam reutilizar esse contexto, não inferir vazio de um arquivo ausente. Perda
de histórico exige recuperação de backup ou declaração explícita e auditável do
operador; não autoriza bootstrap automático. Esse armazenamento é local e
limitado por política de retenção futura; o algoritmo exige somente a véspera.
A publicação precisa impedir que um contexto preparado seja promovido se a
partida efetivamente publicada na véspera divergir.

### Implementação (2026-10-29)

- Cada conjunto publicado leva `crossword.daily.json` (quando há envelope) e
  `crossword-publication.<data>.json` (`kpop-crossword-publication-v1`), com
  estado, QIDs, checksum, identidade da base, contexto consumido e motivo da
  omissão. Os registros ficam em `web/public/data/`, versionados pelo cron como
  os demais dados, e não são podados; em `next/` vai só o registro do dia
  preparado, instalado no diretório principal na promoção.
- D é gerado do registro confirmado de D−1 no diretório principal; D+1, do
  registro de D produzido na mesma execução (inclusive em `--dry-run`).
- Registro ausente omite a cruzadinha do dia com motivo explícito. Não há
  bootstrap automático. A única derivação é para conjuntos anteriores à
  integração: enquanto o diretório não tem nenhum registro, um
  `crossword-pilot.json` válido vale como a partida jogada na véspera
  (`source: pilot`), porque era o tabuleiro servido todos os dias.
- Na promoção (e num dia mantido), se o contexto do registro diverge do
  registro confirmado de D−1, a grade é gerada de novo com o contexto
  confirmado, ou omitida; `next/` acompanha.
- A verificação de publicação recusa envelope sem registro correspondente e
  dois dias consecutivos jogados com grupo em comum, inclusive entre `data/` e
  `next/`. A página só joga a grade datada de hoje e informa a omissão; sem
  envelope, lê o registro do dia para dizer que a cruzadinha está
  indisponível em vez de atrasada.

## Consequências

O contrato `crossword-pilot-v1` continua válido para o tabuleiro auditado, que a página deixou de carregar. O benchmark
é uma medição offline, sem coleta. Metas iniciais de engenharia são pelo menos
50 grupos no maior componente por caracteres após a exclusão anterior e no
máximo três omissões entre 366 datas. Conectividade por caracteres é uma condição
necessária de vocabulário, não prova de encaixe. Resultados abaixo das metas devem
ser reportados sem reduzir as regras de evidência ou unicidade.
