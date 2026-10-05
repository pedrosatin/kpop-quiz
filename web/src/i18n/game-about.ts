import type { Locale } from "../lib/quiz-types";

// Static copy rendered under each game (GameAbout.astro), so the served HTML
// explains the game, its sources and the daily schedule before any island
// loads. Facts here must match the code: the 15:00 UTC cron in
// daily-puzzles-cron.yml, the Sao Paulo midnight switch in daily-artifact.ts,
// the generators under kpop_scraping/ and the map refresh workflow.

export type GameAboutKey = "grid" | "connections" | "nameGuess" | "wordSearch" | "mapPilot" | "timeline";

export interface GameAboutFaq {
  question: string;
  answer: string;
}

export interface GameAboutCopy {
  howToPlay: string[];
  dataSources: string[];
  faq: GameAboutFaq[];
}

export interface GameAboutMessages {
  howToPlayHeading: string;
  dataSourcesHeading: string;
  faqHeading: string;
  games: Record<GameAboutKey, GameAboutCopy>;
}

const PT_PIPELINE =
  "Um coletor em Python consulta as APIs da Wikipédia e do Wikidata, guarda a revisão de cada página lida e registra de onde saiu cada fato. Um fato só entra nos jogos quando aponta para uma referência no Wikidata ou para um trecho de uma revisão específica da Wikipédia.";

const PT_SCHEDULE =
  "Um workflow agendado para as 15:00 UTC (meio-dia em Brasília) reconstrói a base e gera os jogos do dia seguinte. Cada arquivo passa pela validação do seu esquema, e a publicação só acontece quando todos passam.";

const EN_PIPELINE =
  "A Python collector reads the Wikipedia and Wikidata APIs, stores the revision of every page it reads and records where each fact came from. A fact reaches the games only if it points to a Wikidata reference or to a passage in a specific Wikipedia revision.";

const EN_SCHEDULE =
  "A workflow scheduled for 15:00 UTC rebuilds the database and generates the next day's puzzles. Every file is checked against its schema, and nothing goes live unless all of them pass.";

function ptFaq(daily: string, enPath: string): GameAboutFaq[] {
  return [
    {
      question: "O jogo é grátis?",
      answer:
        "Sim. Todos os jogos do K-pop Quiz são gratuitos e rodam no navegador, no celular ou no computador, sem instalar nada.",
    },
    {
      question: "Preciso criar uma conta?",
      answer:
        "Não. O site não tem cadastro nem login. A sequência de dias e as estatísticas ficam guardadas no próprio navegador. Para levar esses números a outro aparelho, use as opções de exportar e importar na janela de estatísticas.",
    },
    { question: "O jogo muda todo dia?", answer: daily },
    {
      question: "Em quais idiomas dá para jogar?",
      answer: `Em português e em inglês. O link English no topo da página abre a versão em inglês, em kpopquiz.online${enPath}, com o mesmo desafio do dia.`,
    },
  ];
}

function enFaq(daily: string, ptPath: string): GameAboutFaq[] {
  return [
    {
      question: "Is it free?",
      answer:
        "Yes. Every game on K-pop Quiz is free and runs in the browser on a phone or a computer. There is nothing to install.",
    },
    {
      question: "Do I need an account?",
      answer:
        "No. There is no sign-up and no login. Your streak and stats are saved in your browser. To move them to another device, use export and import in the stats window.",
    },
    { question: "Does the puzzle change every day?", answer: daily },
    {
      question: "Which languages can I play in?",
      answer: `English and Brazilian Portuguese. The Português link at the top of the page opens the Portuguese version at kpopquiz.online${ptPath}, with the same daily puzzle.`,
    },
  ];
}

