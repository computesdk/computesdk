/**
 * What a lazy handle's placeholder id stands for, so that `getById` and
 * `destroy`, which get only an id, find the sandbox behind it.
 *
 * Until its create succeeds, a placeholder stands for its handle, which can
 * still create the sandbox. From then on it stands only for the sandbox's real
 * id, so the handle and its create are not kept alive. That entry is
 * forgotten when the sandbox is destroyed through either id, or once the
 * sandbox has certainly ended: Offstage ends every sandbox within 24 hours of
 * its create, and the API refuses a timeout that would run past that.
 *
 * Keys carry the API key, so one tenant's id never reaches another tenant's
 * handle.
 */

/** The longest an Offstage sandbox lives, counted from its create. */
export const SANDBOX_LIFETIME_MS = 24 * 60 * 60 * 1000;

export type LazyEntry<Handle> =
  | { handle: Handle }
  | { id: string; idKey: string; endsBy: number };

const keyOf = (apiKey: string, id: string): string => `${apiKey} ${id}`;

export class LazyHandles<Handle> {
  private readonly byPlaceholder = new Map<string, LazyEntry<Handle>>();
  /** Placeholder keys by the real id's key, for a destroy through the real id. */
  private readonly placeholderOf = new Map<string, string>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Placeholders held. */
  get size(): number {
    return this.byPlaceholder.size;
  }

  /** A handle whose sandbox is not created yet. First forgets every sandbox past its lifetime. */
  add(apiKey: string, placeholder: string, handle: Handle): void {
    const now = this.now();
    for (const [key, entry] of this.byPlaceholder) {
      if ('id' in entry && entry.endsBy <= now) this.forgetKey(key);
    }
    this.byPlaceholder.set(keyOf(apiKey, placeholder), { handle });
  }

  /** The handle's create made sandbox `id`: from now on the placeholder stands for that id alone. */
  created(apiKey: string, placeholder: string, id: string): void {
    const key = keyOf(apiKey, placeholder);
    const idKey = keyOf(apiKey, id);
    this.byPlaceholder.set(key, { id, idKey, endsBy: this.now() + SANDBOX_LIFETIME_MS });
    this.placeholderOf.set(idKey, key);
  }

  /** What `id` stands for when it is a placeholder; undefined when it is not one. */
  get(apiKey: string, id: string): LazyEntry<Handle> | undefined {
    return this.byPlaceholder.get(keyOf(apiKey, id));
  }

  /** Forgets the placeholder behind `id`, which is the placeholder itself or its sandbox's real id. */
  forget(apiKey: string, id: string): void {
    const key = keyOf(apiKey, id);
    this.forgetKey(this.placeholderOf.get(key) ?? key);
  }

  private forgetKey(key: string): void {
    const entry = this.byPlaceholder.get(key);
    if (entry === undefined) return;
    if ('id' in entry) this.placeholderOf.delete(entry.idKey);
    this.byPlaceholder.delete(key);
  }
}
