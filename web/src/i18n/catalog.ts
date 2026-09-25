import type { Locale, PlayMode } from "../lib/quiz-types";

export type SeoRouteKey = "quiz" | "grid" | "connections" | "nameGuess" | "wordSearch";

export type SkipLinkKey = SeoRouteKey | "privacy";

export interface SeoMeta {
  title: string;
  description: string;
}

export interface NameGuessMessages {
  title: string;
  subtitle: string;
  attemptsLeft: string;
  enter: string;
  backspace: string;
  notEnoughLetters: string;
  notInWordList: string;
  wonTitle: string;
  lostTitle: string;
  targetWas: string;
  playAgain: string;
  copyResults: string;
  copied: string;
  highContrast: string;
  hints: string;
  debutYear: string;
  agency: string;
  members: string;
  evidenceLink: string;
  loading: string;
  loadError: string;
  artifactMissing: string;
  retry: string;
  boardAria: string;
  rowAria: (row: number) => string;
  emptyTile: (pos: number) => string;
  activeTile: (pos: number, letter: string) => string;
  correctTile: (pos: number, letter: string) => string;
  presentTile: (pos: number, letter: string) => string;
  absentTile: (pos: number, letter: string) => string;
  keyboardAria: string;
  resultsAria: string;
}

export interface WordSearchMessages {
  title: string;
  gridLabel: string;
  wordsHeading: string;
  wordsFound: string;
  timerLabel: string;
  showWords: string;
  hideWords: string;
  lettersCount: (count: number) => string;
  selectionLabel: string;
  selectionHint: string;
  anchorHint: (letter: string) => string;
  shareResult: string;
  copied: string;
  congratulations: string;
  allWordsFound: string;
  elapsedTime: string;
  viewEvidence: string;
  evidenceModalTitle: string;
  evidenceWikidataId: string;
  evidenceClue: string;
  evidenceSourcesHeading: string;
  evidenceSource: string;
  evidenceLocator: string;
  evidenceRevision: string;
  evidenceOpen: string;
  close: string;
  loading: string;
  loadError: string;
  artifactMissing: string;
  retry: string;
  wordFoundAnnouncement: (name: string, current: number, total: number) => string;
  gameCompleteAnnouncement: (total: number, time: string) => string;
  cellAria: (row: number, col: number, letter: string, isSelected: boolean, isFound: boolean) => string;
}

