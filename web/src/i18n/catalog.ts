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
  retry: string;
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
    retry: "Tentar novamente",
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
    retry: "Try again",
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
  },
};

export function getMessages(locale: Locale): Messages {
  return catalogs[locale];
}
