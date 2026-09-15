export type QuizMachineState =
  | "loading"
  | "setup"
  | "question.ready"
  | "question.answered"
  | "results"
  | "missing"
  | "invalid"
  | "empty";