export interface Messages {
  meta: Record<SeoRouteKey, SeoMeta>;
  skipLinks: Record<SkipLinkKey, string>;
  eyebrow: string;
  title: string;
  intro: string;
  languageLabel: string;
  languageName: string;
  homeLabel: string;
  attribution: string;
  and: string;
  loading: string;
  loadError: string;
  artifactMissing: string;
  artifactInvalid: string;
  errorDatasetIntegrity: string;
  retry: string;
  reload: string;
  empty: string;
  consentLabel: string;
  consentText: string;
  consentAccept: string;
  consentReject: string;
  consentPreferences: string;
  consentPrivacyLink: string;
  privacyLink: string;
  howToPlayTitle: string;
  quizHowToPlay: string[];
  gridHowToPlay: string[];
  connectionsHowToPlay: string[];
  nameGuessHowToPlay: string[];
  wordSearchHowToPlay: string[];
  questionCounter: (current: number, total: number) => string;
  score: string;
  points: string;
  setupKicker: string;
  setupTitle: string;
  chooseDifficulty: string;
  chooseDecades: string;
  decadeHelp: string;
  decadeLabel: (decade: number) => string;
  roundRules: string;
  difficultyName: (playMode: PlayMode) => string;
  difficultyDescription: (playMode: PlayMode) => string;
  start: string;
  enableTimer: string;
  clue: string;
  revealClue: (cost: number) => string;
  clueRevealed: string;
  time: string;
  seconds: string;
  check: string;
  next: string;
  finish: string;
  correct: string;
  incorrect: string;
  timedOut: string;
  answerWas: string;
  evidence: string;
  revision: string;
  declaredReference: string;
  openRevision: (project: string) => string;
  resultTitle: string;
  resultText: (score: number) => string;
  restart: string;
  chooseAnswer: string;
  themeLabel: string;
  themeAuto: string;
  themeLight: string;
  themeDark: string;
  totalTime: string;
  cluesUsed: string;
  shareHints: (count: number) => string;
  correctCountLabel: string;
  share: string;
  copyResult: string;
  copiedToClipboard: string;
  shareTextLabel: string;
  reviewTitle: string;
  yourAnswer: string;
  correctAnswer: string;
  noAnswer: string;
  collectionTitle: string;
  generalGameTitle: string;
  generalGameDescription: string;
  dailyGameTitle: string;
  dailyGameDescription: string;
  shareDailyHeader: (date: string, correct: number, total: number) => string;
  mediaAltClue: string;
  mediaCreator: string;
  mediaSource: string;
  mediaUnavailable: string;
  gridTitle: string;
  gridEyebrow: string;
  gridIntro: string;
  gridGuessesLeft: (count: number) => string;
  gridCorrectCount: (correct: number, total: number) => string;
  gridCellLabel: (row: number, col: number, rowLabel: string, colLabel: string, status: string) => string;
  gridCellEmpty: string;
  gridCellSolved: (groupName: string) => string;
  gridCellFailed: (lastAttempt?: string) => string;
  gridPickerTitle: string;
  gridPickerSearchPlaceholder: string;
  gridPickerSearchLabel: string;
  gridPickerNoMatches: string;
  gridPickerResultsCount: (count: number) => string;
  gridAlreadyUsedError: string;
  gridAlreadyUsedBadge: string;
  gridClosePicker: string;
  gridGameOverTitle: string;
  gridGameOverSummary: (correct: number, guesses: number) => string;
  gridShareButton: string;
  gridCopyButton: string;
  gridCopiedNotice: string;
  gridHighContrastShare: string;
  gridReviewTitle: string;
  gridReviewCellHeader: (row: number, col: number) => string;
  gridAcceptedAnswers: string;
  gridRestart: string;
  gridShareHeader: (date: string, correct: number, guesses: number) => string;
  gridAxesHeader: string;
  gridShareMatrixAriaLabel: string;
  gridCategoryDebut: string;
  gridCategoryAgency: string;
  gridCategoryMembers: string;
  connectionsTitle: string;
  connectionsEyebrow: string;
  connectionsIntro: string;
  connectionsMistakesRemaining: (count: number) => string;
  connectionsOneAway: string;
  connectionsAlreadyGuessed: string;
  connectionsShuffle: string;
  connectionsDeselectAll: string;
  connectionsSubmit: string;
  connectionsGameOverWon: string;
  connectionsGameOverLost: string;
  connectionsResultSummaryWon: (mistakes: number) => string;
  connectionsResultSummaryLost: string;
  connectionsShareResultLine: (solved: number) => string;
  connectionsShareGuessesLine: (guesses: number, mistakes: number) => string;
  connectionsShareButton: string;
  connectionsHighContrastShare: string;
  connectionsRestart: string;
  connectionsItemAriaLabel: (name: string, selected: boolean) => string;
  connectionsCategorySolvedAria: (difficulty: number, label: string, items: string) => string;
  connectionsBoardAria: string;
  connectionsSolvedAria: string;
  connectionsItemsAria: string;
  connectionsLevelAria: string;
  nameGuessTitle: string;
  nameGuessEyebrow: string;
  nameGuessIntro: string;
  nameGuess: NameGuessMessages;
  wordSearchTitle: string;
  wordSearchEyebrow: string;
  wordSearchIntro: string;
  wordSearch: WordSearchMessages;
  gameNavLabel: string;
  gameQuiz: string;
  gameGrid: string;
  gameConnections: string;
  gameNameGuess: string;
  gameWordSearch: string;
  statsTitle: string;
  statsNavLabel: string;
  statsOpenButton: string;
  statsClose: string;
  statsTabOverall: string;
  statsPlayed: string;
  statsWinRate: string;
  statsCurrentStreak: string;
  statsMaxStreak: string;
  statsGuessDistribution: string;
}

