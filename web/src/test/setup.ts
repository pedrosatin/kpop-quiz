import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/preact";
import { afterAll, afterEach } from "vitest";
import { drainRenderFrame } from "./drain-render-frame";

if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = () => null;
}

afterEach(cleanup);

// cleanup unmounts roots, but native Preact frame fallbacks can still be pending.
if (typeof requestAnimationFrame === "function") {
  afterAll(drainRenderFrame);
}
