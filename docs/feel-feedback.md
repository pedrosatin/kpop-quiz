# Micro-feedback de acerto, erro e fim de partida

Padrão reutilizável para feedback sensorial leve por jogada e no fim da partida. O piloto é o **Quiz** diário: só ele coloca `data-feedback` nesta entrega. Os demais jogos mantêm `is-correct` / `is-incorrect` (e `is-won` / `is-lost` onde já existiam) para cor, sem animar.

A celebração do set do dia (`DailyNext` ao fechar o nono jogo) reusa `data-feedback="result"` no título.

## Tokens (`web/src/styles/tokens.css`)

| Token | Valor | Uso |
| --- | --- | --- |
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | Entrada / resposta ao jogador |
| `--duration-feedback` | `180ms` | Acerto e erro, elementos **não** interativos |
| `--duration-feedback-result` | `220ms` | Título de fim de partida |

Limites: ≤250 ms em elementos não interativos; nada acima de 300 ms nem animação infinita em controle clicável. Em `web/src/styles/base.css`, `prefers-reduced-motion: reduce` reduz `animation` e `transition` para 0,01 ms.

## Opt-in por atributo

A animação é **opt-in**: só anima quem define `data-feedback`. Classes de cor (`is-correct`, `is-incorrect`, `is-won`, `is-lost`) sozinhas não disparam motion.

| Momento | Como marcar | Motion |
| --- | --- | --- |
| Acerto | `data-feedback="correct"` em `.game-actions` | `@keyframes feedback-correct` no título / `.feedback-mark` (`display: inline-block` só neste seletor) |
| Erro | `data-feedback="incorrect"` em `.game-actions` | `@keyframes feedback-incorrect` |
| Fim de partida | `data-feedback="result"` no título (`.result-title` ou `.game-actions-title`) | `@keyframes feedback-result` |

O movimento aplica-se ao **texto/ícone da mensagem**, nunca ao botão. Feedback não depende só de cor: o Quiz anuncia o veredito em `aria-live` e mostra um `.feedback-mark` decorativo (✓ / ✗ / ⏱︎) ao lado do título.

## Como outro jogo adota

1. Na barra de ações, continue usando `is-correct` / `is-incorrect` para a cor de fundo.
2. Quando quiser o motion compartilhado, acrescente `data-feedback="correct"` ou `data-feedback="incorrect"` no mesmo `.game-actions`.
3. No título do resultado, acrescente `data-feedback="result"` quando quiser o enter de fim de partida. Cores de vitória/derrota (`is-won` / `is-lost`) ficam opcionais e independentes do motion.
4. Garanta texto ou ícone legível além da cor de fundo; leitores de tela já cobertos por `role="status"` / `aria-live` na barra compartilhada.
5. Não anime o `.btn` da barra. Não introduza dependência de motion (Rive etc.) sem aprovação.

Keyframes e regras ficam em `web/src/styles/components.css`. Jogos que já têm motion próprio (Name Guess `popIn` / `flipReveal` / `shake`, âncora do caça-palavras) podem convergir para estes tokens quando forem tocados de novo.

## Testes

- Presença de `data-feedback` / classes e de tokens/keyframes no CSS (Vitest).
- Sem reduced motion, o título do Quiz tem `animationName` do keyframe e duração de 180 ms; com `prefers-reduced-motion: reduce`, a duração efetiva cai abaixo de 20 ms (E2E). Botões ficam com `animationName === "none"`.
- Outro jogo (Connections) com erro prova que o título dele não anima enquanto não emitir `data-feedback`.
- `playthrough` e `smoke` seguem com movimento normal.
