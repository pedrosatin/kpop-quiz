# Feel — micro-feedback de acerto, erro e fim de partida

Padrão reutilizável para feedback sensorial leve (Tier 1 por jogada, Tier 2 no fim da partida). O piloto é o **Quiz** diário; os demais jogos reusam os mesmos tokens e seletores compartilhados.

A celebração do **set do dia** (Tier 3) fica no ticket 02: reusa estes tokens quando aquele ticket sair de `needs-info`.

## Tokens (`web/src/styles/tokens.css`)

| Token | Valor | Uso |
| --- | --- | --- |
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | Entrada / resposta ao jogador |
| `--duration-feedback` | `180ms` | Acerto e erro (Tier 1), elementos **não** interativos |
| `--duration-feedback-result` | `220ms` | Título de fim de partida (Tier 2) |

Limites: ≤250 ms em elementos não interativos; nada acima de 300 ms nem animação infinita em controle clicável. `prefers-reduced-motion: reduce` em `web/src/styles/base.css` zera duração de `animation` / `transition`.

## Classes e atributos

| Momento | Como marcar | Motion |
| --- | --- | --- |
| Acerto | `.game-actions.is-correct` e `data-feedback="correct"` | `@keyframes feedback-correct` no título / `.feedback-mark` |
| Erro | `.game-actions.is-incorrect` e `data-feedback="incorrect"` | `@keyframes feedback-incorrect` |
| Fim de partida | `data-feedback="result"` no título; `.is-won` / `.is-lost` quando houver vitória/derrota clara | `@keyframes feedback-result` |

O movimento aplica-se ao **texto/ícone da mensagem**, nunca ao botão. Feedback não depende só de cor: o Quiz anuncia o veredito em `aria-live` e mostra um `.feedback-mark` decorativo (✓ / ✗ / ⏱) ao lado do título.

## Como aplicar em outro jogo

1. Na barra de ações, mantenha (ou adicione) `is-correct` / `is-incorrect` em `.game-actions` e, se útil para testes, `data-feedback`.
2. No título do resultado, use `.result-title` ou `.game-actions-title` com `is-won` / `is-lost`, e `data-feedback="result"` quando quiser o enter do Tier 2.
3. Garanta texto ou ícone legível além da cor de fundo; leitores de tela já cobertos por `role="status"` / `aria-live` na barra compartilhada.
4. Não anime o `.btn` da barra. Não introduza dependência de motion (Rive etc.) sem aprovação.

Keyframes e regras ficam em `web/src/styles/components.css`. Jogos que já têm motion próprio (Name Guess `popIn` / `flipReveal` / `shake`, âncora do caça-palavras) podem convergir para estes tokens quando forem tocados de novo.

## Testes

- Presença de `data-feedback` / classes e de tokens/keyframes no CSS (Vitest).
- Com `prefers-reduced-motion: reduce`, a duração efetiva da animação cai (E2E com `emulateMedia`).
- `playthrough` e `smoke` seguem com movimento normal.
