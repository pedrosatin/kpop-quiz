import type { Locale } from "../../lib/quiz-types";

export const feedbackCopy = {
  "pt-BR": { question: "Você gostou desta partida?", yes: "Gostei", no: "Não gostei", dismiss: "Dispensar", notice: "Sua resposta é registrada por um serviço de avaliações, para melhorarmos os jogos. Não inclua dados pessoais no comentário.", comment: "Comentário opcional", send: "Enviar comentário", skip: "Concluir sem comentário", thanks: "Obrigado pela resposta!", voteError: "Não foi possível confirmar o voto. Você pode tentar novamente, mas isso pode registrar um voto duplicado.", commentError: "Não foi possível confirmar o comentário. Tente novamente." },
  en: { question: "Did you enjoy this game?", yes: "Yes", no: "No", dismiss: "Dismiss", notice: "Your response is recorded by a rating service so we can improve the games. Please don't include personal information in your comment.", comment: "Optional comment", send: "Send comment", skip: "Finish without a comment", thanks: "Thanks for your feedback!", voteError: "We couldn't confirm your vote. You can try again, but this may record a duplicate vote.", commentError: "We couldn't confirm your comment. Please try again." },
} satisfies Record<Locale, Record<string, string>>;

export type FeedbackCopy = (typeof feedbackCopy)[Locale];
