/** Let native Preact after-paint work finish while jsdom's RAF globals exist. */
export async function drainRenderFrame(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  // Preact queues its effect flush with setTimeout inside the RAF callback.
  await new Promise<void>((resolve) => setTimeout(resolve));
}
