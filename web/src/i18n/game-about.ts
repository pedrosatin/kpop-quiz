import type { Locale } from "../lib/quiz-types";

// Static copy rendered under each game (GameAbout.astro), so the served HTML
// explains the game, its sources and the FAQ before any island loads. Facts
// here must match the code: the 15:00 UTC cron in daily-puzzles-cron.yml, the
// Sao Paulo midnight switch in daily-artifact.ts, the generators under
// kpop_scraping/ (connections_generator.py, name_guess_generator.py,
// timeline_generator.py, word_search_generator.py, map_pilot_refresh.py) and
// the map refresh workflow. Headings carry the game name, so each route gets
// its own H2s and most FAQ entries; one generic entry per game stays.

export type GameAboutKey = "grid" | "connections" | "nameGuess" | "wordSearch" | "mapPilot" | "timeline";

export interface GameAboutFaq {
  question: string;
  answer: string;
}

export interface GameAboutCopy {
  howToPlayHeading: string;
  dataSourcesHeading: string;
  faqHeading: string;
  howToPlay: string[];
  dataSources: string[];
  faq: GameAboutFaq[];
}

export interface GameAboutMessages {
  games: Record<GameAboutKey, GameAboutCopy>;
}

// Generic FAQ entries: each game keeps exactly one, and the choice rotates so
// no single entry repeats on every route.
const PT_FREE =
  "Sim. Todos os jogos do K-pop Quiz são gratuitos e rodam no navegador, no celular ou no computador, sem instalar nada.";
const PT_ACCOUNT =
  "Não. O site não tem cadastro nem login. A sequência de dias e as estatísticas ficam guardadas no próprio navegador. Para levar esses números a outro aparelho, use as opções de exportar e importar na janela de estatísticas.";
const ptLanguages = (enPath: string) =>
  `Em português e em inglês. O link English no topo da página abre a versão em inglês, em kpopquiz.online${enPath}, com o mesmo desafio do dia.`;

const EN_FREE =
  "Yes. Every game on K-pop Quiz is free and runs in the browser on a phone or a computer. There is nothing to install.";
const EN_ACCOUNT =
  "No. There is no sign-up and no login. Your streak and stats are saved in your browser. To move them to another device, use export and import in the stats window.";
const enLanguages = (ptPath: string) =>
  `English and Brazilian Portuguese. The Português link at the top of the page opens the Portuguese version at kpopquiz.online${ptPath}, with the same daily puzzle.`;

