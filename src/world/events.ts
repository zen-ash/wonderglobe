// Tiny typed event emitter used by the simulation to notify the UI without
// pushing per-frame updates through React.

export type Listener<T> = (payload: T) => void;

export class Emitter<Events extends { [K in keyof Events]: unknown }> {
  private map = new Map<keyof Events, Set<Listener<unknown>>>();

  on<K extends keyof Events>(type: K, fn: Listener<Events[K]>): () => void {
    let set = this.map.get(type);
    if (!set) this.map.set(type, (set = new Set()));
    set.add(fn as Listener<unknown>);
    return () => set!.delete(fn as Listener<unknown>);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    this.map.get(type)?.forEach((fn) => fn(payload));
  }

  clear(): void {
    this.map.clear();
  }
}
