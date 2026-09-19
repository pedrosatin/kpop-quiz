import type { Locale, PlayMode } from "../lib/quiz-types";

export interface Messages {
  skipLink: string;
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
  questionCounter: (current: number, total: number) => string;
  score: string;
  points: string;
  setupKicker: string;
  chooseDifficulty: string;
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
  explanationLabel: string;
  collectionTitle: string;
  collectionKicker: string;
  generalGameTitle: string;
  generalGameDescription: string;
  dailyGameTitle: string;
  dailyGameDescription: string;
  themeHistory: string;
  themeDaily: string;
  shareDailyHeader: (date: string, correct: number, total: number) => string;
  mediaAltClue: string;
  mediaCreator: string;
  mediaLicense: string;
  mediaSource: string;
  mediaUnavailable: string;
  gridTitle: string;
  gridEyebrow: string;
  gridIntro: string;
  gridGameTitle: string;
  gridGameDescription: string;
  gridGuessesLeft: (count: number) => string;
  gridCorrectCount: (correct: number, total: number) => string;
  gridCellLabel: (row: number, col: number, rowLabel: string, colLabel: string, status: string) => string;
  gridCellEmpty: string;
  gridCellSolved: (groupName: string) => string;
  gridCellFailed: (lastAttempt?: string) => string;
  gridPickerTitle: string;
  gridPickerInstructions: string;
  gridPickerSearchPlaceholder: string;
  gridPickerSearchLabel: string;
  gridPickerNoMatches: string;
  gridPickerResultsCount: (count: number) => string;
  gridAlreadyUsedError: string;
  gridAlreadyUsedBadge: string;
  gridSelectButton: string;
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
  gridEvidenceSource: string;
  gridRestart: string;
  gridModeLink: string;
  quizModeLink: string;
  gridShareHeader: (date: string, correct: number, guesses: number) => string;
  gridAxesHeader: string;
  gridShareMatrixAriaLabel: string;
  gridCategoryDebut: string;
  gridCategoryAgency: string;
  gridCategoryMembers: string;
  connectionsTitle: string;
  connectionsEyebrow: string;
  connectionsIntro: string;
  connectionsGameTitle: string;
  connectionsGameDescription: string;
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
  connectionsShareButton: string;
  connectionsHighContrastShare: string;
  connectionsRestart: string;
  connectionsModeLink: string;
  connectionsItemAriaLabel: (name: string, selected: boolean) => string;
  connectionsCategorySolvedAria: (difficulty: number, label: string, items: string) => string;
  connectionsBoardAria: string;
  connectionsSolvedAria: string;
  connectionsItemsAria: string;
  connectionsLevelAria: string;
  nameGuessTitle: string;
  nameGuessEyebrow: string;
  nameGuessIntro: string;
  nameGuessGameTitle: string;
  nameGuessGameDescription: string;
  nameGuessModeLink: string;
  wordSearchTitle: string;
  wordSearchEyebrow: string;
  wordSearchIntro: string;
  wordSearchGameTitle: string;
  wordSearchGameDescription: string;
  wordSearchModeLink: string;
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
  statsWon: string;
  statsWinRate: string;
  statsCurrentStreak: string;
  statsMaxStreak: string;
  statsGuessDistribution: string;
  statsNoData: string;
}

