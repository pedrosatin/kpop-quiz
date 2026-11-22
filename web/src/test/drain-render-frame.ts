const FRAME_DRAIN_TIMEOUT_MS = 1_000;

/** Let native Preact after-paint work finish while jsdom's RAF globals exist. */
export async function drainRenderFrame(): Promise<void> {
  await Promise.race([
    new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, FRAME_DRAIN_TIMEOUT_MS)),
  ]);
  await new Promise<void>((resolve) => setTimeout(resolve));
}
