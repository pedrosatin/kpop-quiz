import type { GameId } from "../lib/player-stats";
import type { Locale, PlayMode } from "../lib/quiz-types";
import { gameAbout, type GameAboutMessages } from "./game-about";
import { sourceCopy, type SourceMessages } from "./source";

export type SeoRouteKey = "quiz" | "grid" | "connections" | "nameGuess" | "wordSearch" | "mapPilot" | "timeline" | "code" | "crossword";

export type SkipLinkKey = SeoRouteKey | "privacy" | "notFound";

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
  /** Said once when a letter is typed into a full row. */
  tooManyLetters: (length: number) => string;
  notInWordList: string;
  alreadyGuessed: string;
  wonTitle: string;
  lostTitle: string;
  targetWas: string;
  copyResults: string;
  copied: string;
  /** Shown when neither the share sheet nor the clipboard took the result. */
  shareFailed: string;
  shareTextLabel: string;
  highContrast: string;
  showSource: string;
  hideSource: string;
  debutYear: string;
  agency: string;
  members: string;
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
  foundState: string;
  progress: (found: number, total: number) => string;
  progressAnnouncement: (found: number, total: number) => string;
  foundFeedback: (name: string) => string;
  repeatFeedback: (name: string) => string;
  missFeedback: (letters: string) => string;
  congratulations: string;
  resultSummary: (total: number, time: string) => string;
  evidenceWikidataId: string;
  evidenceClue: string;
  loading: string;
  loadError: string;
  artifactMissing: string;
  retry: string;
  cellAria: (row: number, col: number, letter: string, isSelected: boolean, isFound: boolean, isRevealed?: boolean) => string;
}

export interface Messages {
  meta: Record<SeoRouteKey, SeoMeta>;
  /** Static copy under each game page (How to play, data sources, FAQ). */
  about: GameAboutMessages;
  /** One cited revision in a "Ver fonte" panel: site, revision, place and link. */
  source: SourceMessages;
  skipLinks: Record<SkipLinkKey, string>;
  overview: {
    title: string;
    intro: string;
    modesTitle: string;
    modesBody: string;
    games: Record<SeoRouteKey, { title: string; description: string }>;
    quizTitle: string;
    quizBody: string;
    settingsBody: string;
    recordsTitle: string;
    recordsBody: string;
  };
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
  /** General quiz: the filter has fewer than ten eligible questions. */
  quizReplayUnavailable: string;
  /** General quiz result: exactly ten eligible questions, so Play again repeats the set. */
  quizReplayRepeats: string;
  /**
   * General quiz result: catalog absent, so the round uses the published legacy
   * session and "Play again" repeats those same questions.
   */
  quizReplayLegacyRepeats: string;
  /** Saved progress exists but does not match the current artifact or config. */
  quizResumeIncompatible: string;
  /** Setup notice of the daily theme once the day's quiz is counted; a new round does not count. */
  quizDailyDone: string;
  /** Saved progress is corrupt or fails schema checks. */
  quizResumeInvalid: string;
  /** localStorage is unavailable; the round continues without persistence. */
  quizStorageUnavailable: string;
  consentLabel: string;
  consentText: string;
  /** Verb on the accept button; the button reads "<verb> <consentTool>". */
  consentAccept: string;
  /** Verb on the reject button; the button reads "<verb> <consentTool>". */
  consentReject: string;
  /** The optional tool both consent buttons name. */
  consentTool: string;
  consentPreferences: string;
  consentPrivacyLink: string;
  privacyLink: string;
  howToPlayTitle: string;
  quizHowToPlay: string[];
  gridHowToPlay: string[];
  connectionsHowToPlay: string[];
  nameGuessHowToPlay: string[];
  wordSearchHowToPlay: string[];
  mapHowToPlay: string[];
  timelineHowToPlay: string[];
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
  /** Collapsed group of the setup that holds the mode, the timer and the decades. */
  customize: string;
  /** One line under "Customize" with the current mode, timer and decades. */
  customizeSummary: (modeName: string, timerEnabled: boolean, decades: readonly number[]) => string;
  difficultyName: (playMode: PlayMode) => string;
  difficultyDescription: (playMode: PlayMode) => string;
  start: string;
  enableTimer: string;
  clue: string;
  revealClue: (cost: number) => string;
  clueRevealed: string;
  /** One line, kept after answering, when an Assisted or Standard question has no clue. */
  noClue: string;
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
  showSource: string;
  hideSource: string;
  revision: string;
  declaredReference: string;
  resultTitle: string;
  restart: string;
  giveUp: string;
  /** Title of the give-up confirmation dialog. */
  giveUpConfirmTitle: string;
  /** Body of the give-up confirmation dialog. */
  giveUpConfirmBody: string;
  /** Confirm button inside the give-up dialog (distinct from the trigger). */
  giveUpConfirmAction: string;
  /** Title of the terminal reveal confirmation dialog (crossword). */
  revealConfirmTitle: string;
  /** Body of the terminal reveal confirmation dialog. */
  revealConfirmBody: string;
  /** Confirm button inside the reveal dialog. */
  revealConfirmAction: string;
  /** Generic cancel label for confirmation dialogs. */
  cancel: string;
  chooseAnswer: string;
  submitHint: string;
  themeLabel: string;
  themeAuto: string;
  themeLight: string;
  themeDark: string;
  themeSwitchTo: string;
  totalTime: string;
  cluesUsed: string;
  shareHints: (count: number) => string;
  correctCountLabel: string;
  share: string;
  copyResult: string;
  copiedToClipboard: string;
  shareTextLabel: string;
  /** Shown when neither the share sheet nor the clipboard took the result. */
  shareFailed: string;
  reviewTitle: string;
  yourAnswer: string;
  correctAnswer: string;
  noAnswer: string;
  collectionTitle: string;
  generalGameTitle: string;
  /** Description of the general quiz card while a round of it is saved in progress: where it stopped. */
  quizGeneralInProgress: (question: number, total: number) => string;
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
  gridCellRevealed: (groupName: string) => string;
  gridCellSolved: (groupName: string) => string;
  gridCellFailed: (lastAttempt?: string) => string;
  gridPickerTitle: string;
  gridPickerCriteria: (row: string, col: string) => string;
  gridPickerSearchPlaceholder: string;
  gridPickerSearchLabel: string;
  gridPickerNoMatches: string;
  gridPickerResultsCount: (count: number) => string;
  gridAlreadyUsedError: string;
  gridAlreadyUsedBadge: string;
  gridTriedHereBadge: string;
  gridClosePicker: string;
  gridGameOverTitle: string;
  gridGameOverSummary: (correct: number, guesses: number) => string;
  gridShareButton: string;
  gridHighContrastShare: string;
  gridHint: string;
  gridGuessRight: (groupName: string) => string;
  gridGuessWrong: (groupName: string) => string;
  gridCatalogLimit: string;
  gridAlreadyTried: (groupName: string) => string;
  gridNoGuessSpent: string;
  gridReviewCatalogNote: string;
  gridReviewTitle: string;
  gridReviewCorrect: string;
  gridReviewWrong: string;
  gridReviewEmpty: string;
  gridSourcesSummary: (count: number) => string;
  gridSourceLocator: string;
  gridLocatorExtract: (start: number, end: number) => string;
  gridLocatorWikitext: (start: number, end: number) => string;
  gridLocatorClaim: (property: string) => string;
  gridReviewCellHeader: (row: number, col: number) => string;
  gridAcceptedAnswers: string;
  gridShareHeader: (date: string, correct: number, guesses: number) => string;
  gridAxesHeader: string;
  gridCategoryFormation: string;
  gridCategoryAgency: string;
  gridCategoryMembers: string;
  gridDailyMissing: string;
  gridCorrected: string;
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
  connectionsShareHeader: (date: string) => string;
  connectionsShareResultLine: (solved: number) => string;
  connectionsShareGuessesLine: (guesses: number, mistakes: number) => string;
  connectionsShareButton: string;
  connectionsHighContrastShare: string;
  connectionsCategorySolvedAria: (difficulty: number, label: string, items: string) => string;
  connectionsBoardAria: string;
  connectionsSolvedAria: string;
  connectionsItemsAria: string;
  connectionsLevelAria: string;
  connectionsHint: string;
  connectionsWrong: string;
  connectionsSolved: (label: string) => string;
  connectionsSourceItem: (name: string, project: string, revision: number) => string;
  nameGuessTitle: string;
  nameGuessEyebrow: string;
  nameGuessIntro: string;
  nameGuess: NameGuessMessages;
  wordSearchTitle: string;
  wordSearchEyebrow: string;
  wordSearchIntro: string;
  wordSearchShareHeader: (date: string, found: number, total: number, time: string) => string;
  mapEyebrow: string;
  mapTitle: string;
  mapIntro: string;
  mapShareHeader: (date: string) => string;
  nameGuessShareHeader: (date: string, score: string) => string;
  timelineTitle: string;
  timelineEyebrow: string;
  timelineIntro: string;
  codeTitle: string;
  codeEyebrow: string;
  codeIntro: string;
  codeHowToPlay: string[];
  crosswordTitle: string;
  crosswordEyebrow: string;
  crosswordIntro: string;
  crosswordHowToPlay: string[];
  wordSearch: WordSearchMessages;
  gameNavLabel: string;
  gameQuiz: string;
  gameGrid: string;
  gameConnections: string;
  gameNameGuess: string;
  gameWordSearch: string;
  gameMap: string;
  gameTimeline: string;
  gameCode: string;
  gameCrossword: string;
  /** Hidden text of the ✓ on the tab of a game finished today. */
  gameNavDoneToday: string;
  dailyNextIn: (time: string) => string;
  dailyNextReady: string;
  dailyNextReload: string;
  /** Label of the link to the next unfinished daily game; an arrow follows it. */
  dailyNextGame: (game: string) => string;
  dailyAllDone: string;
  /** Shown instead of a new board when the date's board was republished after the player finished it. */
  dailyDoneTitle: string;
  dailyDoneBody: string;
  /** Shown above a daily board from an earlier day, when today's was not published yet. */
  staleDaily: (date: string) => string;
  codeSequenceNote: string;
  codeAttemptsLeft: (remaining: number) => string;
  codeYourGuess: string;
  codePosition: string;
  codeChooseGroup: string;
  codeSubmit: string;
  codeChooseAll: string;
  codeChooseDistinct: string;
  codeAlreadyGuessed: string;
  codeAttemptFeedback: (attempt: number, exact: number, misplaced: number, remaining: number) => string;
  codeGuessSummary: (exact: number, misplaced: number) => string;
  codeHistoryHeading: string;
  codeResultWon: string;
  codeResultLost: string;
  codeSecretLabel: string;
  codeAttemptsUsed: string;
  codeAboutGroups: string;
  codeShareButton: string;
  codeShareHeader: (date: string) => string;
  codeShareWon: (attempts: number) => string;
  codeShareLost: string;
  codeShareAttemptsLine: (attempts: number) => string;
  /** The daily artifact follows a partial publish: the day may ship without it. */
  codeArtifactMissing: string;
  crosswordBoardLabel: string;
  crosswordCluesHeading: string;
  crosswordAcross: string;
  crosswordDown: string;
  /** Clue button text: number, direction, clue and answer length. */
  crosswordClue: (number: number, direction: string, clue: string, length: number) => string;
  /** Accessible name of a square: 1-based row and column, then its clues. */
  crosswordCellLabel: (row: number, col: number, clues: string) => string;
  crosswordCheck: string;
  crosswordReveal: string;
  crosswordHint: string;
  /**
   * Verdict of a check that is not a win, with the number of squares marked
   * (wrong or empty). One short line, so the sticky bar keeps its height.
   */
  crosswordWrong: (squares: number) => string;
  crosswordResultWon: string;
  crosswordResultRevealed: string;
  crosswordSummaryWon: (checks: number) => string;
  crosswordSummaryRevealed: (correct: number, total: number) => string;
  crosswordSourceClue: string;
  crosswordShareHeader: string;
  crosswordArtifactMissing: string;
  /** Today was published as omitted: no board passed verification. */
  crosswordOmitted: string;
  /** Today's record says omitted without a board: generation failed. */
  crosswordUnavailable: string;
  statsTitle: string;
  statsNavLabel: string;
  statsOpenButton: string;
  statsClose: string;
  statsTabOverall: string;
  statsPlayed: string;
  statsWinRate: string;
  statsCurrentStreak: string;
  statsMaxStreak: string;
  statsOverallStreakHelp: string;
  statsGameStreakHelp: string;
  /** What counts as a win, per stats tab: the overall tab explains how the tabs add up. */
  statsWinRule: Record<"overall" | GameId, string>;
  statsGuessDistribution: string;
  /** Accessible name of the distribution's loss row, shown as "X". */
  statsLossRow: string;
  statsExport: string;
  statsImport: string;
  statsReset: string;
  statsConfirm: string;
  statsCancel: string;
  statsResetConfirm: string;
  statsImportError: string;
  statsImportSuccess: string;
  statsResetSuccess: string;
}