const catalogs: Record<Locale, Messages> = {
  "pt-BR": {
    skipLink: "Pular para o quiz",
    eyebrow: "10 perguntas · múltipla escolha",
    title: "Você conhece a história do K-pop?",
    intro: "Grupos, integrantes e datas com fontes consultáveis a cada resposta.",
    languageLabel: "Idioma",
    languageName: "English",
    homeLabel: "K-pop Quiz, início",
    attribution: "Dados",
    and: "e",
    loading: "Preparando as perguntas...",
    loadError: "Não foi possível abrir este quiz.",
    artifactMissing: "As perguntas deste idioma ainda não foram publicadas.",
    artifactInvalid: "O arquivo de perguntas publicado é inválido.",
    errorDatasetIntegrity: "O arquivo de perguntas publicado é inválido.",
    retry: "Tentar novamente",
    reload: "Tentar novamente",
    empty: "Este quiz ainda não tem perguntas.",
    questionCounter: (current, total) => `Pergunta ${current} de ${total}`,
    score: "Pontos",
    points: "pontos",
    setupKicker: "Antes da rodada",
    chooseDifficulty: "Escolha como jogar",
    roundRules: "10 perguntas de múltipla escolha com fontes verificáveis a cada resposta.",
    difficultyName: (difficulty) => ({ assisted: "Assistido", standard: "Padrão", expert: "Especialista" })[difficulty],
    difficultyDescription: (difficulty) => ({
      assisted: "Mostra uma pista factual quando ela não entrega a resposta.",
      standard: "Começa sem pista. Você pode revelar uma com desconto na pontuação.",
      expert: "Sem pistas e com maior pontuação por acerto.",
    })[difficulty],
    start: "Começar rodada",
    enableTimer: "Usar 20 segundos por pergunta",
    clue: "Pista",
    revealClue: (cost) => `Revelar pista (-${cost} pontos)`,
    clueRevealed: "Pista revelada",
    time: "Tempo",
    seconds: "s",
    check: "Responder",
    next: "Próxima pergunta",
    finish: "Ver resultado",
    correct: "Acertou.",
    incorrect: "Não foi dessa vez.",
    timedOut: "O tempo acabou.",
    answerWas: "Resposta correta",
    evidence: "Fonte da resposta",
    revision: "revisão",
    declaredReference: "Referência declarada",
    openRevision: (project) => `Abrir revisão no ${project}`,
    resultTitle: "Fim da rodada",
    resultText: (score) => `Você terminou a rodada com ${score} pontos.`,
    restart: "Jogar novamente",
    chooseAnswer: "Escolha uma resposta antes de continuar.",
    themeLabel: "Tema",
    themeAuto: "Sistema",
    themeLight: "Claro",
    themeDark: "Escuro",
    totalTime: "Tempo total",
    cluesUsed: "Pistas reveladas",
    shareHints: (count) => (count === 1 ? "1 pista" : `${count} pistas`),
    correctCountLabel: "Acertos",
    share: "Compartilhar resultado",
    copyResult: "Copiar resultado",
    copiedToClipboard: "Copiado para a área de transferência.",
    shareTextLabel: "Texto para cópia",
    reviewTitle: "Revisão das respostas",
    yourAnswer: "Sua resposta",
    correctAnswer: "Gabarito",
    noAnswer: "Sem resposta",
    explanationLabel: "Explicação",
    collectionTitle: "Escolha o jogo",
    collectionKicker: "Coleção de jogos",
    generalGameTitle: "Quiz geral",
    generalGameDescription: "Perguntas sobre história, lançamentos e integrantes.",
    dailyGameTitle: "Partida diária",
    dailyGameDescription: "Perguntas do dia com resultado compartilhável por data.",
    themeHistory: "História do K-pop",
    themeDaily: "Partida diária",
    shareDailyHeader: (date, correct, total) => `K-pop Quiz Diário ${date} ${correct}/${total}`,
    mediaAltClue: "Foto usada como pista desta pergunta",
    mediaCreator: "Foto por",
    mediaLicense: "Licença",
    mediaSource: "Fonte da imagem",
    mediaUnavailable: "Imagem indisponível",
    gridTitle: "Grade de Interseções",
    gridEyebrow: "9 células · 9 palpites",
    gridIntro: "Cruze critérios de linhas e colunas para escolher grupos musicais válidos.",
    gridGameTitle: "Grade de Interseções",
    gridGameDescription: "Matriz 3x3 com critérios cruzados de gravadora, integrantes e data.",
    gridGuessesLeft: (count) => (count === 1 ? "1 palpite restante" : `${count} palpites restantes`),
    gridCorrectCount: (correct, total) => `${correct}/${total} células corretas`,
    gridCellLabel: (row, col, rowLabel, colLabel, status) => `Linha ${row + 1}: ${rowLabel}, Coluna ${col + 1}: ${colLabel}. Estado: ${status}`,
    gridCellEmpty: "Vazia. Pressione para escolher um grupo",
    gridCellSolved: (groupName) => `Correta: ${groupName}`,
    gridCellFailed: (lastAttempt) => (lastAttempt ? `Incorreta: tentou ${lastAttempt}` : "Incorreta"),
    gridPickerTitle: "Selecione o grupo musical",
    gridPickerInstructions: "Digite para filtrar pelo nome do grupo.",
    gridPickerSearchPlaceholder: "Buscar grupo...",
    gridPickerSearchLabel: "Buscar grupo por nome",
    gridPickerNoMatches: "Nenhum grupo encontrado.",
    gridPickerResultsCount: (count) => (count === 1 ? "1 grupo encontrado" : `${count} grupos encontrados`),
    gridAlreadyUsedError: "Este grupo já foi utilizado nesta partida.",
    gridAlreadyUsedBadge: "Já utilizado",
    gridSelectButton: "Confirmar palpite",
    gridClosePicker: "Fechar seletor",
    gridGameOverTitle: "Fim da partida",
    gridGameOverSummary: (correct, guesses) => `${correct}/9 acertos (${guesses} palpites usados)`,
    gridShareButton: "Compartilhar grade",
    gridCopyButton: "Copiar resultado",
    gridCopiedNotice: "Resultado copiado para a área de transferência.",
    gridHighContrastShare: "Versão monocromática (alto contraste)",
    gridReviewTitle: "Revisão factual da grade",
    gridReviewCellHeader: (row, col) => `Célula (${row + 1}, ${col + 1})`,
    gridAcceptedAnswers: "Respostas aceitas no catálogo:",
    gridEvidenceSource: "Fonte factual:",
    gridRestart: "Jogar novamente",
    gridModeLink: "Jogar Grade de Interseções",
    quizModeLink: "Jogar Quiz tradicional",
    gridShareHeader: (date, correct, guesses) => `K-pop Grid ${date}\n${correct}/9 acertos (${guesses} palpites)`,
    gridAxesHeader: "Eixos",
    gridShareMatrixAriaLabel: "Matriz de resultado",
    gridCategoryDebut: "Estreia",
    gridCategoryAgency: "Empresa",
    gridCategoryMembers: "Formação",
    connectionsTitle: "Palavras conectadas",
    connectionsEyebrow: "4 grupos · 16 itens",
    connectionsIntro: "Agrupe quatro itens que compartilham uma conexão factual.",
    connectionsGameTitle: "Palavras conectadas",
    connectionsGameDescription: "Agrupamento 4x4 de grupos de K-pop por agência, formação e marcos.",
    connectionsMistakesRemaining: (count) => (count === 1 ? "1 tentativa restante" : `${count} tentativas restantes`),
    connectionsOneAway: "Falta 1...",
    connectionsAlreadyGuessed: "Você já tentou este palpite.",
    connectionsShuffle: "Embaralhar",
    connectionsDeselectAll: "Desmarcar tudo",
    connectionsSubmit: "Enviar",
    connectionsGameOverWon: "Vitória",
    connectionsGameOverLost: "Fim da partida",
    connectionsResultSummaryWon: (mistakes) => (mistakes === 0 ? "Perfeito! Nenhum erro cometido." : `Concluído com ${mistakes} ${mistakes === 1 ? "erro" : "erros"}.`),
    connectionsResultSummaryLost: "Você esgotou as quatro tentativas.",
    connectionsShareButton: "Compartilhar resultado",
    connectionsHighContrastShare: "Versão monocromática (alto contraste)",
    connectionsRestart: "Jogar novamente",
    connectionsModeLink: "Jogar Palavras conectadas",
    connectionsItemAriaLabel: (name, selected) => `${name}, ${selected ? "selecionado" : "não selecionado"}`,
    connectionsCategorySolvedAria: (difficulty, label, items) => `Nível ${difficulty}: ${label}. Itens: ${items}.`,
    connectionsBoardAria: "Tabuleiro de Palavras Conectadas",
    connectionsSolvedAria: "Categorias resolvidas",
    connectionsItemsAria: "Itens para agrupamento",
    connectionsLevelAria: "Nível",
    nameGuessTitle: "Adivinhe o Nome",
    nameGuessEyebrow: "6 tentativas · 1 entidade diária",
    nameGuessIntro: "Descubra a entidade de K-pop com retorno de cores a cada palpite.",
    nameGuessGameTitle: "Adivinhe o Nome",
    nameGuessGameDescription: "Adivinhe o nome de um artista ou grupo de K-pop em até 6 tentativas com letras coloridas.",
    nameGuessModeLink: "Jogar Adivinhe o Nome",
    wordSearchTitle: "Caça-Palavras K-pop",
    wordSearchEyebrow: "Grade temática · Palavras auditadas",
    wordSearchIntro: "Encontre os nomes temáticos escondidos na grade alfabética com fontes verificadas.",
    wordSearchGameTitle: "Caça-Palavras K-pop",
    wordSearchGameDescription: "Localize nomes temáticos escondidos em 8 direções na grade alfabética.",
    wordSearchModeLink: "Jogar Caça-Palavras",
    gameNavLabel: "Jogos diários de K-pop",
    gameQuiz: "Quiz",
    gameGrid: "Grade",
    gameConnections: "Conexões",
    gameNameGuess: "Adivinhe",
    gameWordSearch: "Caça-Palavras",
    statsTitle: "Estatísticas do jogador",
    statsNavLabel: "Estatísticas",
    statsOpenButton: "Ver estatísticas e sequência diária",
    statsClose: "Fechar estatísticas",
    statsTabOverall: "Geral",
    statsPlayed: "Partidas",
    statsWon: "Vitórias",
    statsWinRate: "Taxa de vitória",
    statsCurrentStreak: "Sequência atual",
    statsMaxStreak: "Maior sequência",
    statsGuessDistribution: "Distribuição de tentativas",
    statsNoData: "Nenhuma partida registrada nesta categoria.",
  },
  en: {
    skipLink: "Skip to quiz",
    eyebrow: "10 questions · multiple choice",
    title: "How well do you know K-pop history?",
    intro: "Groups, members and dates, with a source for every answer.",
    languageLabel: "Language",
    languageName: "Português",
    homeLabel: "K-pop Quiz, home",
    attribution: "Data",
    and: "and",
    loading: "Preparing the questions...",
    loadError: "This quiz could not be opened.",
    artifactMissing: "Questions for this language have not been published yet.",
    artifactInvalid: "The published question file is invalid.",
    errorDatasetIntegrity: "The published question file is invalid.",
    retry: "Try again",
    reload: "Try again",
    empty: "This quiz has no questions yet.",
    questionCounter: (current, total) => `Question ${current} of ${total}`,
    score: "Score",
    points: "points",
    setupKicker: "Before the round",
    chooseDifficulty: "Choose how to play",
    roundRules: "10 multiple choice questions with verifiable sources for every answer.",
    difficultyName: (difficulty) => ({ assisted: "Assisted", standard: "Standard", expert: "Expert" })[difficulty],
    difficultyDescription: (difficulty) => ({
      assisted: "Shows a factual clue when it does not give away the answer.",
      standard: "Starts without a clue. You can reveal one at a point cost.",
      expert: "No clues and more points for each correct answer.",
    })[difficulty],
    start: "Start round",
    enableTimer: "Use 20 seconds per question",
    clue: "Clue",
    revealClue: (cost) => `Reveal clue (-${cost} points)`,
    clueRevealed: "Clue revealed",
    time: "Time",
    seconds: "s",
    check: "Submit answer",
    next: "Next question",
    finish: "See results",
    correct: "Correct.",
    incorrect: "Not this time.",
    timedOut: "Time is up.",
    answerWas: "Correct answer",
    evidence: "Answer source",
    revision: "revision",
    declaredReference: "Declared reference",
    openRevision: (project) => `Open revision on ${project}`,
    resultTitle: "Round complete",
    resultText: (score) => `You finished the round with ${score} points.`,
    restart: "Play again",
    chooseAnswer: "Choose an answer before continuing.",
    themeLabel: "Theme",
    themeAuto: "System",
    themeLight: "Light",
    themeDark: "Dark",
    totalTime: "Total time",
    cluesUsed: "Clues revealed",
    shareHints: (count) => (count === 1 ? "1 hint" : `${count} hints`),
    correctCountLabel: "Correct answers",
    share: "Share result",
    copyResult: "Copy result",
    copiedToClipboard: "Copied to clipboard.",
    shareTextLabel: "Text to copy",
    reviewTitle: "Review answers",
    yourAnswer: "Your answer",
    correctAnswer: "Correct answer",
    noAnswer: "No answer",
    explanationLabel: "Explanation",
    collectionTitle: "Choose game",
    collectionKicker: "Game collection",
    generalGameTitle: "General quiz",
    generalGameDescription: "Questions about history, releases and members.",
    dailyGameTitle: "Daily quiz",
    dailyGameDescription: "Today's questions with a shareable result by date.",
    themeHistory: "K-pop history",
    themeDaily: "Daily quiz",
    shareDailyHeader: (date, correct, total) => `K-pop Quiz Daily ${date} ${correct}/${total}`,
    mediaAltClue: "Photo used as a clue for this question",
    mediaCreator: "Photo by",
    mediaLicense: "License",
    mediaSource: "Image source",
    mediaUnavailable: "Image unavailable",
    gridTitle: "Intersection Grid",
    gridEyebrow: "9 cells · 9 guesses",
    gridIntro: "Cross row and column criteria to select valid musical groups.",
    gridGameTitle: "Intersection Grid",
    gridGameDescription: "3x3 matrix with intersecting criteria for labels, members and dates.",
    gridGuessesLeft: (count) => (count === 1 ? "1 guess remaining" : `${count} guesses remaining`),
    gridCorrectCount: (correct, total) => `${correct}/${total} correct cells`,
    gridCellLabel: (row, col, rowLabel, colLabel, status) => `Row ${row + 1}: ${rowLabel}, Column ${col + 1}: ${colLabel}. Status: ${status}`,
    gridCellEmpty: "Empty. Press to select a group",
    gridCellSolved: (groupName) => `Solved: ${groupName}`,
    gridCellFailed: (lastAttempt) => (lastAttempt ? `Incorrect: tried ${lastAttempt}` : "Incorrect"),
    gridPickerTitle: "Select musical group",
    gridPickerInstructions: "Type to filter by group name.",
    gridPickerSearchPlaceholder: "Search group...",
    gridPickerSearchLabel: "Search group by name",
    gridPickerNoMatches: "No groups found.",
    gridPickerResultsCount: (count) => (count === 1 ? "1 group found" : `${count} groups found`),
    gridAlreadyUsedError: "This group was already used in this match.",
    gridAlreadyUsedBadge: "Already used",
    gridSelectButton: "Confirm guess",
    gridClosePicker: "Close selector",
    gridGameOverTitle: "Match finished",
    gridGameOverSummary: (correct, guesses) => `${correct}/9 correct (${guesses} guesses used)`,
    gridShareButton: "Share grid",
    gridCopyButton: "Copy result",
    gridCopiedNotice: "Result copied to clipboard.",
    gridHighContrastShare: "Monochrome version (high contrast)",
    gridReviewTitle: "Factual grid review",
    gridReviewCellHeader: (row, col) => `Cell (${row + 1}, ${col + 1})`,
    gridAcceptedAnswers: "Accepted catalog answers:",
    gridEvidenceSource: "Factual source:",
    gridRestart: "Play again",
    gridModeLink: "Play Intersection Grid",
    quizModeLink: "Play traditional Quiz",
    gridShareHeader: (date, correct, guesses) => `K-pop Grid ${date}\n${correct}/9 correct (${guesses} guesses)`,
    gridAxesHeader: "Axes",
    gridShareMatrixAriaLabel: "Result matrix",
    gridCategoryDebut: "Debut",
    gridCategoryAgency: "Agency",
    gridCategoryMembers: "Members",
    connectionsTitle: "Connections",
    connectionsEyebrow: "4 groups · 16 items",
    connectionsIntro: "Group four items that share a factual connection.",
    connectionsGameTitle: "Connections",
    connectionsGameDescription: "4x4 grouping of K-pop groups by agency, lineup, and milestones.",
    connectionsMistakesRemaining: (count) => (count === 1 ? "1 mistake remaining" : `${count} mistakes remaining`),
    connectionsOneAway: "One away...",
    connectionsAlreadyGuessed: "You already tried this guess.",
    connectionsShuffle: "Shuffle",
    connectionsDeselectAll: "Deselect all",
    connectionsSubmit: "Submit",
    connectionsGameOverWon: "Victory",
    connectionsGameOverLost: "Game over",
    connectionsResultSummaryWon: (mistakes) => (mistakes === 0 ? "Perfect! No mistakes made." : `Solved with ${mistakes} ${mistakes === 1 ? "mistake" : "mistakes"}.`),
    connectionsResultSummaryLost: "You used all four mistakes.",
    connectionsShareButton: "Share result",
    connectionsHighContrastShare: "Monochrome version (high contrast)",
    connectionsRestart: "Play again",
    connectionsModeLink: "Play Connections",
    connectionsItemAriaLabel: (name, selected) => `${name}, ${selected ? "selected" : "not selected"}`,
    connectionsCategorySolvedAria: (difficulty, label, items) => `Level ${difficulty}: ${label}. Items: ${items}.`,
    connectionsBoardAria: "Connections game board",
    connectionsSolvedAria: "Solved categories",
    connectionsItemsAria: "Items to group",
    connectionsLevelAria: "Level",
    nameGuessTitle: "Guess the Name",
    nameGuessEyebrow: "6 attempts · 1 daily entity",
    nameGuessIntro: "Figure out the K-pop entity name with color feedback on every guess.",
    nameGuessGameTitle: "Guess the Name",
    nameGuessGameDescription: "Guess the K-pop artist or group name within 6 attempts with colored letter feedback.",
    nameGuessModeLink: "Play Guess the Name",
    wordSearchTitle: "K-pop Word Search",
    wordSearchEyebrow: "Thematic grid · Audited words",
    wordSearchIntro: "Find the thematic names hidden in the letter grid with verified sources.",
    wordSearchGameTitle: "K-pop Word Search",
    wordSearchGameDescription: "Find thematic names hidden in 8 directions across the letter grid.",
    wordSearchModeLink: "Play Word Search",
    gameNavLabel: "Daily K-pop games",
    gameQuiz: "Quiz",
    gameGrid: "Grid",
    gameConnections: "Connections",
    gameNameGuess: "Name Guess",
    gameWordSearch: "Word Search",
    statsTitle: "Player statistics",
    statsNavLabel: "Stats",
    statsOpenButton: "View statistics and daily streak",
    statsClose: "Close statistics",
    statsTabOverall: "Overall",
    statsPlayed: "Played",
    statsWon: "Won",
    statsWinRate: "Win rate",
    statsCurrentStreak: "Current streak",
    statsMaxStreak: "Max streak",
    statsGuessDistribution: "Guess distribution",
    statsNoData: "No matches recorded in this category.",
  },
};

export function getMessages(locale: Locale): Messages {
  return catalogs[locale];
}
