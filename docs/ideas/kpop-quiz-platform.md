# Plataforma de quizzes de K-pop

## Problema

Como criar quizzes de K-pop para pessoas com níveis diferentes de conhecimento, em português e inglês, usando fatos verificáveis e respostas ligadas às fontes?

## Direção recomendada

O produto terá um catálogo de grupos, pessoas, lançamentos, eventos, lugares e relações. Um motor de quiz aplicará templates versionados sobre fatos aceitos. A primeira versão usará múltipla escolha. Outros formatos reutilizarão o mesmo catálogo em versões posteriores.

Os quizzes serão classificados por tema e dificuldade. Isso permite atender jogadores casuais e fãs especializados sem assumir um único público. Cada pergunta terá idioma, resposta tipada, alternativas plausíveis, explicação, data de referência e evidência.

Conteúdo, mídia e mecânica serão independentes. O catálogo guardará fatos e relações. A biblioteca de mídia guardará arquivos e licenças. O motor de quiz produzirá múltipla escolha, campo aberto, mapas, imagens, linhas do tempo e outros formatos conforme cada versão do produto.

## Hipóteses a validar

- [ ] O catálogo inicial gera ao menos 100 perguntas aceitas sobre 30 grupos sem repetição excessiva.
- [ ] Três níveis de dificuldade correspondem à percepção dos jogadores. O teste deve incluir pessoas com familiaridade diferente com K-pop.
- [ ] Textos em português e inglês preservam nomes, datas, categorias e contexto. Uma revisão editorial deve avaliar 50 perguntas por idioma.
- [ ] Uma sessão de dez perguntas tem duração adequada com e sem timer.
- [ ] Explicações e links de evidência ajudam o jogador após um erro. O teste deve registrar quantas pessoas abrem a fonte.

## Escopo do MVP

- catálogo validado de grupos e integrantes;
- fatos de formação, estreia, nascimento, local de nascimento e vínculo de integrante;
- português e inglês;
- múltipla escolha com quatro alternativas;
- sessões de dez perguntas;
- níveis iniciante, intermediário e especialista;
- filtros por tema e grupo;
- timer opcional por sessão;
- explicação e link da revisão usada como fonte;
- geração determinística por versão dos dados, versão do template e semente;
- relatório de cobertura, conflitos e rejeições.

## Formatos posteriores

- campo aberto com aliases, tolerância a acentos e romanizações;
- identificação de integrante ou grupo por foto;
- pistas com trechos de letras obtidos de um provedor licenciado;
- mapas de turnês, locais de nascimento e países visitados;
- linhas do tempo interativas;
- associação entre duas colunas;
- grades para completar formações e discografias;
- modo sobrevivência e desafio diário;
- criação comunitária com revisão editorial.

## Fora do MVP

- Letras reais ficam fora até o projeto contratar ou integrar uma fonte que permita exibição e armazenamento dos trechos.
- Fotos ficam fora até a biblioteca de mídia registrar autor, origem, licença, atribuição e condições de modificação por arquivo.
- Campo aberto fica para outra versão porque exige aliases, normalização e regras de equivalência entre idiomas.
- Mapas dependem de lugares normalizados e geometrias com licença compatível.
- Contas, ranking e criação comunitária adicionam autenticação, moderação e novas regras editoriais antes de validarmos o conteúdo.
- Perguntas escritas livremente por LLM não serão publicadas. LLMs podem sugerir traduções ou candidatos, sujeitos às mesmas validações dos demais dados.

## Dados previstos

O catálogo poderá crescer por famílias:

- grupos, aliases, origem, atividade, gravadoras, integrantes, subunits e estado;
- pessoas, nomes, nascimento, cidadania, idiomas, educação, instrumentos, vínculos e carreira solo;
- álbuns, EPs, singles, faixas, datas, idiomas, compositores, produtores, charts, vendas e certificações;
- turnês, apresentações, cidades, países, locais, público, receita, cancelamentos e músicas apresentadas;
- cerimônias, categorias, indicados, obras e resultados;
- videoclipes, diretores, duração, filmes, programas e papéis;
- hiatos, comebacks, mudanças de formação, contratos, serviço militar, reuniões e dissoluções.

Idade, duração, contagens e ordens cronológicas serão valores derivados. Cada derivação guardará fórmula, data de referência, fatos de entrada e declaração de cobertura quando a resposta depender de uma lista completa.

## Questões abertas

- Qual métrica determina se o MVP deve avançar para novos formatos?
- Como calcular dificuldade a partir de popularidade, taxa histórica de acerto e complexidade do fato?
- Quais perguntas exigirão revisão editorial antes da publicação?
- Qual provedor poderá licenciar letras para os países atendidos?
- Quais licenças de imagem serão aceitas pela aplicação?
