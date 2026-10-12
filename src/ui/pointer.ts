/** Capture a pointer if the browser allows it (it can refuse, e.g. for pointers that already ended). */
export function safeCapture(el: Element | null | undefined, pointerId: number): void {
  try {
    el?.setPointerCapture(pointerId);
  } catch {
    /* ignore: capture is a nicety, not a requirement */
  }
}
