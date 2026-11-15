/**
 * How long teardown waits for a queued frame before giving up. A suite that
 * fakes `setInterval` (the countdown tests do) leaves jsdom's own frame
 * scheduler stopped: jsdom 31 drives `requestAnimationFrame` from an internal
 * interval, and a faked interval is never advanced after `useRealTimers()`
 * restores the real ones. The callback then never runs.
 */
const FRAME_DRAIN_TIMEOUT_MS = 1_000;

/** Let native Preact after-paint work finish while jsdom's RAF globals exist. */
export async function drainRenderFrame(): Promise<void> {
  await Promise.race([
    new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, FRAME_DRAIN_TIMEOUT_MS)),
  ]);
  // Preact queues its effect flush with setTimeout inside the RAF callback.
  await new Promise<void>((resolve) => setTimeout(resolve));
}
