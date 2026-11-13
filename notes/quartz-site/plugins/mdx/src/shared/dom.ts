// Browser helpers shared by the figures' client.ts files. Each figure's
// mount(root) gets the .mdx-component element that holds the build-time
// markup; everything here works inside that one figure, so two copies of a
// figure on one page never reach into each other.

/** Looks up a figure's named parts: data-part="x", and inputs, outputs and buttons by name. */
export function lookup(figure: Element) {
  const one = <T extends Element>(selector: string): T => {
    const el = figure.querySelector<T>(selector);
    if (!el) throw new Error(`figure has no ${selector}`);
    return el;
  };
  return {
    part: (name: string) => one<HTMLElement>(`[data-part="${name}"]`),
    input: (name: string) => one<HTMLInputElement>(`input[name="${name}"]`),
    output: (name: string) => one<HTMLOutputElement>(`output[name="${name}"]`),
    button: (name: string) => one<HTMLButtonElement>(`button[name="${name}"]`),
  };
}

/**
 * Runs draw at most once per animation frame however often schedule is
 * called. Call cancel from the figure's cleanup.
 */
export function frameScheduler(draw: () => void) {
  let frame = 0;
  return {
    schedule() {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          draw();
        });
      }
    },
    cancel() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}

/** Enables the controls the build rendered disabled, once the script can drive them. */
export function enableControls(figure: Element): void {
  for (const control of figure.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input, button, select")) {
    control.disabled = false;
  }
}

/** The pointer's position in an SVG's own (viewBox) coordinates, or null if the SVG isn't laid out. */
export function svgPoint(svg: SVGGraphicsElement, event: { clientX: number; clientY: number }): DOMPoint | null {
  const ctm = svg.getScreenCTM();
  return ctm ? new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse()) : null;
}

let instances = 0;

/**
 * A prefix unique to this figure on the page, for ids (SVG markers,
 * aria-controls) and radio group names, which are page-global unless the
 * radios sit inside a <form>. The build renders static ids; rename them in
 * mount, or wrap radios in a <form> per figure.
 */
export function instancePrefix(base: string): string {
  instances += 1;
  return `${base}-${instances}`;
}

/**
 * Calls onChange(true) when the figure scrolls into view and false when it
 * leaves, so an animation can pause off screen. Returns a cleanup.
 */
export function whenVisible(figure: Element, onChange: (visible: boolean) => void): () => void {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) onChange(entry.isIntersecting);
  });
  observer.observe(figure);
  return () => observer.disconnect();
}

/** True when the reader asked for less motion; start animations paused. */
export const prefersReducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