export const gameAbout: Record<Locale, GameAboutMessages> = {
  "pt-BR": {
    games: {
      grid: {
        howToPlayHeading: "Como jogar a Grade de interseções de K-pop",
        dataSourcesHeading: "De onde vêm os dados da Grade de interseções de K-pop",
        faqHeading: "Perguntas sobre a Grade de interseções de K-pop",
        howToPlay: [
          "A grade tem 3 linhas e 3 colunas. Cada linha e cada coluna traz um critério sobre grupos de K-pop, como a agência, a década de estreia ou o número de integrantes. Em cada uma das 9 casas, o grupo escolhido precisa atender ao critério da linha e ao da coluna.",
          "São 9 palpites para as 9 casas, e um palpite errado também conta. Cada grupo vale para uma casa só. Quando um nome serve em mais de um cruzamento, guarde-o para a casa com menos opções. A busca lista apenas os grupos do catálogo do jogo, então a grafia ou a romanização do nome não atrapalha.",
          "No fim, a tela de respostas mostra os grupos aceitos em cada casa e a fonte de cada critério.",
        ],
        dataSources: [
          "Os critérios saem da data de formação, da gravadora e da lista de integrantes de cada grupo. A contagem de integrantes só vale quando todos os integrantes atuais do grupo têm fonte aceita. Se algum estiver em disputa, o grupo fica fora dos critérios de contagem. O gerador descarta grades com alguma casa sem resposta válida e nunca usa a mesma categoria de critério nas linhas e nas colunas.",
          "Um programa consulta a Wikipédia e o Wikidata, guarda a revisão de cada página lida e registra de onde saiu cada fato. Um fato só entra nos jogos quando aponta para uma referência no Wikidata ou para um trecho de uma revisão específica da Wikipédia.",
          "Todo dia às 15:00 UTC, meio-dia em Brasília, um processo automático atualiza a base e monta os jogos do dia seguinte. Cada arquivo passa por uma checagem de formato, e nada vai ao ar se algum falhar.",
        ],
        faq: [
          {
            question: "Por que meu grupo não foi aceito?",
            answer:
              "A casa aceita só quem atende ao critério da linha e ao da coluna ao mesmo tempo. Se o grupo aparece na busca mas não fecha a casa, ele falha em um dos dois critérios. Um grupo que já fechou outra casa também sai da disputa, porque cada grupo vale para uma casa só.",
          },
          { question: "Preciso criar uma conta?", answer: PT_ACCOUNT },
          {
            question: "O jogo muda todo dia?",
            answer:
              "Sim. A grade nova entra no ar à meia-noite no horário de Brasília (03:00 UTC), e todo mundo recebe a mesma grade naquele dia. Se o gerador não conseguir montar uma grade válida, o site repete a grade anterior, desde que ela continue válida.",
          },
        ],
      },
      connections: {
        howToPlayHeading: "Como jogar Conexões de K-pop",
        dataSourcesHeading: "De onde vêm os dados das Conexões de K-pop",
        faqHeading: "Perguntas sobre Conexões de K-pop",
        howToPlay: [
          "O tabuleiro traz 16 nomes de grupos de K-pop. Eles formam 4 categorias de 4 nomes, e cada nome pertence a uma categoria só. Selecione 4 nomes que tenham algo em comum e envie. Se acertar, a categoria sai do tabuleiro e o critério aparece.",
          "Você pode errar 4 vezes. Quando 3 dos 4 nomes escolhidos são da mesma categoria, o jogo avisa que faltou um. O botão Embaralhar muda a posição dos nomes, o que ajuda a enxergar outras combinações. Amarelo marca a categoria mais fácil e roxo, a mais difícil. No fim, o resultado para compartilhar mostra quantas categorias você fechou e quantos erros fez, sem entregar as categorias.",
        ],
        dataSources: [
          "As categorias agrupam os nomes pela gravadora ou agência, pela década de formação ou pelo número de integrantes. O gerador só publica tabuleiros em que a separação em 4 grupos de 4 é única. A ordem de dificuldade sai da quantidade de nomes de fora que poderiam se confundir com cada categoria.",
          "Os fatos vêm da Wikipédia e do Wikidata, consultadas por um programa que guarda a revisão de cada página e a origem de cada afirmação. A base é atualizada todo dia às 15:00 UTC, meio-dia em Brasília, e o tabuleiro do dia seguinte só vai ao ar depois de passar na checagem de formato.",
        ],
        faq: [
          {
            question: "Por que um nome parece caber em dois grupos?",
            answer:
              "Um nome pode combinar com mais de uma categoria, mas só uma divisão fecha os 4 grupos. Se houver duas divisões possíveis, o tabuleiro é descartado.",
          },
          {
            question: "Todo mundo recebe o mesmo tabuleiro?",
            answer:
              "Sim. O tabuleiro muda à meia-noite no horário de Brasília (03:00 UTC) e é o mesmo para todos os jogadores do dia, então o resultado compartilhado pode ser comparado.",
          },
          { question: "O jogo é grátis?", answer: PT_FREE },
        ],
      },
      nameGuess: {
        howToPlayHeading: "Como jogar o Wordle de K-pop",
        dataSourcesHeading: "De onde vêm os dados do Wordle de K-pop",
        faqHeading: "Perguntas sobre o Wordle de K-pop",
        howToPlay: [
          "O jogo funciona como um Wordle de K-pop. A resposta é o nome de um artista ou grupo, com 3 a 10 letras, e você tem 6 palpites. O número de casas na tela mostra o tamanho do nome. Espaços e símbolos ficam de fora, então (G)I-DLE vira GIDLE e LE SSERAFIM vira LESSERAFIM.",
          "Depois de cada palpite, as letras mudam de cor. Verde indica a letra certa na posição certa. Amarelo indica que a letra está no nome em outra posição, e cinza indica que ela não aparece. O palpite precisa estar na lista de nomes aceitos. Se não estiver, o jogo avisa e a tentativa não conta. Com as cores de alto contraste, azul e laranja substituem o verde e o amarelo.",
        ],
        dataSources: [
          "O nome do dia sai dos artistas e grupos do catálogo que têm ao menos um fato com fonte. A lista de palpites aceitos junta os nomes e apelidos do catálogo com o mesmo número de letras e uma lista curta de nomes conhecidos do K-pop. No fim da partida, Ver fonte mostra a estreia, a agência e os integrantes registrados, quando existem, e leva à página do Wikidata.",
          "Um programa consulta a Wikipédia e o Wikidata para montar o catálogo e guarda a revisão de cada página. O nome do dia seguinte é escolhido às 15:00 UTC, meio-dia em Brasília, e o arquivo só é publicado depois da checagem de formato.",
        ],
        faq: [
          {
            question: "Por que (G)I-DLE vira GIDLE?",
            answer:
              "O jogo só conta letras de A a Z. Antes da partida, saem os espaços, os acentos e os símbolos, então (G)I-DLE vira GIDLE e LE SSERAFIM vira LESSERAFIM. O nome da resposta tem de 3 a 10 letras depois dessa limpeza.",
          },
          {
            question: "Por que minha palavra não foi aceita?",
            answer:
              "O palpite precisa estar na lista de nomes aceitos, que reúne os nomes e apelidos do catálogo com o mesmo número de letras da resposta e alguns nomes conhecidos do K-pop. Um nome fora dessa lista é recusado e a tentativa não conta.",
          },
          { question: "Em quais idiomas dá para jogar?", answer: ptLanguages("/en/guess/") },
        ],
      },
      wordSearch: {
        howToPlayHeading: "Como jogar o Caça-palavras de K-pop",
        dataSourcesHeading: "De onde vêm os dados do Caça-palavras de K-pop",
        faqHeading: "Perguntas sobre o Caça-palavras de K-pop",
        howToPlay: [
          "Cada partida tem um tema, como os integrantes de um grupo, os grupos de uma gravadora ou os grupos formados numa década. Os nomes do tema ficam escondidos numa grade de letras, em linha reta na horizontal, na vertical ou na diagonal, e podem estar de trás para frente. A lista ao lado mostra quantas letras tem cada nome.",
          "Para marcar um nome, toque na primeira e na última letra ou arraste de uma ponta à outra. No teclado, as setas movem a seleção, e Enter ou espaço marcam o início e o fim. O cronômetro registra quanto tempo você levou. Se travar, Mostrar palavras revela os nomes.",
        ],
        dataSources: [
          "O tema e os nomes vêm de fatos sobre grupos e integrantes, como a formação, a gravadora e quem faz parte de cada grupo. Os nomes perdem acentos, espaços e símbolos antes de entrar na grade. Se um fato separa um nome dos outros do tema, esse fato vira a pista do nome, por exemplo o ano de nascimento, o ano de formação, a gravadora ou outro grupo do qual a pessoa faz parte. No fim, Ver fonte lista a revisão da Wikipédia ou o item do Wikidata que confirma cada nome.",
          "Os fatos vêm da Wikipédia e do Wikidata, consultadas por um programa que registra a revisão de cada página. O tema do dia seguinte é montado às 15:00 UTC, meio-dia em Brasília, e nada vai ao ar sem passar na checagem de formato do arquivo.",
        ],
        faq: [
          {
            question: "Os nomes podem se cruzar?",
            answer:
              "Podem. Duas palavras podem dividir a mesma casa quando a letra é a mesma para as duas, e o cruzamento vale para as duas ao mesmo tempo.",
          },
          {
            question: "Por que os nomes aparecem sem acento?",
            answer:
              "Antes de entrar na grade, os nomes ficam em maiúsculas e perdem acentos, espaços e símbolos. É o mesmo nome do tema, limpo para caber letra a letra.",
          },
          { question: "Preciso criar uma conta?", answer: PT_ACCOUNT },
        ],
      },
      mapPilot: {
        howToPlayHeading: "Como jogar o Quiz de mapa de K-pop",
        dataSourcesHeading: "De onde vêm os dados do Quiz de mapa de K-pop",
        faqHeading: "Perguntas sobre o Quiz de mapa de K-pop",
        howToPlay: [
          "O quiz de mapa usa a turnê DEADLINE de BLACKPINK. Cada rodada traz 10 datas da agenda oficial. Para cada data, escolha o país do show no mapa ou na lista de países. Em telas menores, a lista fica num seletor na barra de baixo.",
          "Depois da resposta, a barra mostra o país correto e os links da agenda oficial e do MusicBrainz para aquela data. No fim, você vê quantas acertou, e Ver fonte lista as 10 datas com a sua resposta. No teclado, Tab chega a um país e Enter escolhe.",
        ],
        dataSources: [
          "Uma data só entra no jogo quando três fontes concordam. A agenda oficial da YG lista a data e a cidade. O MusicBrainz registra o show em um local. O país do local no Wikidata bate com o país que o MusicBrainz registra para ele. Depois, o identificador do Wikidata liga o país ao contorno correspondente no mapa do Natural Earth.",
          "A lista de datas é refeita uma vez por mês. A pergunta é sobre o país que a agenda oficial listou. Uma data na agenda não confirma que o show aconteceu, e o jogo não afirma isso. O MusicBrainz e o Wikidata publicam esses dados sob a licença CC0.",
          "O navegador sorteia a rodada a partir da data, então quem joga no mesmo dia vê as mesmas 10 datas.",
        ],
        faq: [
          {
            question: "Por que o país pode ser diferente do da cidade?",
            answer:
              "A resposta certa é o país de hoje do local do show, confirmado no Wikidata e no MusicBrainz e desenhado com o contorno do Natural Earth. Se as fronteiras mudaram desde o show, o jogo segue o país atual.",
          },
          {
            question: "Por que só há datas da turnê DEADLINE?",
            answer:
              "Porque cada data precisa das três fontes concordando, e a verificação cobre a agenda oficial da turnê DEADLINE de BLACKPINK.",
          },
          { question: "O jogo é grátis?", answer: PT_FREE },
        ],
      },
      timeline: {
        howToPlayHeading: "Como jogar a Linha do Tempo do K-pop",
        dataSourcesHeading: "De onde vêm os dados da Linha do Tempo do K-pop",
        faqHeading: "Perguntas sobre a Linha do Tempo do K-pop",
        howToPlay: [
          "Cada partida traz 5 acontecimentos do K-pop ligados a um tema, como a formação de grupos ou o nascimento de artistas. As datas ficam escondidas. Arraste os cartões ou use os botões ↑ e ↓ para colocar os acontecimentos do mais antigo ao mais recente. Todos recebem os mesmos 5 acontecimentos no dia.",
          "Com a ordem pronta, clique em Verificar ordem. Você tem uma tentativa por dia. O resultado marca cada acontecimento como certo ou errado, revela as datas e mostra a pontuação de 0 a 5. O resultado compartilhado mostra a pontuação e quais acontecimentos você acertou, sem revelar as datas nem a ordem certa.",
        ],
        dataSources: [
          "Os acontecimentos vêm das datas de formação de grupos e de nascimento de artistas registradas no Wikidata e na Wikipédia, sempre de 1980 em diante. Os 5 acontecimentos de uma partida têm anos diferentes e pelo menos 30 dias de distância entre um e outro, então dois acontecimentos nunca empatam.",
          "Um programa consulta a Wikipédia e o Wikidata e registra de onde saiu cada data. Os acontecimentos do dia seguinte são escolhidos às 15:00 UTC, meio-dia em Brasília, e o arquivo publicado passa por uma checagem de formato.",
        ],
        faq: [
          {
            question: "O que acontece se dois fatos forem do mesmo ano?",
            answer:
              "Isso não chega a acontecer. O gerador só forma uma partida com acontecimentos de anos diferentes, então não existe empate a ser resolvido.",
          },
          {
            question: "Uma data que só tem o ano vale?",
            answer:
              "Vale. Um acontecimento conhecido só pelo ano conta como o ano inteiro. Como cada partida usa anos diferentes, uma data parcial nunca fica ambígua perto da vizinha.",
          },
          { question: "Em quais idiomas dá para jogar?", answer: ptLanguages("/en/timeline/") },
        ],
      },
    },
  },
  en: {
    games: {
      grid: {
        howToPlayHeading: "How to play the K-pop Intersection Grid",
        dataSourcesHeading: "Where the K-pop Intersection Grid data comes from",
        faqHeading: "K-pop Intersection Grid FAQ",
        howToPlay: [
          "The grid has 3 rows and 3 columns. Each row and each column carries a rule about K-pop groups, such as the agency, the debut decade or the number of members. For each of the 9 squares, pick a group that matches both its row and its column.",
          "You get 9 guesses for 9 squares, and a wrong guess still uses one up. A group can fill only one square, so if a name fits several crossings, save it for the square with the fewest options. The search box only lists groups from the game's catalog, so spelling and romanization won't trip you up.",
          "When the game ends, the answers screen lists every group that would have counted in each square, along with the source behind each rule.",
        ],
        dataSources: [
          "The rules are built from each group's formation date, record label and member list. A member count is used only when every current member of the group has an accepted source. If any member is disputed, the group is left out of the member-count rules. The generator rejects any grid with an empty square and never uses the same kind of rule on both axes.",
          "A program reads the Wikipedia and Wikidata APIs, stores the revision of every page it reads and records where each fact came from. A fact reaches the games only if it points to a Wikidata reference or to a passage in a specific Wikipedia revision.",
          "Every day at 15:00 UTC, noon in São Paulo, an automated process refreshes the database and builds the next day's games. Each file goes through a format check, and nothing goes live when one of them fails.",
        ],
        faq: [
          {
            question: "Why wasn't my group accepted?",
            answer:
              "A square only takes a group that matches both its row and its column. If the group shows up in the search but doesn't complete the square, it fails one of the two rules. A group that already filled another square is out too, because each group fills one square only.",
          },
          { question: "Do I need an account?", answer: EN_ACCOUNT },
          {
            question: "Does the puzzle change every day?",
            answer:
              "Yes. A new grid goes live at midnight São Paulo time (03:00 UTC), and everyone plays the same one that day. If the generator can't build a valid grid, the site repeats the previous one as long as it stays valid.",
          },
        ],
      },
      connections: {
        howToPlayHeading: "How to play K-pop Connections",
        dataSourcesHeading: "Where the K-pop Connections data comes from",
        faqHeading: "K-pop Connections FAQ",
        howToPlay: [
          "The board shows 16 K-pop group names. They split into 4 categories of 4, and each name belongs to exactly one category. Pick 4 names that share something and submit them. If you're right, the category leaves the board and its label is revealed.",
          "You can make 4 mistakes. When 3 of your 4 picks belong to the same category, the game tells you you're one away. Shuffle moves the names around, which can help you spot a different grouping. Yellow marks the easiest category and purple the hardest. At the end, the shareable result shows how many categories you solved and how many mistakes you made, without giving the categories away.",
        ],
        dataSources: [
          "Categories group the names by record label or agency, by formation decade or by member count. The generator only publishes boards whose split into 4 groups of 4 is unique. The difficulty order comes from how many outside names could be confused with each category.",
          "The facts come from Wikipedia and Wikidata, read by a program that stores the revision of every page and the origin of every claim. The database is refreshed every day at 15:00 UTC, noon in São Paulo, and the next board goes live only after its format check passes.",
        ],
        faq: [
          {
            question: "Why does a name seem to fit two groups?",
            answer:
              "A name can fit more than one category, but only one split completes all four groups. If two splits work, the board is thrown out.",
          },
          {
            question: "Does everyone get the same board?",
            answer:
              "Yes. The board changes at midnight São Paulo time (03:00 UTC) and is the same for every player that day, so shared results can be compared.",
          },
          { question: "Is it free?", answer: EN_FREE },
        ],
      },
      nameGuess: {
        howToPlayHeading: "How to play the K-pop Wordle",
        dataSourcesHeading: "Where the K-pop Wordle data comes from",
        faqHeading: "K-pop Wordle FAQ",
        howToPlay: [
          "This is a K-pop Wordle. The answer is the name of an artist or group, 3 to 10 letters long, and you have 6 guesses. The row of tiles shows how long the name is. Spaces and symbols are dropped, so (G)I-DLE becomes GIDLE and LE SSERAFIM becomes LESSERAFIM.",
          "After each guess the tiles change color. Green means the right letter in the right spot. Yellow means the letter is in the name but somewhere else, and gray means it isn't in the name at all. A guess has to be on the list of accepted names. If it isn't, the game tells you and the attempt doesn't count. High-contrast mode swaps green and yellow for blue and orange.",
        ],
        dataSources: [
          "Today's name is picked from artists and groups in the catalog that have at least one sourced fact. The accepted guesses combine the catalog's names and aliases that have the same number of letters with a short list of well-known K-pop names. When the game ends, Show source lists the debut year, agency and members on record, when there are any, and links to the Wikidata entry.",
          "A program reads the Wikipedia and Wikidata APIs to build the catalog and stores the revision of every page. The next day's name is picked at 15:00 UTC, noon in São Paulo, and the file is published only after its format check.",
        ],
        faq: [
          {
            question: "Why does (G)I-DLE become GIDLE?",
            answer:
              "The game only counts letters A through Z. Spaces, accents and symbols are dropped before the round starts, so (G)I-DLE becomes GIDLE and LE SSERAFIM becomes LESSERAFIM. After that cleanup, the answer is 3 to 10 letters long.",
          },
          {
            question: "Why wasn't my word accepted?",
            answer:
              "A guess has to be on the list of accepted names, which combines the catalog's names and aliases with the same number of letters as the answer plus a few well-known K-pop names. A name that isn't on the list is refused and the attempt doesn't count.",
          },
          { question: "Which languages can I play in?", answer: enLanguages("/pt-br/adivinhe/") },
        ],
      },
      wordSearch: {
        howToPlayHeading: "How to play the K-pop Word Search",
        dataSourcesHeading: "Where the K-pop Word Search data comes from",
        faqHeading: "K-pop Word Search FAQ",
        howToPlay: [
          "Each puzzle has a theme, such as the members of one group, the groups on one record label or the groups that formed in one decade. The names are hidden in a grid of letters in straight lines, across, down or diagonally, and they can run backwards. The list beside the grid shows how many letters each name has.",
          "To mark a name, tap its first and last letter or drag from one end to the other. On a keyboard, the arrow keys move around the grid and Enter or Space marks the start and the end. A timer tracks how long you take. If you get stuck, Show words reveals the names.",
        ],
        dataSources: [
          "Themes and names come from facts about groups and their members, such as who belongs to each group, when it formed and which label it is on. Names lose accents, spaces and symbols before they go into the grid. When a fact sets one name apart from the rest of the theme, that fact becomes the name's clue, for example a birth year, a formation year, a record label or another group the person belongs to. At the end, Show source lists the Wikipedia revision or Wikidata entry behind each name.",
          "The facts come from Wikipedia and Wikidata, read by a program that records the revision of every page. The next theme is built at 15:00 UTC, noon in São Paulo, and nothing goes live without passing the file's format check.",
        ],
        faq: [
          {
            question: "Can names cross each other?",
            answer:
              "They can. Two names can share the same square when the letter is the same for both, and the crossing counts for both at once.",
          },
          {
            question: "Why do the names show up without accents?",
            answer:
              "Before entering the grid, names are uppercased and lose accents, spaces and symbols. It's the same theme name, cleaned up to fit letter by letter.",
          },
          { question: "Do I need an account?", answer: EN_ACCOUNT },
        ],
      },
      mapPilot: {
        howToPlayHeading: "How to play the K-pop Map Quiz",
        dataSourcesHeading: "Where the K-pop Map Quiz data comes from",
        faqHeading: "K-pop Map Quiz FAQ",
        howToPlay: [
          "The map quiz is built on BLACKPINK's DEADLINE world tour. Each round has 10 dates from the official schedule. For each date, pick the country of the show on the map or from the list of countries. On smaller screens the list sits in a menu in the bottom bar.",
          "After you answer, the bar shows the correct country with links to the official schedule and to MusicBrainz for that date. At the end you see your score, and Show source lists all 10 dates with your answer. With a keyboard, Tab moves between countries and Enter picks one.",
        ],
        dataSources: [
          "A date makes it into the game only when three sources agree. YG's official schedule lists the date and city, MusicBrainz records the concert at a venue, and the venue's country on Wikidata matches the one MusicBrainz records. The country's Wikidata ID then links it to the matching shape on the Natural Earth map.",
          "The date list is rebuilt once a month. The question asks which country the official schedule listed. A date on the schedule doesn't prove the show happened, and the game doesn't claim it did. MusicBrainz core data and Wikidata are published under CC0.",
          "Your browser draws each day's round from the date, so everyone playing on the same day sees the same 10 dates.",
        ],
        faq: [
          {
            question: "What if the city's country changed since the show?",
            answer:
              "The right answer is the venue's country today, confirmed on Wikidata and MusicBrainz and drawn with the Natural Earth shape. If borders moved since the show, the game follows the country as it is now.",
          },
          {
            question: "Why are there only DEADLINE tour dates?",
            answer:
              "Because every date needs the three sources to agree, and that check covers BLACKPINK's official DEADLINE tour schedule.",
          },
          { question: "Is it free?", answer: EN_FREE },
        ],
      },
      timeline: {
        howToPlayHeading: "How to play the K-pop Timeline",
        dataSourcesHeading: "Where the K-pop Timeline data comes from",
        faqHeading: "K-pop Timeline FAQ",
        howToPlay: [
          "Each puzzle has 5 K-pop events tied to a theme, such as when groups formed or when artists were born. The dates are hidden. Drag the cards, or use the ↑ and ↓ buttons, to put the events in order from earliest to latest. Everyone gets the same 5 events that day.",
          "When you're happy with the order, click Check order. You get one attempt a day. The result marks each event right or wrong, reveals the dates and gives you a score out of 5. The shareable result shows your score and which events you got right, without revealing the dates or the right order.",
        ],
        dataSources: [
          "Events come from group formation dates and artist birth dates recorded on Wikidata and Wikipedia, always from 1980 on. The 5 events in a puzzle fall in different years, with at least 30 days between any two of them, so no two events can tie.",
          "A program reads the Wikipedia and Wikidata APIs and records where each date came from. The next day's events are picked at 15:00 UTC, noon in São Paulo, and the published file goes through a format check.",
        ],
        faq: [
          {
            question: "What happens if two facts fall in the same year?",
            answer:
              "That never comes up. The generator only assembles a puzzle from events in different years, so there is no tie to settle.",
          },
          {
            question: "Does a date known only by its year count?",
            answer:
              "It does. An event known only by its year counts as the whole year. Because each puzzle uses different years, a partial date is never ambiguous next to its neighbor.",
          },
          { question: "Which languages can I play in?", answer: enLanguages("/pt-br/linha-do-tempo/") },
        ],
      },
    },
  },
};