const catalogs: Record<Locale, Messages> = {
  "pt-BR": {
    meta: {
      quiz: {
        title: "Quiz de K-pop: grupos, integrantes e datas",
        description: "10 perguntas de múltipla escolha sobre a história do K-pop. Cada resposta mostra a fonte consultada.",
      },
      grid: {
        title: "Grade de interseções: quiz 3x3 de K-pop",
        description: "Ache um grupo de K-pop para cada cruzamento de agência, integrantes e estreia. São 9 casas e 9 palpites.",
      },
      connections: {
        title: "Conexões: separe 16 nomes do K-pop",
        description: "Separe 16 nomes do K-pop em 4 categorias, como agência, formação ou marcos da carreira.",
      },
      nameGuess: {
        title: "Adivinhe o nome: artista ou grupo do dia",
        description: "Descubra o artista ou grupo de K-pop do dia em 6 palpites. As cores mostram quais letras você acertou.",
      },
      wordSearch: {
        title: "Caça-palavras de K-pop: ache os nomes",
        description: "Encontre nomes do K-pop escondidos na grade de letras, em 8 direções. Cada nome tem fonte.",
      },
    },
    skipLinks: {
      quiz: "Pular para o quiz",
      grid: "Pular para a grade",
      connections: "Pular para o jogo",
      nameGuess: "Pular para o jogo",
      wordSearch: "Pular para o caça-palavras",
      privacy: "Pular para a política de privacidade",
    },
    eyebrow: "10 perguntas · múltipla escolha",
    title: "Você conhece a história do K-pop?",
    intro: "Perguntas sobre grupos, integrantes e datas. Cada resposta mostra a fonte.",
    languageLabel: "Idioma",
    languageName: "English",
    homeLabel: "K-pop Quiz, página inicial",
    attribution: "Dados",
    and: "e",
    loading: "Carregando o jogo...",
    loadError: "Não foi possível carregar o jogo.",
    artifactMissing: "Este jogo ainda não está disponível em português.",
    artifactInvalid: "Não foi possível ler os dados deste jogo.",
    errorDatasetIntegrity: "Não foi possível ler os dados deste jogo.",
    retry: "Tentar novamente",
    reload: "Tentar novamente",
    empty: "Este quiz ainda não tem perguntas.",
    consentLabel: "Preferências de privacidade",
    consentText:
      "Usamos o Cloudflare Web Analytics para medir o uso do site sem cookies. Se você aceitar, o Google Analytics também vai usar cookies e identificadores para gerar estatísticas de audiência.",
    consentAccept: "Aceitar Google Analytics",
    consentReject: "Recusar Google Analytics",
    consentPreferences: "Preferências de privacidade",
    consentPrivacyLink: "Ler a política de privacidade",
    privacyLink: "Privacidade",
    howToPlayTitle: "Como jogar",
    quizHowToPlay: [
      "Escolha um modo. No Assistido aparecem pistas, no Padrão você pode abrir uma pista e perde pontos, e no Especialista não há pistas.",
      "Se quiser, filtre pela década de formação dos grupos e limite cada pergunta a 20 segundos.",
      "Responda 10 perguntas de múltipla escolha. Cada acerto soma pontos.",
      "Depois de cada resposta, você vê a resposta correta e a fonte.",
    ],
    gridHowToPlay: [
      "Cada casa cruza o critério da linha com o da coluna, como agência, ano de estreia ou número de integrantes.",
      "Escolha uma casa e busque um grupo que atenda aos dois critérios.",
      "Você tem 9 palpites para as 9 casas. Palpite errado também conta.",
      "Cada grupo vale para uma casa só. Depois de acertar com um grupo, você não pode usá-lo de novo.",
    ],
    connectionsHowToPlay: [
      "Os 16 nomes formam 4 categorias de 4, como agência, formação ou marcos da carreira.",
      "Selecione 4 nomes e envie. Se todos forem da mesma categoria, ela sai do tabuleiro.",
      "Você pode errar 4 vezes. Quando 3 dos 4 nomes são da mesma categoria, o jogo avisa.",
      "A cor mostra a dificuldade da categoria: amarelo é a mais fácil e roxo, a mais difícil.",
    ],
    nameGuessHowToPlay: [
      "Descubra o nome de um artista ou grupo de K-pop em até 6 palpites.",
      "O palpite precisa ter o número de letras do nome e estar na lista de nomes aceitos. Espaços e símbolos não contam.",
      "Verde: letra certa na posição certa. Amarelo: a letra está no nome, em outra posição. Cinza: a letra não está no nome.",
      "Com as cores de alto contraste ativadas, azul substitui o verde e laranja substitui o amarelo.",
    ],
    wordSearchHowToPlay: [
      "Os nomes do tema estão escondidos na grade em linha reta: na horizontal, na vertical ou na diagonal, inclusive de trás para frente.",
      "Selecione a primeira e a última letra de um nome, ou arraste de uma ponta à outra.",
      "No teclado, mova com as setas e marque o início e o fim com Enter ou espaço.",
      "A lista mostra quantas letras tem cada nome. Se travar, use \"Mostrar palavras\".",
    ],
    questionCounter: (current, total) => `Pergunta ${current} de ${total}`,
    score: "Pontos",
    points: "pontos",
    setupKicker: "Antes de começar",
    setupTitle: "Monte sua partida",
    chooseDifficulty: "Escolha o modo",
    chooseDecades: "Filtrar por década de formação",
    decadeHelp: "Sem nenhuma década marcada, o quiz usa todas.",
    decadeLabel: (decade) => `Anos ${decade}`,
    roundRules: "10 perguntas de múltipla escolha. Depois de cada resposta, você vê a fonte.",
    difficultyName: (difficulty) => ({ assisted: "Assistido", standard: "Padrão", expert: "Especialista" })[difficulty],
    difficultyDescription: (difficulty) => ({
      assisted: "Mostra uma pista sempre que ela não entrega a resposta.",
      standard: "Começa sem pista. Você pode abrir uma e perde alguns pontos.",
      expert: "Sem pistas. Cada acerto vale mais pontos.",
    })[difficulty],
    start: "Começar partida",
    enableTimer: "Limitar cada pergunta a 20 segundos",
    clue: "Pista",
    revealClue: (cost) => `Ver pista (-${cost} pontos)`,
    clueRevealed: "Pista aberta",
    time: "Tempo",
    seconds: "s",
    check: "Responder",
    next: "Próxima pergunta",
    finish: "Ver resultado",
    correct: "Você acertou.",
    incorrect: "Não foi dessa vez.",
    timedOut: "Acabou o tempo.",
    answerWas: "Resposta correta",
    evidence: "Fonte da resposta",
    revision: "revisão",
    declaredReference: "Referência citada",
    openRevision: (project) => `Abrir a revisão no ${project}`,
    resultTitle: "Fim da partida",
    resultText: (score) => `Você fez ${score} pontos.`,
    restart: "Jogar novamente",
    chooseAnswer: "Escolha uma resposta para continuar.",
    themeLabel: "Tema",
    themeAuto: "Tema do sistema",
    themeLight: "Tema claro",
    themeDark: "Tema escuro",
    totalTime: "Tempo total",
    cluesUsed: "Pistas usadas",
    shareHints: (count) => (count === 1 ? "1 pista" : `${count} pistas`),
    correctCountLabel: "Acertos",
    share: "Compartilhar resultado",
    copyResult: "Copiar resultado",
    copiedToClipboard: "Resultado copiado.",
    shareTextLabel: "Texto do resultado",
    reviewTitle: "Suas respostas",
    yourAnswer: "Sua resposta",
    correctAnswer: "Resposta correta",
    noAnswer: "Sem resposta",
    collectionTitle: "Escolha o jogo",
    generalGameTitle: "Quiz geral",
    generalGameDescription: "Perguntas sobre história, lançamentos e integrantes.",
    dailyGameTitle: "Quiz do dia",
    dailyGameDescription: "As perguntas de hoje, com resultado para compartilhar.",
    shareDailyHeader: (date, correct, total) => `K-pop Quiz Diário ${date} ${correct}/${total}`,
    mediaAltClue: "Foto usada como pista desta pergunta",
    mediaCreator: "Foto:",
    mediaSource: "Fonte da imagem",
    mediaUnavailable: "Imagem indisponível",
    gridTitle: "Grade de interseções",
    gridEyebrow: "9 casas · 9 palpites",
    gridIntro: "Em cada casa, escolha um grupo que atenda ao critério da linha e ao da coluna.",
    gridGuessesLeft: (count) => (count === 1 ? "1 palpite restante" : `${count} palpites restantes`),
    gridCorrectCount: (correct, total) => `${correct} de ${total} casas certas`,
    gridCellLabel: (row, col, rowLabel, colLabel, status) => `Linha ${row + 1}, ${rowLabel}. Coluna ${col + 1}, ${colLabel}. ${status}`,
    gridCellEmpty: "Vazia. Escolha um grupo",
    gridCellSolved: (groupName) => `Certa: ${groupName}`,
    gridCellFailed: (lastAttempt) => (lastAttempt ? `Errada: você tentou ${lastAttempt}` : "Errada"),
    gridPickerTitle: "Escolha um grupo",
    gridPickerSearchPlaceholder: "Buscar grupo...",
    gridPickerSearchLabel: "Buscar grupo pelo nome",
    gridPickerNoMatches: "Nenhum grupo encontrado.",
    gridPickerResultsCount: (count) => (count === 1 ? "1 grupo encontrado" : `${count} grupos encontrados`),
    gridAlreadyUsedError: "este grupo já está em outra casa.",
    gridAlreadyUsedBadge: "Já usado",
    gridClosePicker: "Fechar",
    gridGameOverTitle: "Fim da partida",
    gridGameOverSummary: (correct, guesses) => `${correct} de 9 casas certas com ${guesses} palpites`,
    gridShareButton: "Compartilhar resultado",
    gridCopyButton: "Copiar resultado",
    gridCopiedNotice: "Resultado copiado.",
    gridHighContrastShare: "Versão sem cores (alto contraste)",
    gridReviewTitle: "Respostas e fontes",
    gridReviewCellHeader: (row, col) => `Linha ${row + 1}, coluna ${col + 1}`,
    gridAcceptedAnswers: "Respostas aceitas:",
    gridRestart: "Jogar novamente",
    gridShareHeader: (date, correct, guesses) => `K-pop Grid ${date}\n${correct}/9 acertos (${guesses} palpites)`,
    gridAxesHeader: "Critérios",
    gridShareMatrixAriaLabel: "Resultado da grade",
    gridCategoryDebut: "Estreia",
    gridCategoryAgency: "Agência",
    gridCategoryMembers: "Integrantes",
    connectionsTitle: "Conexões",
    connectionsEyebrow: "4 categorias · 16 nomes",
    connectionsIntro: "Separe os 16 nomes em 4 categorias de 4. Você pode errar 4 vezes.",
    connectionsMistakesRemaining: (count) => (count === 1 ? "1 erro restante" : `${count} erros restantes`),
    connectionsOneAway: "Quase. 3 desses nomes são da mesma categoria.",
    connectionsAlreadyGuessed: "Você já tentou essa combinação.",
    connectionsShuffle: "Embaralhar",
    connectionsDeselectAll: "Limpar seleção",
    connectionsSubmit: "Enviar",
    connectionsGameOverWon: "Você venceu",
    connectionsGameOverLost: "Fim da partida",
    connectionsResultSummaryWon: (mistakes) =>
      mistakes === 0 ? "Você não errou nenhuma vez." : `Você errou ${mistakes} ${mistakes === 1 ? "vez" : "vezes"}.`,
    connectionsResultSummaryLost: "Você usou os 4 erros permitidos.",
    connectionsShareResultLine: (solved) => `Resultado: ${solved}/4 categorias`,
    connectionsShareGuessesLine: (guesses, mistakes) =>
      `Palpites: ${guesses} (${mistakes} ${mistakes === 1 ? "erro" : "erros"})`,
    connectionsShareButton: "Compartilhar resultado",
    connectionsHighContrastShare: "Versão sem cores (alto contraste)",
    connectionsRestart: "Jogar novamente",
    connectionsItemAriaLabel: (name, selected) => `${name}, ${selected ? "selecionado" : "não selecionado"}`,
    connectionsCategorySolvedAria: (difficulty, label, items) => `Nível ${difficulty}: ${label}. Nomes: ${items}.`,
    connectionsBoardAria: "Tabuleiro do Conexões",
    connectionsSolvedAria: "Categorias encontradas",
    connectionsItemsAria: "Nomes para separar",
    connectionsLevelAria: "Nível",
    nameGuessTitle: "Adivinhe o nome",
    nameGuessEyebrow: "6 palpites · 1 nome por dia",
    nameGuessIntro: "Descubra o artista ou grupo de K-pop do dia. A cada palpite, as cores mostram quais letras estão certas.",
    nameGuess: {
      title: "Adivinhe o nome",
      subtitle: "Nome do dia",
      attemptsLeft: "Palpites restantes",
      enter: "ENVIAR",
      backspace: "APAGAR",
      notEnoughLetters: "Preencha todas as letras.",
      notInWordList: "Esse nome não está na lista de palpites aceitos.",
      wonTitle: "Você acertou!",
      lostTitle: "Não foi dessa vez",
      targetWas: "A resposta era",
      playAgain: "Jogar novamente",
      copyResults: "Compartilhar resultado",
      copied: "Resultado copiado.",
      highContrast: "Cores de alto contraste",
      hints: "Detalhes",
      debutYear: "Estreia",
      agency: "Agência",
      members: "Integrantes",
      evidenceLink: "Ver a fonte no Wikidata",
      loading: "Carregando o jogo de hoje...",
      loadError: "Não foi possível carregar o jogo.",
      artifactMissing: "O jogo de hoje ainda não foi publicado.",
      retry: "Tentar novamente",
      boardAria: "Palpites",
      rowAria: (row) => `Palpite ${row}`,
      emptyTile: (pos) => `Posição ${pos}: vazia`,
      activeTile: (pos, letter) => `Posição ${pos}: letra ${letter}`,
      correctTile: (pos, letter) => `Posição ${pos}: letra ${letter}, posição certa`,
      presentTile: (pos, letter) => `Posição ${pos}: letra ${letter}, está em outra posição`,
      absentTile: (pos, letter) => `Posição ${pos}: letra ${letter}, não está no nome`,
      keyboardAria: "Teclado",
      resultsAria: "Resultado da partida",
    },
    wordSearchTitle: "Caça-palavras",
    wordSearchEyebrow: "1 tema por dia · 8 direções",
    wordSearchIntro: "Encontre os nomes do tema escondidos na grade. Eles podem estar na horizontal, na vertical ou na diagonal, inclusive de trás para frente.",
    wordSearch: {
      title: "Caça-palavras",
      gridLabel: "Grade de letras",
      wordsHeading: "Palavras",
      wordsFound: "Encontradas",
      timerLabel: "Tempo",
      showWords: "Mostrar palavras",
      hideWords: "Esconder palavras",
      lettersCount: (count) => (count === 1 ? "1 letra" : `${count} letras`),
      selectionLabel: "Palavra:",
      selectionHint: "Selecione a primeira e a última letra de um nome, ou arraste de uma ponta à outra.",
      anchorHint: (letter) => `Primeira letra: ${letter}. Agora selecione a última letra do nome.`,
      shareResult: "Compartilhar resultado",
      copied: "Resultado copiado.",
      congratulations: "Parabéns!",
      allWordsFound: "Você encontrou todas as palavras.",
      elapsedTime: "Tempo total",
      viewEvidence: "Ver fontes",
      evidenceModalTitle: "Fontes",
      evidenceWikidataId: "ID no Wikidata:",
      evidenceClue: "Pista:",
      evidenceSourcesHeading: "Fontes consultadas",
      evidenceSource: "Fonte:",
      evidenceLocator: "Local na fonte:",
      evidenceRevision: "Revisão:",
      evidenceOpen: "Abrir a fonte",
      close: "Fechar",
      loading: "Carregando o caça-palavras de hoje...",
      loadError: "Não foi possível carregar o jogo.",
      artifactMissing: "O caça-palavras de hoje ainda não foi publicado.",
      retry: "Tentar novamente",
      wordFoundAnnouncement: (name, current, total) =>
        `Você encontrou ${name}. ${current} de ${total} palavras.`,
      gameCompleteAnnouncement: (total, time) =>
        `Parabéns! Você encontrou as ${total} palavras em ${time}.`,
      cellAria: (row, col, letter, isSelected, isFound) => {
        const state = isFound ? ", encontrada" : isSelected ? ", selecionada" : "";
        return `Linha ${row + 1}, coluna ${col + 1}, letra ${letter}${state}`;
      },
    },
    gameNavLabel: "Jogos de K-pop",
    gameQuiz: "Quiz",
    gameGrid: "Grade",
    gameConnections: "Conexões",
    gameNameGuess: "Adivinhe",
    gameWordSearch: "Caça-palavras",
    statsTitle: "Suas estatísticas",
    statsNavLabel: "Estatísticas",
    statsOpenButton: "Ver estatísticas e sequência",
    statsClose: "Fechar estatísticas",
    statsTabOverall: "Geral",
    statsPlayed: "Partidas",
    statsWinRate: "% de vitórias",
    statsCurrentStreak: "Sequência atual",
    statsMaxStreak: "Maior sequência",
    statsGuessDistribution: "Palpites por partida",
  },
  en: {
    meta: {
      quiz: {
        title: "K-pop Quiz: groups, members and dates",
        description: "10 multiple-choice questions on K-pop history. Every answer shows the source it came from.",
      },
      grid: {
        title: "Intersection grid: a 3x3 K-pop quiz",
        description: "Find a K-pop group for each crossing of agency, members and debut. 9 squares, 9 guesses.",
      },
      connections: {
        title: "Connections: sort 16 K-pop names",
        description: "Sort 16 K-pop names into 4 categories, such as agency, lineup or career milestones.",
      },
      nameGuess: {
        title: "Guess the name: today's artist or group",
        description: "Find today's K-pop artist or group in 6 guesses. Colors show which letters you got right.",
      },
      wordSearch: {
        title: "K-pop word search: find the names",
        description: "Find K-pop names hidden in the letter grid, in 8 directions. Every name has a source.",
      },
    },
    skipLinks: {
      quiz: "Skip to the quiz",
      grid: "Skip to the grid",
      connections: "Skip to the game",
      nameGuess: "Skip to the game",
      wordSearch: "Skip to the word search",
      privacy: "Skip to the privacy policy",
    },
    eyebrow: "10 questions · multiple choice",
    title: "How well do you know K-pop history?",
    intro: "Questions about groups, members and dates. Every answer shows its source.",
    languageLabel: "Language",
    languageName: "Português",
    homeLabel: "K-pop Quiz, home",
    attribution: "Data",
    and: "and",
    loading: "Loading the game...",
    loadError: "The game could not be loaded.",
    artifactMissing: "This game is not available in English yet.",
    artifactInvalid: "The game data could not be read.",
    errorDatasetIntegrity: "The game data could not be read.",
    retry: "Try again",
    reload: "Try again",
    empty: "This quiz has no questions yet.",
    consentLabel: "Privacy preferences",
    consentText:
      "We use Cloudflare Web Analytics to measure site usage without cookies. If you accept, Google Analytics will also use cookies and identifiers to produce audience statistics.",
    consentAccept: "Accept Google Analytics",
    consentReject: "Reject Google Analytics",
    consentPreferences: "Privacy preferences",
    consentPrivacyLink: "Read the privacy policy",
    privacyLink: "Privacy",
    howToPlayTitle: "How to play",
    quizHowToPlay: [
      "Pick a mode. Assisted shows clues, Standard lets you open a clue for a few points, and Expert has no clues.",
      "If you like, filter by the decade the groups formed and limit each question to 20 seconds.",
      "Answer 10 multiple-choice questions. Each correct answer adds points.",
      "After each answer, you see the correct answer and its source.",
    ],
    gridHowToPlay: [
      "Each square crosses a row rule with a column rule, such as agency, debut year or number of members.",
      "Pick a square and search for a group that fits both rules.",
      "You have 9 guesses for 9 squares. Wrong guesses count too.",
      "Each group fits one square only. Once a group is placed correctly, you can't use it again.",
    ],
    connectionsHowToPlay: [
      "The 16 names form 4 categories of 4, such as agency, lineup or career milestones.",
      "Select 4 names and submit. If they share a category, it leaves the board.",
      "You can make 4 mistakes. When 3 of your 4 names share a category, the game tells you.",
      "Color shows how hard a category is: yellow is the easiest and purple the hardest.",
    ],
    nameGuessHowToPlay: [
      "Find the name of a K-pop artist or group in up to 6 guesses.",
      "A guess must have as many letters as the name and be on the list of accepted names. Spaces and symbols are left out.",
      "Green: right letter, right spot. Yellow: the letter is in the name, in another spot. Gray: the letter is not in the name.",
      "With high-contrast colors on, blue replaces green and orange replaces yellow.",
    ],
    wordSearchHowToPlay: [
      "The theme's names are hidden in straight lines: across, down or diagonal, and they can run backwards.",
      "Select the first and last letter of a name, or drag from one end to the other.",
      "With a keyboard, move with the arrow keys and mark the start and end with Enter or Space.",
      "The list shows how many letters each name has. If you get stuck, use \"Show words\".",
    ],
    questionCounter: (current, total) => `Question ${current} of ${total}`,
    score: "Score",
    points: "points",
    setupKicker: "Before you start",
    setupTitle: "Set up your game",
    chooseDifficulty: "Choose a mode",
    chooseDecades: "Filter by formation decade",
    decadeHelp: "With no decade selected, the quiz uses all of them.",
    decadeLabel: (decade) => `${decade}s`,
    roundRules: "10 multiple-choice questions. After each answer, you see the source.",
    difficultyName: (difficulty) => ({ assisted: "Assisted", standard: "Standard", expert: "Expert" })[difficulty],
    difficultyDescription: (difficulty) => ({
      assisted: "Shows a clue whenever it doesn't give the answer away.",
      standard: "Starts with no clue. You can open one for a few points.",
      expert: "No clues. Each correct answer is worth more.",
    })[difficulty],
    start: "Start game",
    enableTimer: "Limit each question to 20 seconds",
    clue: "Clue",
    revealClue: (cost) => `Show clue (-${cost} points)`,
    clueRevealed: "Clue shown",
    time: "Time",
    seconds: "s",
    check: "Submit answer",
    next: "Next question",
    finish: "See results",
    correct: "Correct.",
    incorrect: "Not this time.",
    timedOut: "Time's up.",
    answerWas: "Correct answer",
    evidence: "Answer source",
    revision: "revision",
    declaredReference: "Cited reference",
    openRevision: (project) => `Open the revision on ${project}`,
    resultTitle: "Game over",
    resultText: (score) => `You scored ${score} points.`,
    restart: "Play again",
    chooseAnswer: "Choose an answer to continue.",
    themeLabel: "Theme",
    themeAuto: "System theme",
    themeLight: "Light theme",
    themeDark: "Dark theme",
    totalTime: "Total time",
    cluesUsed: "Clues used",
    shareHints: (count) => (count === 1 ? "1 clue" : `${count} clues`),
    correctCountLabel: "Correct answers",
    share: "Share result",
    copyResult: "Copy result",
    copiedToClipboard: "Result copied.",
    shareTextLabel: "Result text",
    reviewTitle: "Your answers",
    yourAnswer: "Your answer",
    correctAnswer: "Correct answer",
    noAnswer: "No answer",
    collectionTitle: "Choose a game",
    generalGameTitle: "General quiz",
    generalGameDescription: "Questions about history, releases and members.",
    dailyGameTitle: "Daily quiz",
    dailyGameDescription: "Today's questions, with a result you can share.",
    shareDailyHeader: (date, correct, total) => `K-pop Quiz Daily ${date} ${correct}/${total}`,
    mediaAltClue: "Photo used as a clue for this question",
    mediaCreator: "Photo:",
    mediaSource: "Image source",
    mediaUnavailable: "Image unavailable",
    gridTitle: "Intersection grid",
    gridEyebrow: "9 squares · 9 guesses",
    gridIntro: "In each square, pick a group that fits both the row rule and the column rule.",
    gridGuessesLeft: (count) => (count === 1 ? "1 guess left" : `${count} guesses left`),
    gridCorrectCount: (correct, total) => `${correct} of ${total} squares correct`,
    gridCellLabel: (row, col, rowLabel, colLabel, status) => `Row ${row + 1}, ${rowLabel}. Column ${col + 1}, ${colLabel}. ${status}`,
    gridCellEmpty: "Empty. Pick a group",
    gridCellSolved: (groupName) => `Correct: ${groupName}`,
    gridCellFailed: (lastAttempt) => (lastAttempt ? `Wrong: you tried ${lastAttempt}` : "Wrong"),
    gridPickerTitle: "Pick a group",
    gridPickerSearchPlaceholder: "Search groups...",
    gridPickerSearchLabel: "Search groups by name",
    gridPickerNoMatches: "No groups found.",
    gridPickerResultsCount: (count) => (count === 1 ? "1 group found" : `${count} groups found`),
    gridAlreadyUsedError: "this group is already in another square.",
    gridAlreadyUsedBadge: "Already used",
    gridClosePicker: "Close",
    gridGameOverTitle: "Game over",
    gridGameOverSummary: (correct, guesses) => `${correct} of 9 squares correct in ${guesses} guesses`,
    gridShareButton: "Share result",
    gridCopyButton: "Copy result",
    gridCopiedNotice: "Result copied.",
    gridHighContrastShare: "No-color version (high contrast)",
    gridReviewTitle: "Answers and sources",
    gridReviewCellHeader: (row, col) => `Row ${row + 1}, column ${col + 1}`,
    gridAcceptedAnswers: "Accepted answers:",
    gridRestart: "Play again",
    gridShareHeader: (date, correct, guesses) => `K-pop Grid ${date}\n${correct}/9 correct (${guesses} guesses)`,
    gridAxesHeader: "Rules",
    gridShareMatrixAriaLabel: "Grid result",
    gridCategoryDebut: "Debut",
    gridCategoryAgency: "Agency",
    gridCategoryMembers: "Members",
    connectionsTitle: "Connections",
    connectionsEyebrow: "4 categories · 16 names",
    connectionsIntro: "Sort the 16 names into 4 categories of 4. You can make 4 mistakes.",
    connectionsMistakesRemaining: (count) => (count === 1 ? "1 mistake left" : `${count} mistakes left`),
    connectionsOneAway: "Close. 3 of these names share a category.",
    connectionsAlreadyGuessed: "You already tried this combination.",
    connectionsShuffle: "Shuffle",
    connectionsDeselectAll: "Clear selection",
    connectionsSubmit: "Submit",
    connectionsGameOverWon: "You won",
    connectionsGameOverLost: "Game over",
    connectionsResultSummaryWon: (mistakes) =>
      mistakes === 0 ? "No mistakes." : `${mistakes} ${mistakes === 1 ? "mistake" : "mistakes"}.`,
    connectionsResultSummaryLost: "You used all 4 mistakes.",
    connectionsShareResultLine: (solved) => `Result: ${solved}/4 categories`,
    connectionsShareGuessesLine: (guesses, mistakes) =>
      `Guesses: ${guesses} (${mistakes} ${mistakes === 1 ? "mistake" : "mistakes"})`,
    connectionsShareButton: "Share result",
    connectionsHighContrastShare: "No-color version (high contrast)",
    connectionsRestart: "Play again",
    connectionsItemAriaLabel: (name, selected) => `${name}, ${selected ? "selected" : "not selected"}`,
    connectionsCategorySolvedAria: (difficulty, label, items) => `Level ${difficulty}: ${label}. Names: ${items}.`,
    connectionsBoardAria: "Connections board",
    connectionsSolvedAria: "Categories found",
    connectionsItemsAria: "Names to sort",
    connectionsLevelAria: "Level",
    nameGuessTitle: "Guess the name",
    nameGuessEyebrow: "6 guesses · 1 name a day",
    nameGuessIntro: "Find today's K-pop artist or group. After each guess, colors show which letters are right.",
    nameGuess: {
      title: "Guess the name",
      subtitle: "Today's name",
      attemptsLeft: "Guesses left",
      enter: "ENTER",
      backspace: "DEL",
      notEnoughLetters: "Fill in every letter.",
      notInWordList: "That name isn't on the list of accepted guesses.",
      wonTitle: "You got it!",
      lostTitle: "Not this time",
      targetWas: "The answer was",
      playAgain: "Play again",
      copyResults: "Share result",
      copied: "Result copied.",
      highContrast: "High-contrast colors",
      hints: "Details",
      debutYear: "Debut",
      agency: "Agency",
      members: "Members",
      evidenceLink: "See the source on Wikidata",
      loading: "Loading today's game...",
      loadError: "The game could not be loaded.",
      artifactMissing: "Today's game has not been published yet.",
      retry: "Try again",
      boardAria: "Guesses",
      rowAria: (row) => `Guess ${row}`,
      emptyTile: (pos) => `Position ${pos}: empty`,
      activeTile: (pos, letter) => `Position ${pos}: letter ${letter}`,
      correctTile: (pos, letter) => `Position ${pos}: letter ${letter}, right spot`,
      presentTile: (pos, letter) => `Position ${pos}: letter ${letter}, in another spot`,
      absentTile: (pos, letter) => `Position ${pos}: letter ${letter}, not in the name`,
      keyboardAria: "Keyboard",
      resultsAria: "Game result",
    },
    wordSearchTitle: "Word search",
    wordSearchEyebrow: "1 theme a day · 8 directions",
    wordSearchIntro: "Find the theme's names hidden in the grid. They can run across, down or diagonally, and backwards too.",
    wordSearch: {
      title: "Word search",
      gridLabel: "Letter grid",
      wordsHeading: "Words",
      wordsFound: "Found",
      timerLabel: "Time",
      showWords: "Show words",
      hideWords: "Hide words",
      lettersCount: (count) => (count === 1 ? "1 letter" : `${count} letters`),
      selectionLabel: "Word:",
      selectionHint: "Select the first and last letter of a name, or drag from one end to the other.",
      anchorHint: (letter) => `First letter: ${letter}. Now select the last letter of the name.`,
      shareResult: "Share result",
      copied: "Result copied.",
      congratulations: "Well done!",
      allWordsFound: "You found every word.",
      elapsedTime: "Total time",
      viewEvidence: "See sources",
      evidenceModalTitle: "Sources",
      evidenceWikidataId: "Wikidata ID:",
      evidenceClue: "Clue:",
      evidenceSourcesHeading: "Sources used",
      evidenceSource: "Source:",
      evidenceLocator: "Location in source:",
      evidenceRevision: "Revision:",
      evidenceOpen: "Open the source",
      close: "Close",
      loading: "Loading today's word search...",
      loadError: "The game could not be loaded.",
      artifactMissing: "Today's word search has not been published yet.",
      retry: "Try again",
      wordFoundAnnouncement: (name, current, total) =>
        `You found ${name}. ${current} of ${total} words.`,
      gameCompleteAnnouncement: (total, time) =>
        `Well done! You found all ${total} words in ${time}.`,
      cellAria: (row, col, letter, isSelected, isFound) => {
        const state = isFound ? ", found" : isSelected ? ", selected" : "";
        return `Row ${row + 1}, column ${col + 1}, letter ${letter}${state}`;
      },
    },
    gameNavLabel: "K-pop games",
    gameQuiz: "Quiz",
    gameGrid: "Grid",
    gameConnections: "Connections",
    gameNameGuess: "Guess",
    gameWordSearch: "Word search",
    statsTitle: "Your stats",
    statsNavLabel: "Stats",
    statsOpenButton: "See stats and streak",
    statsClose: "Close stats",
    statsTabOverall: "Overall",
    statsPlayed: "Played",
    statsWinRate: "Win %",
    statsCurrentStreak: "Current streak",
    statsMaxStreak: "Best streak",
    statsGuessDistribution: "Guesses per game",
  },
};

export function getMessages(locale: Locale): Messages {
  return catalogs[locale];
}
