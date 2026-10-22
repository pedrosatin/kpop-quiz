# Medição offline da Cruzadinha diária

Execução local em 2026-10-22, Python 3.14.8, usando uma única base e a seed
`daily-v1`. Janela inclusiva: **2026-10-21 a 2027-10-21 (366 datas)**.
A primeira data usou bootstrap explícito. Cada saída validada forneceu o
contexto da data seguinte; os artefatos e logs operacionais ficaram em
`.scratch/`, fora do Git. Comando reproduzível no [guia](crossword-daily.md).

| Medida | Resultado |
| --- | ---: |
| Universo factual antes do corte de comprimento | 567 grupos |
| Grupos elegíveis antes da exclusão da véspera | 136 |
| Pistas nos dois formatos suportados, antes da exclusão | 439 |
| Menor número de elegíveis após exclusão | 131 |
| Menor componente conectado por caracteres após exclusão | 131 |
| Partidas geradas e validadas, com atribuição única provada | 366 |
| Datas sem grade | 0 (0%) |
| Interseções não vazias entre QIDs de dias consecutivos | 0 |
| Tentativas totais | 368 |
| Tentativas rejeitadas por posicionamento | 2 (0,5435% das tentativas) |
| Tentativas rejeitadas por orçamento ou validação | 0 |
| Maior número de tentativas em uma data | 2 |
| Partidas com 3 / 4 / 5 entradas | 112 / 111 / 143 |
| QIDs distintos usados na janela | 136 |
| Nós por prova de atribuição | 4 a 6 |
| Tempo total do benchmark, incluindo validação e escrita | 24,576 s |
| Maior tempo diário medido, antes de derivar o contexto seguinte | 0,084 s |

Os limites foram 200 tentativas por data, 5.000 nós de posicionamento por tentativa
e 10.000 nós de prova. A medição atende aos alvos iniciais de pelo menos 50 grupos
conectados após exclusão e no máximo três datas sem grade. Cada artefato foi
validado contra a base, com recálculo das correspondências factuais, geometria e
prova. Reexecutar pela CLI as duas primeiras datas, uma com bootstrap e outra
com artefato anterior, produziu bytes idênticos aos do benchmark.

Identidade da base factual:
`7d4ab01c99178b2dd7b0faa7888d5a1393038708344da98e925abd918901178f`.
SHA-256 do SQLite, idêntico antes e depois:
`3c7cae0de8f8f7e1b54ef642379ebe4e2eea744aebac0b9a4574189886a1f04d`.
A leitura foi somente leitura, sem coleta de rede.

Esta é uma medição em uma base e uma seed, não uma garantia para bases futuras
ou todas as seeds. A comparação factual cobre os grupos presentes nessa base;
ausência de evidência não prova inexistência mundial. A prova enumera respostas
para slots e pistas fixados, conforme a [ADR 024](decisions/024-cruzadinha-diaria-e-unicidade.md).
O runner, o histórico de publicação, o publicador e o web ainda não consomem o
contrato diário. O artefato fixo publicado permanece intacto.
