# ADR 048. Compatibilidade de navegadores, SVG, foco e interação no DOM

## Status

Aprovado em 2026-11-22. Consolida decisões de compatibilidade de navegador, acessibilidade, foco e controle de entrada do cliente web que antes estavam registradas apenas em comentários de código.

## Contexto

O cliente estático em Astro + Preact atende navegadores móveis e desktop com restrições específicas de motor (Safari, iOS Safari, Chrome) e regras de hidratação, rolagem, compartilhamento nativo e anúncios de acessibilidade:

- **Safari < 16.4 e lookbehind:** expressões regulares com lookbehind falham na análise sintática em versões antigas do Safari e impedem a execução do módulo.
- **Atributos SVG no Preact:** o Preact escreve atributos de elementos SVG exatamente como grafados no JSX; `tabIndex` e `fillRule` em camelCase são ignorados pelo SVG do navegador, fazendo o foco por teclado pular o mapa e alterando regras de preenchimento.
- **Cliques e toques em controles e SVG:** no Chrome móvel, o evento `click` após toque no mapa se desloca para a forma clicável mais próxima; no Safari ou em cliques programáticos, botões no cabeçalho não recebem foco automaticamente antes de abrir modais; no caça-palavras/cruzadinha e em `GridCell`, eventos `mousedown` e teclas pressionadas podem vazar entre etapas ou colapsar seleções.
- **iOS Safari zoom e ShareSheet:** campos `<input>` com fonte menor que `16px` disparam zoom automático no iOS Safari; no `navigator.share`, passar o campo `url` separado faz alvos no iOS descartarem o texto ou copiarem só a URL.
- **`gtag.js` e `dataLayer`:** o script do GA4 lê somente objetos nativos `arguments` da fila `window.dataLayer`, ignorando arrays comuns (`rest params`).
- **`display: contents` e ARIA:** navegadores removem a semântica ARIA de containers com `display: contents`; wrappers de resumo de pontuação precisam permanecer `<div>` simples sem `role`.
- **Hidratação SSR e `preventScroll`:** a escolha inicial restaurada de `localStorage`/URL difere do HTML estático do servidor; o `hydrate()` do Preact não remonta atributos alterados sem troca de `key`. Além disso, devolver foco após fechar modais ou alternar controles deve usar `{ preventScroll: true }` e compensar barras fixas/adesivas (consentimento e barra de ações) para não reposicionar a página sob overlays.

## Decisão

