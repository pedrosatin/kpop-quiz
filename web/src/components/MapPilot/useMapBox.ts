import type { RefObject } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { MapSize } from "./map-pilot-geometry";

/** Below 60rem the country list is a select in the bar, and the map zooms on the first tap. */
export const MAP_ZOOM_QUERY = "(max-width: 59.999rem)";

const NO_BOX: MapSize = { width: 0, height: 0 };

/**
 * The SVG's size on screen and whether the narrow layout applies. Both stay
 * empty until the browser can measure them (and in jsdom), so the map then
 * keeps the whole-world view and selects on click.
 */
export function useMapBox(svg: RefObject<SVGSVGElement>): { box: MapSize; narrow: boolean } {
  const [box, setBox] = useState<MapSize>(NO_BOX);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const query = typeof window.matchMedia === "function" ? window.matchMedia(MAP_ZOOM_QUERY) : null;
    if (!query) return;
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const element = svg.current;
    if (!element || typeof ResizeObserver !== "function") return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setBox((previous) => (previous.width === rect.width && previous.height === rect.height
        ? previous
        : { width: rect.width, height: rect.height }));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [svg]);

  return { box, narrow };
}