const catalogs: Record<Locale, Messages> = {
  "pt-BR": {
    meta: {
      quiz: {
        title: "Quiz de K-pop online grátis em português",
        description: "Jogue um quiz de K-pop online grátis em português: 10 perguntas com fontes, desafio diário e outros jogos. Sem cadastro.",
      },
      grid: {
        title: "K-pop Grid: grade diária 3x3 de K-pop",
        description: "Jogue o K-pop Grid: complete a grade 3x3 com grupos por agência, década de formação e número de integrantes. 9 palpites por dia.",
      },
      connections: {
        title: "Conexões de K-pop: jogo diário de 4 grupos",
        description: "Jogue Conexões de K-pop: separe 16 grupos em 4 categorias por agência, década de formação ou número de integrantes. Até 4 erros.",
      },
      nameGuess: {
        title: "Wordle de K-pop: adivinhe o idol ou grupo",
        description: "Jogo diário de Wordle de K-pop: adivinhe o idol ou grupo em 6 palpites, com pistas coloridas e fontes de cada artista. Grátis e sem cadastro.",
      },
      wordSearch: {
        title: "Caça-palavras de K-pop online grátis",
        description: "Jogue caça-palavras de K-pop online: encontre nomes de grupos e integrantes na horizontal, vertical e diagonal. Confira as fontes de cada nome.",
      },
      mapPilot: {
        title: "BLACKPINK: quiz de mapa da turnê DEADLINE",
        description: "Teste seus conhecimentos sobre a turnê DEADLINE de BLACKPINK. Localize no mapa os países de 10 datas e confira a agenda oficial em cada resposta.",
      },
      timeline: {
        title: "Linha do tempo do K-pop: jogo de datas",
        description: "Coloque 5 acontecimentos do K-pop em ordem cronológica no desafio diário: formação de grupos, nascimento de artistas e lançamento de álbuns, EPs e singles.",
      },
      code: {
        title: "Código de grupos de K-pop: jogo de lógica",
        description: "Descubra a sequência de 4 grupos de K-pop do dia em até 10 tentativas, com contagens de exatos e deslocados e fontes no Wikidata. Grátis.",
      },
      crossword: {
        title: "Cruzadinha de K-pop: grupos com pistas e fontes",
        description: "Jogue uma cruzadinha de K-pop: descubra grupos por pistas de formação, gravadora e integrantes. Cada pista cita uma revisão da Wikipédia.",
      },
    },
    about: gameAbout["pt-BR"],
    source: sourceCopy["pt-BR"],
    skipLinks: {
      quiz: "Pular para o quiz",
      grid: "Pular para a grade",
      connections: "Pular para o jogo",
      nameGuess: "Pular para o jogo",
      wordSearch: "Pular para o caça-palavras",
      mapPilot: "Pular para o jogo de mapa",
      timeline: "Pular para a linha do tempo",
      code: "Pular para o jogo de código",
      crossword: "Pular para a cruzadinha",
      privacy: "Pular para a política de privacidade",
      notFound: "Pular para o conteúdo",
    },
    overview: {
      title: "Jogos de K-pop para testar seus conhecimentos",
      intro:
        "Jogue grátis no navegador, em português ou inglês, sem cadastro. Escolha perguntas de múltipla escolha, desafios de palavras, uma grade de grupos ou jogos de datas e lugares.",
      modesTitle: "Escolha seu jogo de K-pop",
      modesBody: "Cada jogo tem regras próprias. Veja qual desafio você quer jogar:",
      games: {
        quiz: { title: "Quiz de K-pop", description: "Responda 10 perguntas de múltipla escolha sobre grupos, integrantes e datas, com a fonte de cada resposta." },
        grid: { title: "Grade de interseções de K-pop", description: "Encontre grupos que atendam às regras de cada linha e coluna, como agência, década de formação e número de integrantes. São 9 casas e 9 palpites." },
        connections: { title: "Conexões de K-pop", description: "Separe 16 nomes em 4 categorias de 4. Descubra o que os nomes têm em comum antes de cometer 4 erros." },
        nameGuess: { title: "Wordle de K-pop", description: "Descubra o artista ou grupo do dia em até 6 palpites. As cores indicam quais letras estão no nome e na posição certa." },
        wordSearch: { title: "Caça-palavras de K-pop", description: "Procure nomes de K-pop na horizontal, vertical ou diagonal. Se precisar de ajuda, revele a lista de palavras." },
        mapPilot: { title: "Mapa da turnê BLACKPINK", description: "Encontre os países de 10 datas da turnê DEADLINE no mapa. Confira a agenda oficial nas fontes de cada resposta." },
        timeline: { title: "Linha do tempo do K-pop", description: "Coloque acontecimentos do K-pop em ordem cronológica. Depois de conferir a ordem, veja as datas e fontes dos fatos." },
        code: { title: "Código de grupos de K-pop", description: "Descubra uma sequência de 4 grupos entre 6 símbolos do catálogo em até 10 tentativas, com contagens de posições exatas e deslocadas." },
        crossword: { title: "Cruzadinha de K-pop", description: "Preencha a grade com nomes de grupos a partir de pistas sobre formação, gravadora e integrantes. Cada pista tem fonte na Wikipédia." },
      },
      quizTitle: "Como funciona o quiz de 10 perguntas",
      quizBody: "Escolha uma alternativa por pergunta e confirme a resposta. Após responder, confira a explicação e a fonte, mesmo quando errar. Ao terminar, veja sua pontuação e revise as respostas.",
      settingsBody: "No Quiz geral, você pode filtrar pela década de formação dos grupos. O Quiz do dia oferece as perguntas da rodada diária. Escolha Assistido para receber pistas, Padrão para abrir pistas com custo em pontos ou Especialista para jogar sem pistas. O cronômetro opcional dá 20 segundos por pergunta.",
      recordsTitle: "Fontes e progresso no navegador",
      recordsBody: "As perguntas do quiz apontam para revisões da Wikipedia ou do Wikidata, com o local do fato na fonte. O jogo de mapa usa a agenda oficial da turnê BLACKPINK e referências do MusicBrainz. As estatísticas e preferências ficam salvas neste navegador; limpar seus dados locais apaga esses registros.",
    },
    eyebrow: "10 perguntas · múltipla escolha",
    title: "Quiz de K-pop online grátis em português",
    intro: "Teste o que você sabe sobre grupos, integrantes e datas. Responda 10 perguntas sem cadastro e confira a fonte de cada resposta.",
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
    quizReplayUnavailable: "Não há perguntas suficientes para esta combinação de idioma, modo e filtros.",
    quizReplayRepeats: "Só há dez perguntas com estas opções. Jogar novamente repete as perguntas desta rodada.",
    quizReplayLegacyRepeats: "Jogar novamente repete as perguntas desta rodada.",
    quizResumeIncompatible: "Não foi possível retomar a partida salva: ela não combina com os dados atuais. Comece uma nova.",
    quizDailyDone: "Você já concluiu o desafio diário de hoje. Uma nova rodada não conta nas estatísticas.",
    quizResumeInvalid: "O progresso salvo está inválido e foi descartado. Comece uma nova partida.",
    quizStorageUnavailable: "O armazenamento local está indisponível; o progresso desta partida não será guardado.",
    consentLabel: "Preferências de privacidade",
    consentText: "A Cloudflare mede visitas sem cookies. Aceita cookies e identificadores do Google Analytics para estatísticas de audiência?",
    consentAccept: "Aceitar",
    consentReject: "Recusar",
    consentTool: "Google Analytics",
    consentPreferences: "Preferências de privacidade",
    consentPrivacyLink: "Política de privacidade",
    privacyLink: "Privacidade",
    howToPlayTitle: "Como jogar",
    quizHowToPlay: [
      "Comece pelo Quiz do dia ou escolha o Quiz geral. Em Personalizar, escolha o modo. No Assistido aparecem pistas. No Padrão, abrir uma pista custa alguns pontos. No Especialista não há pistas.",
      "Se quiser, filtre pela década de formação dos grupos e limite cada pergunta a 20 segundos.",
      "Responda 10 perguntas de múltipla escolha. Cada acerto soma pontos.",
      "Depois de cada resposta, você vê a resposta correta e a fonte.",
    ],
    gridHowToPlay: [
      "Cada casa cruza o critério da linha com o da coluna, como agência, década de formação ou número de integrantes.",
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
      "A lista mostra quantas letras tem cada nome. Se travar, use \"Mostrar palavras\". No fim, \"Ver fonte\" lista a revisão da Wikipédia ou do Wikidata que confirma cada nome.",
    ],
    mapHowToPlay: [
      "Leia a data da turnê, selecione o país destacado no mapa ou o nome dele na lista e toque em \"Responder\". Em telas largas, a lista fica ao lado do mapa. Em telas menores, os países ficam num seletor na barra de baixo, e um toque no mapa aproxima a região. No mapa aproximado, cada país da rodada tem um alvo redondo, com anel nos pequenos, como Singapura.",
      "No teclado, use Tab para chegar a um país, Enter para selecionar e \"Responder\" para enviar.",
      "Depois da resposta, a barra na parte de baixo da tela mostra o país correto e os links da agenda oficial e do MusicBrainz. Aperte Enter ou \"Próxima data\" para seguir. Na última pergunta, o botão vira \"Ver resultado\".",
      "No fim, \"Ver fonte\" lista as datas da rodada com a sua resposta e as fontes de cada uma. Uma data na agenda não confirma que o show aconteceu.",
    ],
    timelineHowToPlay: [
      "Arraste ou use os botões ↑ e ↓ para organizar os acontecimentos na ordem cronológica correta.",
      "Clique em 'Verificar ordem' para registrar seu palpite do dia.",
      "Descubra as datas exatas e acesse as fontes consultadas de cada fato.",
    ],
    codeHowToPlay: [
      "O código do dia é uma sequência de 4 grupos distintos, escolhidos entre os 6 símbolos do tabuleiro. Escolha um grupo para cada posição e envie o palpite.",
      "Você tem 10 tentativas. Depois de cada uma, o jogo mostra quantos grupos estão na posição exata e quantos pertencem ao código, mas estão em outra posição. Os números não indicam quais posições você acertou. Repetir um palpite já enviado não gasta tentativa.",
      "Clique ou toque na opção de uma posição para trocar o grupo. No teclado, use as setas. O resultado do fim mostra o código e as fontes de cada grupo.",
    ],
    crosswordHowToPlay: [
      "Toque ou clique em uma pista para escolher a palavra e escreva o nome do grupo. Num cruzamento, toque ou clique de novo no quadrado para trocar entre horizontal e vertical. Deixe de fora espaços, pontuação e acentos e mantenha os números.",
      "No teclado, as setas levam ao próximo quadrado na direção da seta e Tab passa ao quadrado seguinte, linha por linha. Uma letra num cruzamento vale para as duas palavras.",
      "Verifique as respostas quantas vezes quiser. Cada verificação marca os quadrados errados ou vazios. Para parar, toque em Revelar respostas e veja os nomes e as fontes de cada pista.",
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
    customize: "Personalizar",
    customizeSummary: (modeName, timerEnabled, decades) => [
      `Modo ${modeName}`,
      timerEnabled ? "20 segundos por pergunta" : "sem limite de tempo",
      ...(decades.length ? [`anos ${decades.join(", ")}`] : []),
    ].join(" · "),
    difficultyName: (difficulty) => ({ assisted: "Assistido", standard: "Padrão", expert: "Especialista" })[difficulty],
    difficultyDescription: (difficulty) => ({
      assisted: "Mostra uma pista sempre que ela não entrega a resposta.",
      standard: "Começa sem pista. Abrir uma custa alguns pontos.",
      expert: "Sem pistas. Cada acerto vale mais pontos.",
    })[difficulty],
    start: "Começar partida",
    enableTimer: "Limitar cada pergunta a 20 segundos",
    clue: "Pista",
    revealClue: (cost) => `Ver pista (-${cost} pontos)`,
    clueRevealed: "Pista aberta",
    noClue: "Sem pista nesta pergunta.",
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
    showSource: "Ver fonte",
    hideSource: "Ocultar fonte",
    revision: "revisão",
    declaredReference: "Referência citada",
    resultTitle: "Fim da partida",
    restart: "Jogar novamente",
    giveUp: "Desistir",
    giveUpConfirmTitle: "Desistir da partida?",
    giveUpConfirmBody: "Você perde o progresso desta partida.",
    giveUpConfirmAction: "Sim, desistir",
    revealConfirmTitle: "Revelar as respostas?",
    revealConfirmBody: "Você encerra a partida e vê todas as respostas.",
    revealConfirmAction: "Sim, revelar",
    cancel: "Cancelar",
    chooseAnswer: "Escolha uma resposta para continuar.",
    submitHint: "Escolha uma alternativa e confirme em Responder.",
    themeLabel: "Tema",
    themeAuto: "Tema do sistema",
    themeLight: "Tema claro",
    themeDark: "Tema escuro",
    themeSwitchTo: "Alternar para",
    totalTime: "Tempo total",
    cluesUsed: "Pistas usadas",
    shareHints: (count) => (count === 1 ? "1 pista" : `${count} pistas`),
    correctCountLabel: "Acertos",
    share: "Compartilhar resultado",
    copyResult: "Copiar resultado",
    copiedToClipboard: "Resultado copiado.",
    shareTextLabel: "Texto do resultado",
    shareFailed: "Não deu para copiar. Selecione o texto abaixo e copie.",
    reviewTitle: "Suas respostas",
    yourAnswer: "Sua resposta",
    correctAnswer: "Resposta correta",
    noAnswer: "Sem resposta",
    collectionTitle: "Escolha o jogo",
    generalGameTitle: "Quiz geral",
    quizGeneralInProgress: (question, total) => `Você parou na pergunta ${question} de ${total}. Escolha para continuar.`,
    generalGameDescription: "Perguntas sobre história, lançamentos e integrantes.",
    dailyGameTitle: "Quiz do dia",
    dailyGameDescription: "As perguntas de hoje, com resultado para compartilhar.",
    shareDailyHeader: (date, correct, total) => `K-pop Quiz Diário ${date} ${correct}/${total}`,
    mediaAltClue: "Foto usada como pista desta pergunta",
    mediaCreator: "Foto:",
    mediaSource: "Fonte da imagem",
    mediaUnavailable: "Imagem indisponível",
    gridTitle: "Grade de interseções de K-pop",
    gridEyebrow: "9 casas · 9 palpites",
    gridIntro: "Em cada casa, escolha um grupo que atenda ao critério da linha e ao da coluna.",
    gridGuessesLeft: (count) => (count === 1 ? "1 palpite restante" : `${count} palpites restantes`),
    gridCorrectCount: (correct, total) => `${correct} de ${total} casas certas`,
    gridCellLabel: (row, col, rowLabel, colLabel, status) => `Linha ${row + 1}, ${rowLabel}. Coluna ${col + 1}, ${colLabel}. ${status}`,
    gridCellEmpty: "Vazia. Escolha um grupo",
    gridCellRevealed: (groupName) => `Revelada: ${groupName}`,
    gridCellSolved: (groupName) => `Certa: ${groupName}`,
    gridCellFailed: (lastAttempt) => (lastAttempt ? `Não aceita: você tentou ${lastAttempt}` : "Não aceita"),
    gridPickerTitle: "Escolha um grupo",
    gridPickerCriteria: (row, col) => `${row} e ${col}`,
    gridPickerSearchPlaceholder: "Buscar grupo...",
    gridPickerSearchLabel: "Buscar grupo pelo nome",
    gridPickerNoMatches: "Nenhum grupo encontrado.",
    gridPickerResultsCount: (count) => (count === 1 ? "1 grupo encontrado" : `${count} grupos encontrados`),
    gridAlreadyUsedError: "este grupo já está em outra casa.",
    gridAlreadyUsedBadge: "Usado em outra casa",
    gridTriedHereBadge: "Já tentado aqui",
    gridClosePicker: "Fechar",
    gridGameOverTitle: "Fim da partida",
    gridGameOverSummary: (correct, guesses) => `${correct} de 9 casas certas com ${guesses} palpites`,
    gridShareButton: "Compartilhar resultado",
    gridHighContrastShare: "Versão sem cores (alto contraste)",
    gridHint: "Escolha uma casa e um grupo para ela.",
    gridGuessRight: (groupName) => `Certa: ${groupName}.`,
    gridGuessWrong: (groupName) => `Não aceita: ${groupName}.`,
    gridCatalogLimit: "Sem fonte registrada aqui. Veja a FAQ.",
    gridAlreadyTried: (groupName) => `Já tentado aqui: ${groupName}.`,
    gridNoGuessSpent: "Nenhum palpite gasto.",
    gridReviewCatalogNote: "A lista mostra só o que o catálogo comprova com fonte. Um grupo real pode ficar de fora quando falta prova de uma das regras.",
    gridReviewTitle: "Respostas e fontes",
    gridReviewCorrect: "Certa",
    gridReviewWrong: "Não aceita",
    gridReviewEmpty: "Vazia",
    gridSourcesSummary: (count) => (count === 1 ? "1 fonte" : `${count} fontes`),
    gridSourceLocator: "Local na fonte:",
    gridLocatorExtract: (start, end) => `caracteres ${start} a ${end} do resumo`,
    gridLocatorWikitext: (start, end) => `caracteres ${start} a ${end} do código da página`,
    gridLocatorClaim: (property) => `declaração ${property} e sua referência`,
    gridReviewCellHeader: (row, col) => `Linha ${row + 1}, coluna ${col + 1}`,
    gridAcceptedAnswers: "Respostas aceitas:",
    gridShareHeader: (date, correct, guesses) => `Grade de K-pop ${date}\n${correct}/9 acertos (${guesses} palpites)`,
    gridAxesHeader: "Critérios",
    gridCategoryFormation: "Formação",
    gridCategoryAgency: "Agência",
    gridCategoryMembers: "Integrantes",
    gridCorrected: "Este desafio foi corrigido. O progresso da versão anterior não pode ser retomado. Os novos palpites são salvos nesta versão corrigida.",
    gridDailyMissing: "A grade de hoje não pôde ser gerada ou está temporariamente indisponível.",
    connectionsTitle: "Conexões de K-pop",
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
    connectionsShareHeader: (date) => `Conexões de K-pop ${date}`,
    connectionsShareResultLine: (solved) => `Resultado: ${solved}/4 categorias`,
    connectionsShareGuessesLine: (guesses, mistakes) =>
      `Palpites: ${guesses} (${mistakes} ${mistakes === 1 ? "erro" : "erros"})`,
    connectionsShareButton: "Compartilhar resultado",
    connectionsHighContrastShare: "Versão sem cores (alto contraste)",
    connectionsCategorySolvedAria: (difficulty, label, items) => `Nível ${difficulty}: ${label}. Nomes: ${items}.`,
    connectionsBoardAria: "Tabuleiro do Conexões",
    connectionsSolvedAria: "Categorias encontradas",
    connectionsItemsAria: "Nomes para separar",
    connectionsLevelAria: "Nível",
    connectionsHint: "Escolha 4 nomes com algo em comum e envie.",
    connectionsWrong: "Errou. Esses 4 nomes não formam uma categoria.",
    connectionsSolved: (label) => `Categoria encontrada: ${label}.`,
    connectionsSourceItem: (name, project, revision) => `${name}, ${project}, revisão ${revision}.`,
    nameGuessTitle: "Adivinhe o nome: Wordle de K-pop",
    nameGuessEyebrow: "6 palpites · 1 nome por dia",
    nameGuessIntro: "Descubra o artista ou grupo de K-pop do dia. A cada palpite, as cores mostram quais letras estão certas.",
    nameGuess: {
      title: "Adivinhe o nome",
      subtitle: "Nome do dia",
      attemptsLeft: "Palpites restantes",
      enter: "ENVIAR",
      backspace: "APAGAR",
      notEnoughLetters: "Preencha todas as letras.",
      tooManyLetters: (length) => `O nome de hoje tem ${length} letras.`,
      notInWordList: "Esse nome não está na lista de palpites aceitos.",
      alreadyGuessed: "Você já tentou essa palavra.",
      wonTitle: "Você acertou!",
      lostTitle: "Não foi dessa vez",
      targetWas: "A resposta era",
      copyResults: "Compartilhar resultado",
      copied: "Resultado copiado.",
      shareFailed: "Não deu para copiar. Selecione o texto abaixo e copie.",
      shareTextLabel: "Texto do resultado",
      highContrast: "Cores de alto contraste",
      showSource: "Ver fonte",
      hideSource: "Ocultar fonte",
      debutYear: "Estreia",
      agency: "Agência",
      members: "Integrantes",
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
    },
    wordSearchTitle: "Caça-palavras de K-pop",
    wordSearchEyebrow: "1 tema por dia · 8 direções",
    wordSearchIntro: "Encontre os nomes do tema escondidos na grade, em qualquer direção.",
    wordSearchShareHeader: (date, found, total, time) =>
      `Caça-palavras de K-pop ${date} ${found}/${total} (${time})`,
    mapEyebrow: "10 datas por rodada · turnê DEADLINE",
    mapTitle: "Quiz de mapa de K-pop: BLACKPINK",
    mapIntro: "Para cada data da turnê, escolha no mapa o país que a agenda oficial listou.",
    mapShareHeader: (date) => `Mapa de K-pop ${date}`,
    nameGuessShareHeader: (date, score) => `Adivinhe o nome ${date} ${score}`,
    codeTitle: "Código de grupos de K-pop",
    codeEyebrow: "10 tentativas · 4 posições",
    codeIntro: "Descubra quatro grupos diferentes do catálogo na ordem secreta do dia.",
    codeSequenceNote: "A sequência é a mesma em todas as partidas do dia.",
    codeAttemptsLeft: (remaining) => remaining === 1 ? "Tentativa restante" : "Tentativas restantes",
    codeYourGuess: "Seu palpite",
    codePosition: "Posição",
    codeChooseGroup: "Escolha um grupo",
    codeSubmit: "Enviar palpite",
    codeChooseAll: "Escolha os quatro grupos. Nenhuma tentativa usada.",
    codeChooseDistinct: "Escolha quatro grupos diferentes. Nenhuma tentativa usada.",
    codeAlreadyGuessed: "Você já tentou esse palpite. Nenhuma tentativa usada.",
    codeAttemptFeedback: (attempt, exact, misplaced, remaining) =>
      `Tentativa ${attempt}: ${exact} ${exact === 1 ? "exato" : "exatos"}, ${misplaced} ${misplaced === 1 ? "deslocado" : "deslocados"}. ${remaining} ${remaining === 1 ? "tentativa restante" : "tentativas restantes"}.`,
    codeGuessSummary: (exact, misplaced) => `${exact} ${exact === 1 ? "exato" : "exatos"} · ${misplaced} ${misplaced === 1 ? "deslocado" : "deslocados"}`,
    codeHistoryHeading: "Histórico de palpites",
    codeResultWon: "Código descoberto!",
    codeResultLost: "Tentativas esgotadas",
    codeSecretLabel: "Sequência secreta",
    codeAttemptsUsed: "Tentativas usadas",
    codeAboutGroups: "Sobre os grupos",
    codeShareButton: "Compartilhar resultado",
    codeShareHeader: (date) => `Código de grupos de K-pop ${date}`,
    codeShareWon: (attempts) => `Código descoberto em ${attempts} ${attempts === 1 ? "tentativa" : "tentativas"}.`,
    codeShareLost: "Código não descoberto nas 10 tentativas.",
    codeShareAttemptsLine: (attempts) => `${attempts === 1 ? "Tentativa" : "Tentativas"}: ${attempts}`,
    codeArtifactMissing: "O código de hoje ainda não foi publicado. Tente mais tarde.",
    crosswordTitle: "Cruzadinha de K-pop",
    crosswordEyebrow: "1 grade por dia · pistas com fonte",
    crosswordIntro: "Use as pistas para escrever os nomes dos grupos na grade.",
    crosswordBoardLabel: "Grade da cruzadinha",
    crosswordCluesHeading: "Pistas",
    crosswordAcross: "Horizontal",
    crosswordDown: "Vertical",
    crosswordClue: (number, direction, clue, length) => `${number} ${direction}: ${clue} (${length})`,
    crosswordCellLabel: (row, col, clues) => `Linha ${row}, coluna ${col}. ${clues}`,
    crosswordCheck: "Verificar respostas",
    crosswordReveal: "Revelar respostas",
    crosswordHint: "Escolha uma pista e digite o nome.",
    crosswordWrong: (squares) => (squares === 1 ? "1 quadrado a corrigir." : `${squares} quadrados a corrigir.`),
    crosswordResultWon: "Cruzadinha concluída!",
    crosswordResultRevealed: "Respostas reveladas",
    crosswordSummaryWon: (checks) =>
      checks === 1 ? "Resolvida na primeira verificação." : `Resolvida em ${checks} verificações.`,
    crosswordSummaryRevealed: (correct, total) => `${correct} de ${total} palavras certas antes de encerrar.`,
    crosswordSourceClue: "Pista:",
    crosswordShareHeader: "Cruzadinha de K-pop",
    crosswordArtifactMissing: "A cruzadinha de hoje ainda não foi publicada. Tente mais tarde.",
    crosswordOmitted: "Não há cruzadinha hoje: nenhuma grade passou na verificação das pistas. Volte amanhã.",
    crosswordUnavailable: "A cruzadinha de hoje está indisponível: não foi possível gerá-la. Volte amanhã.",
    timelineTitle: "Linha do Tempo do K-pop",
    timelineEyebrow: "Desafio diário",
    timelineIntro: "Ordene os acontecimentos do K-pop do mais antigo para o mais recente.",
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
      selectionHint: "Selecione a primeira e a última letra de um nome.",
      anchorHint: (letter) => `Início: ${letter}.`,
      foundState: "encontrada",
      progress: (found, total) => `${found} de ${total}`,
      progressAnnouncement: (found, total) => `${found} de ${total} palavras.`,
      foundFeedback: (name) => `Achou: ${name}.`,
      repeatFeedback: (name) => `Você já achou ${name}.`,
      missFeedback: (letters) => `${letters} não é um dos nomes.`,
      congratulations: "Parabéns!",
      resultSummary: (total, time) => `${total} palavras em ${time}.`,
      evidenceWikidataId: "ID no Wikidata:",
      evidenceClue: "Pista:",
      loading: "Carregando o caça-palavras de hoje...",
      loadError: "Não foi possível carregar o jogo.",
      artifactMissing: "O caça-palavras de hoje ainda não foi publicado.",
      retry: "Tentar novamente",
      cellAria: (row, col, letter, isSelected, isFound, isRevealed = false) => {
        const state = isFound ? ", encontrada" : isRevealed ? ", revelada" : isSelected ? ", selecionada" : "";
        return `Linha ${row + 1}, coluna ${col + 1}, letra ${letter}${state}`;
      },
    },
    gameNavLabel: "Jogos de K-pop",
    gameQuiz: "Quiz",
    gameGrid: "Grade",
    gameConnections: "Conexões",
    gameNameGuess: "Adivinhe",
    gameWordSearch: "Caça-palavras",
    gameMap: "Mapa",
    gameTimeline: "Linha do Tempo",
    gameCode: "Código",
    gameCrossword: "Cruzadinha",
    gameNavDoneToday: "concluído hoje",
    dailyNextIn: (time) => `Novo desafio em ${time}`,
    dailyNextReady: "O novo desafio já está disponível.",
    dailyNextReload: "Recarregar",
    dailyNextGame: (game) => `Próximo: ${game}`,
    dailyAllDone: "Você concluiu todos os jogos de hoje.",
    dailyDoneTitle: "Desafio de hoje concluído",
    dailyDoneBody: "O tabuleiro de hoje foi atualizado depois da sua partida. Ela continua nas suas estatísticas, e a nova versão não conta como outra partida.",
    staleDaily: (date) => `Este é o desafio de ${date}. O de hoje ainda não saiu.`,
    statsTitle: "Suas estatísticas",
    statsNavLabel: "Estatísticas",
    statsOpenButton: "Ver estatísticas e sequência",
    statsClose: "Fechar estatísticas",
    statsTabOverall: "Geral",
    statsPlayed: "Partidas",
    statsWinRate: "% de vitórias",
    statsCurrentStreak: "Sequência atual",
    statsMaxStreak: "Maior sequência",
    statsOverallStreakHelp: "A sequência geral conta os dias seguidos com pelo menos um desafio diário concluído, com vitória ou derrota.",
    statsGameStreakHelp: "A sequência de cada jogo conta as vitórias seguidas em desafios diários, e uma derrota volta a zero.",
    statsWinRule: {
      overall: "A % de vitórias soma as partidas de todos os jogos. Cada aba diz o que conta como vitória naquele jogo.",
      quiz: "Vitória: acertar pelo menos metade das perguntas (5 de 10).",
      grid: "Vitória: preencher pelo menos 5 das 9 casas, sem desistir.",
      connections: "Vitória: achar as 4 categorias antes do quarto erro.",
      "name-guess": "Vitória: acertar o nome em até 6 palpites.",
      "word-search": "Vitória: achar todos os nomes, sem desistir.",
      timeline: "Vitória: pôr todos os acontecimentos na ordem certa, sem desistir.",
      map: "Vitória: acertar o país de pelo menos metade das datas (5 de 10), sem desistir.",
      code: "Vitória: descobrir o código em até 10 tentativas.",
      crossword: "Vitória: completar a grade e conferir em Verificar respostas, sem usar Revelar respostas.",
    },
    statsGuessDistribution: "Palpites por partida",
    statsLossRow: "Derrotas",
    statsExport: "Exportar estatísticas",
    statsImport: "Importar estatísticas",
    statsReset: "Apagar dados",
    statsConfirm: "Confirmar",
    statsCancel: "Cancelar",
    statsResetConfirm: "Tem certeza de que quer apagar as estatísticas?",
    statsImportError: "O arquivo não está no formato esperado.",
    statsImportSuccess: "Estatísticas importadas.",
    statsResetSuccess: "Estatísticas apagadas.",
  },
  en: {
    meta: {
      quiz: {
        title: "Free online K-pop quiz and daily games",
        description: "Play a free online K-pop quiz with 10 questions and sources for every answer. Try the daily challenge and other games. No account needed.",
      },
      grid: {
        title: "K-pop Grid: daily 3x3 trivia puzzle",
        description: "Play K-pop Grid: fill 9 squares with groups matching each row and column by agency, formation decade and member count. 9 guesses daily.",
      },
      connections: {
        title: "K-pop Connections game: daily 4-group puzzle",
        description: "Play daily K-pop Connections: sort 16 groups into 4 secret categories by agency, formation decade or member count. 4 mistakes allowed.",
      },
      nameGuess: {
        title: "K-pop Wordle: guess today's idol or group",
        description: "A daily K-pop Wordle game. Guess the secret idol or group in 6 tries, with colored letter clues and verified sources. Free, no account.",
      },
      wordSearch: {
        title: "K-pop Word Search: free online puzzle",
        description: "Play a free K-pop word search online. Find groups and members hidden across, down and diagonally, then check the source behind each name.",
      },
      mapPilot: {
        title: "BLACKPINK DEADLINE tour map quiz",
        description: "Test your BLACKPINK DEADLINE tour knowledge. Locate the countries for 10 tour dates on the map and check the official schedule for each answer.",
      },
      timeline: {
        title: "K-pop Timeline: daily history puzzle",
        description: "Put 5 K-pop events in chronological order in the daily timeline puzzle. Check formation dates, artist birthdays, release dates and sources after playing.",
      },
      code: {
        title: "K-pop Group Code: daily logic game",
        description: "Find today's sequence of 4 K-pop groups in up to 10 guesses, with exact and misplaced counts and sources on Wikidata. Free, no account.",
      },
      crossword: {
        title: "K-pop Crossword: group names from cited clues",
        description: "Play a K-pop crossword: find groups from clues about formation year, record label and members. Every clue cites a Wikipedia revision.",
      },
    },
    about: gameAbout.en,
    source: sourceCopy.en,
    skipLinks: {
      quiz: "Skip to the quiz",
      grid: "Skip to the grid",
      connections: "Skip to the game",
      nameGuess: "Skip to the game",
      wordSearch: "Skip to the word search",
      mapPilot: "Skip to the map game",
      timeline: "Skip to the timeline game",
      code: "Skip to the code game",
      crossword: "Skip to the crossword",
      privacy: "Skip to the privacy policy",
      notFound: "Skip to content",
    },
    overview: {
      title: "K-pop games to test your knowledge",
      intro: "Play free in your browser, in English or Portuguese, with no account needed. Choose multiple-choice questions, word puzzles, a group grid or games about dates and places.",
      modesTitle: "Choose your K-pop game",
      modesBody: "Each game has its own rules. Pick the challenge you want to play:",
      games: {
        quiz: { title: "K-pop quiz", description: "Answer 10 multiple-choice questions about groups, members and dates, with a source for every answer." },
        grid: { title: "K-pop Grid", description: "Find groups that match each row and column rule, such as agency, formation decade and member count. You have 9 squares and 9 guesses." },
        connections: { title: "K-pop Connections", description: "Sort 16 names into 4 categories of 4. Find what the names have in common before making 4 mistakes." },
        nameGuess: { title: "K-pop Wordle", description: "Find today's artist or group in up to 6 guesses. Colors show which letters belong in the name and which are in the right position." },
        wordSearch: { title: "K-pop Word Search", description: "Find K-pop names across, down or diagonally. Reveal the word list if you need help." },
        mapPilot: { title: "BLACKPINK tour map", description: "Locate the countries for 10 dates on BLACKPINK's DEADLINE tour. Check the official schedule in the sources for each answer." },
        timeline: { title: "K-pop Timeline", description: "Put K-pop events in chronological order. After checking your order, see the dates and sources behind the facts." },
        code: { title: "K-pop Group Code", description: "Find a sequence of 4 groups among 6 catalog symbols in up to 10 guesses, with exact and misplaced position counts." },
        crossword: { title: "K-pop Crossword", description: "Fill the grid with group names from clues about formation year, record label and members. Every clue has a Wikipedia source." },
      },
      quizTitle: "How the 10-question quiz works",
      quizBody: "Pick an option for each question and submit your answer. Then read the explanation and source, even if you got it wrong. At the end, see your score and review your answers.",
      settingsBody: "In the General quiz, you can filter by the decade the groups formed. The Daily quiz offers the day's round of questions. Choose Assisted for clues, Standard to open clues at a cost in points or Expert to play without clues. The optional timer gives you 20 seconds per question.",
      recordsTitle: "Sources and browser storage",
      recordsBody: "Quiz questions link to Wikipedia or Wikidata revisions and identify where the fact appears in the source. The map game uses BLACKPINK's official tour schedule and MusicBrainz references. Statistics and preferences are saved in this browser; clearing local data removes those records.",
    },
    eyebrow: "10 questions · multiple choice",
    title: "Free online K-pop quiz",
    intro: "Test your knowledge of groups, members and dates. Answer 10 questions with no account needed and check the source for every answer.",
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
    quizReplayUnavailable: "There are not enough questions for this language, mode and filter combination.",
    quizReplayRepeats: "Only ten questions match these options. Play again repeats this round's questions.",
    quizReplayLegacyRepeats: "Play again repeats this round's questions.",
    quizResumeIncompatible: "Could not resume the saved game: it does not match the current data. Start a new round.",
    quizDailyDone: "You already finished today's daily challenge. A new round does not count in your stats.",
    quizResumeInvalid: "The saved progress is invalid and was discarded. Start a new game.",
    quizStorageUnavailable: "Local storage is unavailable; progress for this round will not be saved.",
    consentLabel: "Privacy preferences",
    consentText: "Cloudflare measures visits without cookies. Accept Google Analytics cookies and identifiers for audience statistics?",
    consentAccept: "Accept",
    consentReject: "Reject",
    consentTool: "Google Analytics",
    consentPreferences: "Privacy preferences",
    consentPrivacyLink: "Privacy policy",
    privacyLink: "Privacy",
    howToPlayTitle: "How to play",
    quizHowToPlay: [
      "Start with the daily quiz or pick the general quiz. Under Customize, pick a mode. Assisted shows clues, Standard lets you open a clue for a few points, and Expert has no clues.",
      "If you like, filter by the decade the groups formed and limit each question to 20 seconds.",
      "Answer 10 multiple-choice questions. Each correct answer adds points.",
      "After each answer, you see the correct answer and its source.",
    ],
    gridHowToPlay: [
      "Each square crosses a row rule with a column rule, such as agency, formation decade or number of members.",
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
      "The list shows how many letters each name has. If you get stuck, use \"Show words\". At the end, \"Show source\" lists the Wikipedia or Wikidata revision behind each name.",
    ],
    mapHowToPlay: [
      "Read the tour date, select the highlighted country on the map or its name in the list, then press \"Answer\". On wide screens the list sits beside the map. On smaller screens the countries are in a menu in the bar at the bottom, and a tap on the map zooms into that region. In the zoomed map each country of the round has a round target, drawn as a ring around small ones such as Singapore.",
      "With a keyboard, press Tab to reach a country, Enter to select it, and \"Answer\" to submit.",
      "After you answer, the bar at the bottom of the screen shows the correct country and links to the official schedule and MusicBrainz. Press Enter or \"Next date\" to continue. On the last question, the button reads \"See result\".",
      "At the end, \"Show source\" lists the round's dates with your answer and the sources for each. A date on the schedule does not confirm that the show took place.",
    ],
    timelineHowToPlay: [
      "Drag or use the ↑ and ↓ buttons to arrange events in chronological order.",
      "Click 'Check order' to submit your single daily attempt.",
      "Reveal exact dates and inspect sources for each event.",
    ],
    codeHowToPlay: [
      "The daily code is a sequence of 4 distinct groups chosen from the board's 6 symbols. Pick a group for each position and submit your guess.",
      "You have 10 guesses. After each one, the game shows how many groups are in the exact position and how many belong to the code but sit elsewhere. The counts do not tell you which positions you got right. Sending a guess again costs no attempt.",
      "Click or tap a position's option to change its group. With a keyboard, use the arrow keys. The final result reveals the code and the source of each group.",
    ],
    crosswordHowToPlay: [
      "Tap or click a clue to pick its word, then type the group's name. Where two words cross, tap or click the square again to switch between across and down. Leave out spaces, punctuation and accents, but keep numbers.",
      "With a keyboard, each arrow key moves to the next square in its direction and Tab moves to the next square, row by row. A letter where two words cross counts for both.",
      "Check your answers as often as you like. Each check marks the squares that are wrong or empty. To stop, finish the round and see the answers and the source of each clue.",
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
    customize: "Customize",
    customizeSummary: (modeName, timerEnabled, decades) => [
      `${modeName} mode`,
      timerEnabled ? "20 seconds per question" : "no time limit",
      ...(decades.length ? [decades.map((decade) => `${decade}s`).join(", ")] : []),
    ].join(" · "),
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
    noClue: "No clue for this question.",
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
    showSource: "Show source",
    hideSource: "Hide source",
    revision: "revision",
    declaredReference: "Cited reference",
    resultTitle: "Game over",
    restart: "Play again",
    giveUp: "Give up",
    giveUpConfirmTitle: "Give up this game?",
    giveUpConfirmBody: "You will lose your progress in this game.",
    giveUpConfirmAction: "Yes, give up",
    revealConfirmTitle: "Reveal the answers?",
    revealConfirmBody: "You will end this game and see every answer.",
    revealConfirmAction: "Yes, reveal",
    cancel: "Cancel",
    chooseAnswer: "Choose an answer to continue.",
    submitHint: "Pick an option and confirm with Submit answer.",
    themeLabel: "Theme",
    themeAuto: "System theme",
    themeLight: "Light theme",
    themeDark: "Dark theme",
    themeSwitchTo: "Switch to",
    totalTime: "Total time",
    cluesUsed: "Clues used",
    shareHints: (count) => (count === 1 ? "1 clue" : `${count} clues`),
    correctCountLabel: "Correct answers",
    share: "Share result",
    copyResult: "Copy result",
    copiedToClipboard: "Result copied.",
    shareTextLabel: "Result text",
    shareFailed: "Could not copy. Select the text below and copy it.",
    reviewTitle: "Your answers",
    yourAnswer: "Your answer",
    correctAnswer: "Correct answer",
    noAnswer: "No answer",
    collectionTitle: "Choose a game",
    generalGameTitle: "General quiz",
    quizGeneralInProgress: (question, total) => `You stopped at question ${question} of ${total}. Pick it to continue.`,
    generalGameDescription: "Questions about history, releases and members.",
    dailyGameTitle: "Daily quiz",
    dailyGameDescription: "Today's questions, with a result you can share.",
    shareDailyHeader: (date, correct, total) => `K-pop Quiz Daily ${date} ${correct}/${total}`,
    mediaAltClue: "Photo used as a clue for this question",
    mediaCreator: "Photo:",
    mediaSource: "Image source",
    mediaUnavailable: "Image unavailable",
    gridTitle: "K-pop Intersection Grid",
    gridEyebrow: "9 squares · 9 guesses",
    gridIntro: "In each square, pick a group that fits both the row rule and the column rule.",
    gridGuessesLeft: (count) => (count === 1 ? "1 guess left" : `${count} guesses left`),
    gridCorrectCount: (correct, total) => `${correct} of ${total} squares correct`,
    gridCellLabel: (row, col, rowLabel, colLabel, status) => `Row ${row + 1}, ${rowLabel}. Column ${col + 1}, ${colLabel}. ${status}`,
    gridCellEmpty: "Empty. Pick a group",
    gridCellRevealed: (groupName) => `Revealed: ${groupName}`,
    gridCellSolved: (groupName) => `Correct: ${groupName}`,
    gridCellFailed: (lastAttempt) => (lastAttempt ? `Not accepted: you tried ${lastAttempt}` : "Not accepted"),
    gridPickerTitle: "Pick a group",
    gridPickerCriteria: (row, col) => `${row} and ${col}`,
    gridPickerSearchPlaceholder: "Search groups...",
    gridPickerSearchLabel: "Search groups by name",
    gridPickerNoMatches: "No groups found.",
    gridPickerResultsCount: (count) => (count === 1 ? "1 group found" : `${count} groups found`),
    gridAlreadyUsedError: "this group is already in another square.",
    gridAlreadyUsedBadge: "Used in another square",
    gridTriedHereBadge: "Already tried here",
    gridClosePicker: "Close",
    gridGameOverTitle: "Game over",
    gridGameOverSummary: (correct, guesses) => `${correct} of 9 squares correct in ${guesses} guesses`,
    gridShareButton: "Share result",
    gridHighContrastShare: "No-color version (high contrast)",
    gridHint: "Pick a square, then a group for it.",
    gridGuessRight: (groupName) => `Correct: ${groupName}.`,
    gridGuessWrong: (groupName) => `Not accepted: ${groupName}.`,
    gridCatalogLimit: "No recorded source here. See the FAQ.",
    gridAlreadyTried: (groupName) => `Already tried here: ${groupName}.`,
    gridNoGuessSpent: "No guess spent.",
    gridReviewCatalogNote: "The list shows only what the catalog proves with a source. A real group can be left out when one of the rules lacks proof.",
    gridReviewTitle: "Answers and sources",
    gridReviewCorrect: "Correct",
    gridReviewWrong: "Not accepted",
    gridReviewEmpty: "Empty",
    gridSourcesSummary: (count) => (count === 1 ? "1 source" : `${count} sources`),
    gridSourceLocator: "Location in source:",
    gridLocatorExtract: (start, end) => `extract characters ${start}–${end}`,
    gridLocatorWikitext: (start, end) => `page source characters ${start}–${end}`,
    gridLocatorClaim: (property) => `statement ${property} and its reference`,
    gridReviewCellHeader: (row, col) => `Row ${row + 1}, column ${col + 1}`,
    gridAcceptedAnswers: "Accepted answers:",
    gridShareHeader: (date, correct, guesses) => `K-pop Grid ${date}\n${correct}/9 correct (${guesses} guesses)`,
    gridAxesHeader: "Rules",
    gridCategoryFormation: "Formation",
    gridCategoryAgency: "Agency",
    gridCategoryMembers: "Members",
    gridCorrected: "This challenge was corrected. Progress from the previous version cannot be resumed. New guesses are saved in this corrected version.",
    gridDailyMissing: "Today's grid could not be generated or is temporarily unavailable.",
    connectionsTitle: "K-pop Connections",
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
    connectionsShareHeader: (date) => `K-pop Connections ${date}`,
    connectionsShareResultLine: (solved) => `Result: ${solved}/4 categories`,
    connectionsShareGuessesLine: (guesses, mistakes) =>
      `Guesses: ${guesses} (${mistakes} ${mistakes === 1 ? "mistake" : "mistakes"})`,
    connectionsShareButton: "Share result",
    connectionsHighContrastShare: "No-color version (high contrast)",
    connectionsCategorySolvedAria: (difficulty, label, items) => `Level ${difficulty}: ${label}. Names: ${items}.`,
    connectionsBoardAria: "Connections board",
    connectionsSolvedAria: "Categories found",
    connectionsItemsAria: "Names to sort",
    connectionsLevelAria: "Level",
    connectionsHint: "Pick 4 names that share something, then submit.",
    connectionsWrong: "Wrong. These 4 names are not a category.",
    connectionsSolved: (label) => `Category found: ${label}.`,
    connectionsSourceItem: (name, project, revision) => `${name}: ${project}, revision ${revision}.`,
    nameGuessTitle: "Guess the Name: K-pop Wordle",
    nameGuessEyebrow: "6 guesses · 1 name a day",
    nameGuessIntro: "Find today's K-pop artist or group. After each guess, colors show which letters are right.",
    nameGuess: {
      title: "Guess the name",
      subtitle: "Today's name",
      attemptsLeft: "Guesses left",
      enter: "ENTER",
      backspace: "DEL",
      notEnoughLetters: "Fill in every letter.",
      tooManyLetters: (length) => `Today's name has ${length} letters.`,
      notInWordList: "That name isn't on the list of accepted guesses.",
      alreadyGuessed: "You already tried that word.",
      wonTitle: "You got it!",
      lostTitle: "Not this time",
      targetWas: "The answer was",
      copyResults: "Share result",
      copied: "Result copied.",
      shareFailed: "Could not copy. Select the text below and copy it.",
      shareTextLabel: "Result text",
      highContrast: "High-contrast colors",
      showSource: "Show source",
      hideSource: "Hide source",
      debutYear: "Debut",
      agency: "Agency",
      members: "Members",
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
    },
    wordSearchTitle: "K-pop Word Search",
    wordSearchEyebrow: "1 theme a day · 8 directions",
    wordSearchIntro: "Find the theme's names hidden in the grid, in any direction.",
    wordSearchShareHeader: (date, found, total, time) =>
      `K-pop Word Search ${date} ${found}/${total} (${time})`,
    mapEyebrow: "10 dates per round · DEADLINE tour",
    mapTitle: "K-pop Map Quiz: BLACKPINK",
    mapIntro: "For each tour date, pick on the map the country the official schedule listed.",
    mapShareHeader: (date) => `K-pop Map ${date}`,
    nameGuessShareHeader: (date, score) => `K-pop Guess ${date} ${score}`,
    codeTitle: "K-pop Group Code",
    codeEyebrow: "10 guesses · 4 positions",
    codeIntro: "Find four different catalog groups in the day's secret order.",
    codeSequenceNote: "The sequence is the same in every game you play that day.",
    codeAttemptsLeft: () => "Guesses left",
    codeYourGuess: "Your guess",
    codePosition: "Position",
    codeChooseGroup: "Choose a group",
    codeSubmit: "Submit guess",
    codeChooseAll: "Choose all four groups. No attempt used.",
    codeChooseDistinct: "Choose four different groups. No attempt used.",
    codeAlreadyGuessed: "You already tried that guess. No attempt used.",
    codeAttemptFeedback: (attempt, exact, misplaced, remaining) =>
      `Attempt ${attempt}: ${exact} exact, ${misplaced} misplaced. ${remaining} ${remaining === 1 ? "attempt" : "attempts"} remaining.`,
    codeGuessSummary: (exact, misplaced) => `${exact} exact · ${misplaced} misplaced`,
    codeHistoryHeading: "Guess history",
    codeResultWon: "Code solved!",
    codeResultLost: "Attempts exhausted",
    codeSecretLabel: "Secret sequence",
    codeAttemptsUsed: "Attempts used",
    codeAboutGroups: "About the groups",
    codeShareButton: "Share result",
    codeShareHeader: (date) => `K-pop Code ${date}`,
    codeShareWon: (attempts) => `Code solved in ${attempts} ${attempts === 1 ? "attempt" : "attempts"}.`,
    codeShareLost: "Code not found in 10 attempts.",
    codeShareAttemptsLine: (attempts) => `Attempts: ${attempts}`,
    codeArtifactMissing: "Today's code has not been published yet. Try again later.",
    crosswordTitle: "K-pop Crossword",
    crosswordEyebrow: "1 grid a day · cited clues",
    crosswordIntro: "Use the clues to write the group names in the grid.",
    crosswordBoardLabel: "Crossword grid",
    crosswordCluesHeading: "Clues",
    crosswordAcross: "Across",
    crosswordDown: "Down",
    crosswordClue: (number, direction, clue, length) => `${number} ${direction}: ${clue} (${length})`,
    crosswordCellLabel: (row, col, clues) => `Row ${row}, column ${col}. ${clues}`,
    crosswordCheck: "Check answers",
    crosswordReveal: "Reveal answers",
    crosswordHint: "Pick a clue and type the name.",
    crosswordWrong: (squares) => (squares === 1 ? "1 square to fix." : `${squares} squares to fix.`),
    crosswordResultWon: "Crossword completed!",
    crosswordResultRevealed: "Answers revealed",
    crosswordSummaryWon: (checks) => (checks === 1 ? "Solved on the first check." : `Solved in ${checks} checks.`),
    crosswordSummaryRevealed: (correct, total) => `${correct} of ${total} words right before finishing.`,
    crosswordSourceClue: "Clue:",
    crosswordShareHeader: "K-pop Crossword",
    crosswordArtifactMissing: "Today's crossword has not been published yet. Try again later.",
    crosswordOmitted: "There is no crossword today: no grid passed the clue checks. Come back tomorrow.",
    crosswordUnavailable: "Today's crossword is unavailable: it could not be generated. Come back tomorrow.",
    timelineTitle: "K-pop Timeline",
    timelineEyebrow: "Daily challenge",
    timelineIntro: "Order the K-pop events from earliest to latest.",
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
      selectionHint: "Select the first and last letter of a name.",
      anchorHint: (letter) => `Start: ${letter}.`,
      foundState: "found",
      progress: (found, total) => `${found} of ${total}`,
      progressAnnouncement: (found, total) => `${found} of ${total} words.`,
      foundFeedback: (name) => `Found: ${name}.`,
      repeatFeedback: (name) => `You already found ${name}.`,
      missFeedback: (letters) => `${letters} is not one of the names.`,
      congratulations: "Well done!",
      resultSummary: (total, time) => `${total} words in ${time}.`,
      evidenceWikidataId: "Wikidata ID:",
      evidenceClue: "Clue:",
      loading: "Loading today's word search...",
      loadError: "The game could not be loaded.",
      artifactMissing: "Today's word search has not been published yet.",
      retry: "Try again",
      cellAria: (row, col, letter, isSelected, isFound, isRevealed = false) => {
        const state = isFound ? ", found" : isRevealed ? ", revealed" : isSelected ? ", selected" : "";
        return `Row ${row + 1}, column ${col + 1}, letter ${letter}${state}`;
      },
    },
    gameNavLabel: "K-pop games",
    gameQuiz: "Quiz",
    gameGrid: "Grid",
    gameConnections: "Connections",
    gameNameGuess: "Guess",
    gameWordSearch: "Word search",
    gameMap: "Map",
    gameTimeline: "Timeline",
    gameCode: "Code",
    gameCrossword: "Crossword",
    gameNavDoneToday: "done today",
    dailyNextIn: (time) => `New puzzle in ${time}`,
    dailyNextReady: "The new puzzle is out.",
    dailyNextReload: "Reload",
    dailyNextGame: (game) => `Next: ${game}`,
    dailyAllDone: "You finished all of today's games.",
    dailyDoneTitle: "Today's challenge is done",
    dailyDoneBody: "Today's board was updated after you played it. Your game stays in your stats, and the new version does not count as another game.",
    staleDaily: (date) => `This is the challenge from ${date}. Today's is not out yet.`,
    statsTitle: "Your stats",
    statsNavLabel: "Stats",
    statsOpenButton: "See stats and streak",
    statsClose: "Close stats",
    statsTabOverall: "Overall",
    statsPlayed: "Played",
    statsWinRate: "Win %",
    statsCurrentStreak: "Current streak",
    statsMaxStreak: "Best streak",
    statsOverallStreakHelp: "The overall streak counts consecutive days with at least one daily challenge finished, win or lose.",
    statsGameStreakHelp: "Each game's streak counts consecutive daily challenge wins, and a loss sets it back to zero.",
    statsWinRule: {
      overall: "Win % counts the rounds of every game. Each tab says what counts as a win in that game.",
      quiz: "Win: answer at least half the questions right (5 of 10).",
      grid: "Win: fill at least 5 of the 9 squares, without giving up.",
      connections: "Win: find the 4 categories before the fourth mistake.",
      "name-guess": "Win: guess the name in 6 tries or fewer.",
      "word-search": "Win: find every name, without giving up.",
      timeline: "Win: put every event in the right order, without giving up.",
      map: "Win: get the country right for at least half the dates (5 of 10), without giving up.",
      code: "Win: crack the code in 10 tries or fewer.",
      crossword: "Win: fill the grid and confirm with Check answers, without using Reveal answers.",
    },
    statsGuessDistribution: "Guesses per game",
    statsLossRow: "Losses",
    statsExport: "Export stats",
    statsImport: "Import stats",
    statsReset: "Clear data",
    statsConfirm: "Confirm",
    statsCancel: "Cancel",
    statsResetConfirm: "Are you sure you want to clear your stats?",
    statsImportError: "The file is not in the expected format.",
    statsImportSuccess: "Stats imported.",
    statsResetSuccess: "Stats cleared.",
  },
};

export function getMessages(locale: Locale): Messages {
  return catalogs[locale];
}