export const gameAbout: Record<Locale, GameAboutMessages> = {
  "pt-BR": {
    howToPlayHeading: "Como jogar",
    dataSourcesHeading: "De onde vêm os dados",
    faqHeading: "Perguntas frequentes",
    games: {
      grid: {
        howToPlay: [
          "A grade tem 3 linhas e 3 colunas. Cada linha e cada coluna traz um critério sobre grupos de K-pop, como a agência, a década de estreia ou o número de integrantes. Em cada uma das 9 casas, o grupo escolhido precisa atender ao critério da linha e ao da coluna.",
          "São 9 palpites para as 9 casas, e um palpite errado também conta. Cada grupo vale para uma casa só. Quando um nome serve em mais de um cruzamento, guarde-o para a casa com menos opções. A busca lista apenas os grupos do catálogo do jogo, então a grafia ou a romanização do nome não atrapalha.",
          "No fim, a tela de respostas mostra os grupos aceitos em cada casa e a fonte de cada critério.",
        ],
        dataSources: [
          "Os critérios saem da data de formação, da gravadora e da lista de integrantes de cada grupo. A contagem de integrantes só vale quando todas as declarações atuais de integrante do grupo foram aceitas. Se uma delas estiver em conflito, o grupo fica fora dos critérios de contagem. O gerador descarta grades com alguma casa sem resposta válida e nunca usa a mesma categoria de critério nas linhas e nas colunas.",
          PT_PIPELINE,
          PT_SCHEDULE,
        ],
        faq: ptFaq(
          "Sim. A grade nova entra no ar à meia-noite no horário de Brasília (03:00 UTC), e todo mundo recebe a mesma grade naquele dia. Se o gerador não conseguir montar uma grade válida, o site mantém a anterior enquanto ela passar na validação.",
          "/en/grid/",
        ),
      },
      connections: {
        howToPlay: [
          "O tabuleiro traz 16 nomes de grupos de K-pop. Eles formam 4 categorias de 4 nomes, e cada nome pertence a uma categoria só. Selecione 4 nomes que tenham algo em comum e envie. Se acertar, a categoria sai do tabuleiro e o critério aparece.",
          "Você pode errar 4 vezes. Quando 3 dos 4 nomes escolhidos são da mesma categoria, o jogo avisa que faltou um. O botão Embaralhar muda a posição dos nomes, o que ajuda a enxergar outras combinações. A cor de cada categoria indica a dificuldade, do amarelo, a mais fácil, ao roxo, a mais difícil.",
        ],
        dataSources: [
          "As categorias agrupam os nomes pela gravadora ou agência, pela década de formação ou pelo número de integrantes. Antes de publicar, o gerador confere se existe uma única forma de separar os 16 nomes em 4 grupos de 4. Se um nome coubesse em duas categorias, a resposta ficaria ambígua, e esse tabuleiro é descartado.",
          PT_PIPELINE,
          PT_SCHEDULE,
        ],
        faq: ptFaq(
          "Sim. Um tabuleiro novo entra no ar à meia-noite no horário de Brasília (03:00 UTC). Todos os jogadores recebem os mesmos 16 nomes no mesmo dia, então dá para comparar o resultado compartilhado.",
          "/en/connections/",
        ),
      },
      nameGuess: {
        howToPlay: [
          "O jogo funciona como um Wordle de K-pop. A resposta é o nome de um artista ou grupo, com 3 a 10 letras, e você tem 6 palpites. O número de casas na tela mostra o tamanho do nome. Espaços e símbolos ficam de fora, então (G)I-DLE vira GIDLE e LE SSERAFIM vira LESSERAFIM.",
          "Depois de cada palpite, as letras mudam de cor. Verde indica a letra certa na posição certa. Amarelo indica que a letra está no nome em outra posição, e cinza indica que ela não aparece. O palpite precisa estar na lista de nomes aceitos. Se não estiver, o jogo avisa e a tentativa não conta. Com as cores de alto contraste, azul e laranja substituem o verde e o amarelo.",
        ],
        dataSources: [
          "O nome do dia sai dos artistas e grupos do catálogo que têm ao menos um fato com fonte. A lista de palpites aceitos junta os nomes e apelidos do catálogo com o mesmo número de letras e uma lista curta de nomes conhecidos do K-pop. No fim da partida, Ver fonte mostra a estreia, a agência e os integrantes registrados, quando existem, e leva à página do Wikidata.",
          PT_PIPELINE,
          PT_SCHEDULE,
        ],
        faq: ptFaq(
          "Sim. O nome muda à meia-noite no horário de Brasília (03:00 UTC), e todo mundo tenta descobrir o mesmo nome naquele dia.",
          "/en/guess/",
        ),
      },
      wordSearch: {
        howToPlay: [
          "Cada partida tem um tema, como os integrantes de um grupo, os grupos de uma gravadora ou os grupos formados numa década. Os nomes do tema ficam escondidos numa grade de letras, em linha reta na horizontal, na vertical ou na diagonal, e podem estar de trás para frente. A lista ao lado mostra quantas letras tem cada nome.",
          "Para marcar um nome, toque na primeira e na última letra ou arraste de uma ponta à outra. No teclado, as setas movem a seleção, e Enter ou espaço marcam o início e o fim. O cronômetro registra quanto tempo você levou. Se travar, Mostrar palavras revela os nomes.",
        ],
        dataSources: [
          "O tema e os nomes vêm de fatos sobre grupos e integrantes, como a formação, a gravadora e quem faz parte de cada grupo. Os nomes perdem acentos, espaços e símbolos antes de entrar na grade. Quando um fato diferencia um nome dos outros do tema, ele vira pista, como o ano de nascimento, o ano de formação, a gravadora ou outro grupo do qual a pessoa faz parte. No fim, Ver fonte lista a revisão da Wikipédia ou o item do Wikidata que confirma cada nome.",
          PT_PIPELINE,
          PT_SCHEDULE,
        ],
        faq: ptFaq(
          "Sim. Um tema novo entra no ar à meia-noite no horário de Brasília (03:00 UTC), com a mesma grade para todos os jogadores.",
          "/en/word-search/",
        ),
      },
      mapPilot: {
        howToPlay: [
          "O quiz de mapa usa a turnê DEADLINE de BLACKPINK. Cada rodada traz 10 datas da agenda oficial. Para cada data, escolha o país do show no mapa ou na lista de países. Em telas menores, a lista fica num seletor na barra de baixo.",
          "Depois da resposta, a barra mostra o país correto e os links da agenda oficial e do MusicBrainz para aquela data. No fim, você vê quantas acertou, e Ver fonte lista as 10 datas com a sua resposta. No teclado, Tab chega a um país e Enter escolhe.",
        ],
        dataSources: [
          "Uma data só entra no jogo quando três fontes concordam. A agenda oficial da YG lista a data e a cidade. O MusicBrainz registra o show em um local. O país atual desse local no Wikidata (propriedade P17) coincide com a hierarquia de áreas do MusicBrainz. Depois, o identificador do Wikidata liga o país ao contorno correspondente no mapa do Natural Earth.",
          "Um workflow refaz essa lista no dia 1 de cada mês. A pergunta é sobre o país que a agenda oficial listou. Uma data na agenda não confirma que o show aconteceu, e o jogo não afirma isso. O MusicBrainz e o Wikidata publicam esses dados sob a licença CC0.",
          "O navegador sorteia a rodada a partir da data, então quem joga no mesmo dia vê as mesmas 10 datas.",
        ],
        faq: ptFaq(
          "Sim. As 10 datas da rodada mudam à meia-noite no horário de Brasília (03:00 UTC), e todo mundo recebe a mesma rodada naquele dia. A lista completa de datas da turnê é atualizada uma vez por mês.",
          "/en/map/",
        ),
      },
      timeline: {
        howToPlay: [
          "Cada partida traz 5 acontecimentos do K-pop ligados a um tema, como a formação de grupos ou o nascimento de artistas. As datas ficam escondidas. Arraste os cartões ou use os botões ↑ e ↓ para colocar os acontecimentos do mais antigo ao mais recente.",
          "Com a ordem pronta, clique em Verificar ordem. Você tem uma tentativa por dia. O resultado marca cada acontecimento como certo ou errado, revela as datas e mostra a pontuação de 0 a 5.",
        ],
        dataSources: [
          "Os acontecimentos vêm das datas de formação de grupos e de nascimento de artistas registradas no Wikidata e na Wikipédia. Os 5 acontecimentos de uma partida têm anos diferentes e pelo menos 30 dias de distância entre um e outro. Uma data conhecida só pelo ano conta como o ano inteiro, então a ordem certa nunca depende de sorte.",
          PT_PIPELINE,
          PT_SCHEDULE,
        ],
        faq: ptFaq(
          "Sim. Um conjunto novo de 5 acontecimentos entra no ar à meia-noite no horário de Brasília (03:00 UTC), igual para todos.",
          "/en/timeline/",
        ),
      },
    },
  },
  en: {
    howToPlayHeading: "How to play",
    dataSourcesHeading: "Where the data comes from",
    faqHeading: "Frequently asked questions",
    games: {
      grid: {
        howToPlay: [
          "The grid has 3 rows and 3 columns. Each row and each column carries a rule about K-pop groups, such as the agency, the debut decade or the number of members. For each of the 9 squares, pick a group that matches both its row and its column.",
          "You get 9 guesses for 9 squares, and a wrong guess still uses one up. A group can fill only one square, so if a name fits several crossings, save it for the square with the fewest options. The search box only lists groups from the game's catalog, so spelling and romanization won't trip you up.",
          "When the game ends, the answers screen lists every group that would have counted in each square, along with the source behind each rule.",
        ],
        dataSources: [
          "The rules are built from each group's formation date, record label and member list. A member count is used only when every current membership statement for that group has been accepted. If one is disputed, the group is left out of the member-count rules. The generator rejects any grid with an empty square and never uses the same kind of rule on both axes.",
          EN_PIPELINE,
          EN_SCHEDULE,
        ],
        faq: enFaq(
          "Yes. A new grid goes live at midnight São Paulo time (03:00 UTC), and everyone plays the same one that day. If the generator can't build a valid grid, the site keeps the previous one as long as it still passes validation.",
          "/pt-br/grid/",
        ),
      },
      connections: {
        howToPlay: [
          "The board shows 16 K-pop group names. They split into 4 categories of 4, and each name belongs to exactly one category. Pick 4 names that share something and submit them. If you're right, the category leaves the board and its label is revealed.",
          "You can make 4 mistakes. When 3 of your 4 picks belong to the same category, the game tells you you're one away. Shuffle moves the names around, which can help you spot a different grouping. Each category's color shows its difficulty, from yellow for the easiest to purple for the hardest.",
        ],
        dataSources: [
          "Categories group the names by record label or agency, by formation decade or by member count. Before a board is published, the generator checks that there is exactly one way to split the 16 names into 4 groups of 4. If a name could fit two categories, the answer would be ambiguous, so that board is thrown out.",
          EN_PIPELINE,
          EN_SCHEDULE,
        ],
        faq: enFaq(
          "Yes. A new board goes live at midnight São Paulo time (03:00 UTC). Everyone gets the same 16 names that day, so shared results can be compared.",
          "/pt-br/conexoes/",
        ),
      },
      nameGuess: {
        howToPlay: [
          "This is a K-pop Wordle. The answer is the name of an artist or group, 3 to 10 letters long, and you have 6 guesses. The row of tiles shows how long the name is. Spaces and symbols are dropped, so (G)I-DLE becomes GIDLE and LE SSERAFIM becomes LESSERAFIM.",
          "After each guess the tiles change color. Green means the right letter in the right spot. Yellow means the letter is in the name but somewhere else, and gray means it isn't in the name at all. A guess has to be on the list of accepted names. If it isn't, the game tells you and the attempt doesn't count. High-contrast mode swaps green and yellow for blue and orange.",
        ],
        dataSources: [
          "Today's name is picked from artists and groups in the catalog that have at least one sourced fact. The accepted guesses combine the catalog's names and aliases that have the same number of letters with a short list of well-known K-pop names. When the game ends, Show source lists the debut year, agency and members on record, when there are any, and links to the Wikidata entry.",
          EN_PIPELINE,
          EN_SCHEDULE,
        ],
        faq: enFaq(
          "Yes. The name changes at midnight São Paulo time (03:00 UTC), and everyone is guessing the same one that day.",
          "/pt-br/adivinhe/",
        ),
      },
      wordSearch: {
        howToPlay: [
          "Each puzzle has a theme, such as the members of one group, the groups on one record label or the groups that formed in one decade. The names are hidden in a grid of letters in straight lines, across, down or diagonally, and they can run backwards. The list beside the grid shows how many letters each name has.",
          "To mark a name, tap its first and last letter or drag from one end to the other. On a keyboard, the arrow keys move around the grid and Enter or Space marks the start and the end. A timer tracks how long you take. If you get stuck, Show words reveals the names.",
        ],
        dataSources: [
          "Themes and names come from facts about groups and their members, such as who belongs to each group, when it formed and which label it is on. Names lose accents, spaces and symbols before they go into the grid. When a fact sets one name apart from the rest of the theme, it becomes a clue, for example a birth year, a formation year, a record label or another group the person belongs to. At the end, Show source lists the Wikipedia revision or Wikidata entry behind each name.",
          EN_PIPELINE,
          EN_SCHEDULE,
        ],
        faq: enFaq(
          "Yes. A new theme goes live at midnight São Paulo time (03:00 UTC), and everyone gets the same grid.",
          "/pt-br/caca-palavras/",
        ),
      },
      mapPilot: {
        howToPlay: [
          "The map quiz is built on BLACKPINK's DEADLINE world tour. Each round has 10 dates from the official schedule. For each date, pick the country of the show on the map or from the list of countries. On smaller screens the list sits in a menu in the bottom bar.",
          "After you answer, the bar shows the correct country with links to the official schedule and to MusicBrainz for that date. At the end you see your score, and Show source lists all 10 dates with your answer. With a keyboard, Tab moves between countries and Enter picks one.",
        ],
        dataSources: [
          "A date makes it into the game only when three sources agree. YG's official schedule lists the date and city, MusicBrainz records the concert at a venue, and the venue's current country on Wikidata (property P17) matches MusicBrainz's area hierarchy. The country's Wikidata ID then links it to the matching shape on the Natural Earth map.",
          "A workflow rebuilds this list on the first day of every month. The question asks which country the official schedule listed. A date on the schedule doesn't prove the show happened, and the game doesn't claim it did. MusicBrainz core data and Wikidata are published under CC0.",
          "Your browser draws each day's round from the date, so everyone playing on the same day sees the same 10 dates.",
        ],
        faq: enFaq(
          "Yes. The 10 dates change at midnight São Paulo time (03:00 UTC), and everyone gets the same round that day. The full list of tour dates is refreshed once a month.",
          "/pt-br/mapa/",
        ),
      },
      timeline: {
        howToPlay: [
          "Each puzzle has 5 K-pop events tied to a theme, such as when groups formed or when artists were born. The dates are hidden. Drag the cards, or use the ↑ and ↓ buttons, to put the events in order from earliest to latest.",
          "When you're happy with the order, click Check order. You get one attempt a day. The result marks each event right or wrong, reveals the dates and gives you a score out of 5.",
        ],
        dataSources: [
          "Events come from group formation dates and artist birth dates recorded on Wikidata and Wikipedia. The 5 events in a puzzle fall in different years, with at least 30 days between any two of them. A date known only by its year counts as the whole year, so the right order never comes down to luck.",
          EN_PIPELINE,
          EN_SCHEDULE,
        ],
        faq: enFaq(
          "Yes. A new set of 5 events goes live at midnight São Paulo time (03:00 UTC), and it's the same for everyone.",
          "/pt-br/linha-do-tempo/",
        ),
      },
    },
  },
};
