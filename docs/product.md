# Visão do produto

## Estado deste documento

Direção do primeiro lançamento confirmada em 12 de setembro de 2026. O produto atenderá jogadores com níveis diferentes de conhecimento, começará em português e inglês e usará múltipla escolha. As métricas que decidirão a expansão após o MVP serão definidas com os dados de analytics descritos no [Roadmap](roadmap.md).

A proposta completa está em [Plataforma de quizzes de K-pop](ideas/kpop-quiz-platform.md).

## Problema

Como criar quizzes de K-pop para pessoas com níveis diferentes de conhecimento, em português e inglês, mantendo cada resposta ligada à revisão da fonte que a sustenta?

## Direção recomendada

O produto será um jogo de conhecimento apoiado por uma base própria de afirmações citáveis. O volume de perguntas virá da combinação entre entidades, períodos, relações e templates de quiz. O sistema só publica uma pergunta quando consegue determinar resposta, precisão temporal, alternativas plausíveis, tradução e evidência.

A primeira entrega deve provar o fluxo completo com poucos tipos de fato. Grupos, membros, formação, estreia, nascimento, local de nascimento e vínculo de membro cobrem perguntas de datas, idades em uma data específica, lugares e composição de grupos.

## Público

- jogadores casuais, fãs recorrentes e fãs especializados
- pessoas que leem português ou inglês
- pessoas que querem testar conhecimento em sessões curtas
- editores do catálogo que precisam auditar respostas e fontes

Os quizzes terão tema e dificuldade. O produto não assume um único nível de conhecimento.

## Hipóteses a validar

- Jogadores valorizam explicação e fonte. Teste com cinco pessoas e registre a abertura do link de evidência.
- Seis tipos de pergunta sustentam uma sessão. Gere ao menos 100 perguntas aceitas e teste sessões de dez perguntas.
- Wikipedia e Wikidata cobrem grupos e membros para o MVP. Meça cobertura, conflitos e rejeições em 30 grupos.
- Textos em português e inglês podem usar fontes em outro idioma sem alterar o sentido do fato. Faça revisão editorial de 50 perguntas por idioma.
- Os níveis iniciante, intermediário e especialista correspondem à percepção dos jogadores. Teste com pessoas que tenham familiaridade diferente com K-pop.

## Escopo do MVP

- catálogo validado de grupos e membros
- fatos de formação, estreia, nascimento, local de nascimento e período de vínculo
- português e inglês
- quizzes de múltipla escolha com quatro alternativas e dez perguntas
- níveis iniciante, intermediário e especialista
- filtros por tema e grupo
- timer opcional por sessão
- resposta explicada com fonte e data de consulta
- geração determinística a partir de uma versão dos dados
- relatório de cobertura e rejeições

## Fora do MVP

- contas, ranking global e competição em tempo real, pois não testam a qualidade do conteúdo
- campo aberto, pois aliases e equivalência entre idiomas exigem regras próprias
- fotos, até cada arquivo ter licença e atribuição registradas
- letras reais, até existir uma fonte licenciada para armazenamento e exibição
- mapas, até lugares e geometrias usarem identificadores e licenças verificadas
- criação comunitária, pois exige autenticação, moderação e revisão editorial
- perguntas livres geradas por LLM em produção, pois dificultam reprodução e auditoria
- shows, locais e contagem anual, pois exigem uma fonte com cobertura definida
- atualização em tempo real, pois uma coleta agendada atende fatos históricos
- aplicativo móvel nativo, pois uma página responsiva cobre o primeiro teste

## Perguntas abertas

- Qual métrica decide continuar após o MVP?
- Como a aplicação calculará a dificuldade de cada pergunta?
- Haverá revisão editorial antes da publicação ou somente regras automáticas?
- Quais licenças de imagem serão aceitas?
- Qual provedor poderá licenciar letras para os países atendidos?