1. **Regex compatível com Safari < 16.4:** quebra de nomes em tiles (`ConnectionsTile.tsx`) usa grupos de captura e lookahead (`([:\-./])(?=\S)`), nunca lookbehind.
2. **Atributos SVG em minúsculas:** elementos `<svg>` e filhos no Preact usam `tabindex` e `fill-rule` em minúsculas (`MapPilotMap.tsx`).
3. **Alvo de zoom e foco no mapa:** o zoom do mapa (`useMapZoom.ts`, `MapPilotMap.tsx`) ancora na coordenada do `pointerdown` anterior ao `click`, distinguindo ponteiro de tecnologia assistiva, e redireciona foco para o `<svg>` com `preventScroll: true` ao ocultar o botão do país durante o zoom.
4. **Foco explícito e retorno sem rolagem:** gatilhos do cabeçalho (`StatsNavTrigger.tsx`) e modais (`StatsModal.tsx`, `use-focus-on-change.ts`, tabuleiros) registram explicitamente o elemento de retorno e usam `focus({ preventScroll: true })`; `StatsModal` só move foco para o botão Fechar se nenhum controle interno (como a confirmação de importação) já tiver recebido foco.
5. **Prevenção de zoom no iOS e seleção na Cruzadinha:** células editáveis da Cruzadinha (`crossword.css`) mantêm `font-size` mínimo de `16px`; `CrosswordGrid.tsx` limpa seleção/valor imediatamente no `mousedown` e teclado controlado para evitar vazamento de caracteres ou colapso no Chrome, além de compensar overlays fixos e adesivos ao focar células (`crossword.css`, `components.css`, `sticky-bar-space.ts`).
6. **Compartilhamento nativo e `gtag`:** `shareTextToUser` (`share-text.ts`) envia apenas `{ text }` com o link na última linha quando `navigator.share` está disponível; `ConsentBanner.tsx` enfileira comandos no `dataLayer` usando `arguments` nativo (mantendo a diretiva `// oxlint-disable-next-line prefer-rest-params`).
7. **Semântica e hidratação estável:** `.score-summary` (`quiz.css`) permanece sem `role` quando usa layout de sub-grade; o setup do Quiz (`QuizScreen.tsx`) força remount da lista de opções via `choicesKey` após hidratação sem fechar `<details>`, reservando espaço para duas linhas de resumo; overlays fixos e barra adesiva (`sticky-bar-space.ts`, `StickyBarSpace.tsx`, `crossword.css`, `components.css`) aplicam `scroll-margin-bottom` dinâmico para manter o elemento focado visível.
8. **Guarda contra ativação repetida:** resultados e controles críticos (`useResultActionGuard`, `ConnectionsGameContent`, `GridCell`, `VirtualKeyboard`, `TimelineControls`, `useTimelineBoardItems`) descartam ativações duplicadas ou eventos `Enter`/toque repetidos durante transição de estado.
9. **Foco do Quiz após “Jogar o Quiz geral”:** `useQuizFocus` aplica `focus({ preventScroll: true })` no título do setup e rola o card `.quiz-setup` para o início, para o kicker “Antes de começar” permanecer visível a 390px em vez de o `focus()` grudar o `h2` na borda superior.
10. **Linha do Tempo compacta e drag sob a barra:** o shell `#timeline` encurta intro e padding para as cinco cartas e a barra adesiva caberem em laptop (1280×720+); em janela baixa o drag remede as cartas a cada passo e só mira a faixa acima da barra — o Firefox sob Playwright não faz autoscroll na borda, então o teste de roda cobre os dois motores e o de borda fica só no Chromium (`timeline.css`, `timeline-drag-*.spec.ts`).
11. **Métricas de layout serializáveis no E2E do Strands:** `measureStrandsLayout` em `web/e2e/helpers/strands-layout.ts` permanece função pura (sem fechamento) para o `page.evaluate` do Playwright serializar a medição do tabuleiro e da barra adesiva.
12. **Célula do Caça-palavras/Strands acessível sem cor:** o rótulo acessível de `WordSearchCell` descreve posição, letra e estado em palavras, para seleção, palavra encontrada e revelada não dependerem só da cor.
13. **Botão de tema e CSP:** o script inline do `#theme-toggle` em `BaseLayout.astro` atualiza `aria-label`/`title` a cada ciclo system→light→dark; o ícone segue `html[data-theme]` só no CSS. Qualquer edição desse script exige novo hash `sha256-…` em `web/public/_headers`.
14. **Teclado virtual do Adivinhe (`VirtualKeyboard.tsx`):** clique ou toque numa tecla não deixa o foco nela. Se a tecla ficasse focada, um Enter físico posterior a acionaria de novo em vez de enviar o palpite. Tab continua focando as teclas para quem usa teclado.

## Alternativas consideradas

- **Manter apenas comentários inline nos componentes:** espalha restrições de plataforma por dezenas de arquivos sem visão de conjunto e falha diante da política de redução de comentários.
- **Usar polyfills ou bibliotecas terceiras de foco/gesture:** adicionaria peso ao bundle estático e superfície de CSP fora do contrato mínimo atual.

## Consequências

- Os testes unitários e E2E (`ConsentBanner.test.tsx`, `StatsModal.test.tsx`, specs Chromium/WebKit/Firefox) fixam esses comportamentos sem depender de comentários explicativos no código-fonte.
- Novas alterações de foco, SVG, regex de UI ou compartilhamento devem preservar essas garantias.
