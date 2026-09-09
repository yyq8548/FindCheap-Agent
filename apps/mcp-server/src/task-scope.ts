import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { TaskIdSchema, type TaskStateStore } from "./task-state-store.js";

type Codec<T> = { encode(value: T): unknown; decode(value: unknown): T };
type Context = { id?: string; revision: number; data: Record<string, unknown>; resources: Map<string, object>; active: number; invalid: boolean; generation: number };
type Resource = { factory(): object; codec?: Codec<object> };
const empty = (): Context => ({ revision: 0, data: {}, resources: new Map(), active: 0, invalid: false, generation: 0 });
const MetadataSchema = z.object({ _meta: z.object({ threadId: TaskIdSchema }) });

/** Request metadata comes from the configured stdio host, never tool arguments.
 * Resource proxies resolve inside the executor's async context, including UI calls
 * arriving while another tool awaits approval. No process-wide current-task variable. */
export class TaskScope {
  readonly #storage = new AsyncLocalStorage<Context>();
  readonly #calls = new AsyncLocalStorage<{ generation: number }>();
  readonly #contexts = new Map<string, Context>();
  readonly #resources = new Map<string, Resource>();
  readonly #volatile = empty();
  constructor(private readonly options: { store?: TaskStateStore; trustedHost: () => boolean }) {}

  taskId(): string | undefined { return this.#storage.getStore()?.id; }

  resource<T extends object>(name: string, factory: () => T, codec?: Codec<T>): T {
    if (this.#resources.has(name)) throw new Error("duplicate task resource");
    this.#resources.set(name, { factory, ...(codec === undefined ? {} : { codec: codec as Codec<object> }) });
    const current = (): T => {
      const context = this.#storage.getStore() ?? this.#volatile;
      if (context.invalid || (this.#calls.getStore()?.generation ?? context.generation) !== context.generation) throw new Error("TASK_STATE_CONFLICT");
      if (context.id !== undefined && this.options.store?.revision !== undefined && this.options.store.revision(context.id) !== context.revision) {
        context.invalid = true; this.#contexts.delete(context.id); throw new Error("TASK_STATE_CONFLICT");
      }
      let resource = context.resources.get(name);
      if (resource === undefined) {
        try { resource = codec !== undefined && context.data[name] !== undefined ? codec.decode(context.data[name]) : factory(); }
        catch { throw new Error("TASK_STATE_CORRUPT"); }
        context.resources.set(name, resource);
      }
      return resource as T;
    };
    return new Proxy(factory(), {
      get: (_target, key) => { const value = current(); const property: unknown = Reflect.get(value, key, value);
        return typeof property === "function" ? property.bind(value) : property; },
      set: (_target, key, value: unknown) => Reflect.set(current(), key, value)
    });
  }

  async run<T>(extra: unknown, handler: () => Promise<T>, allowCorruptState = false): Promise<T> {
    const metadata = this.options.trustedHost() ? MetadataSchema.safeParse(extra) : undefined;
    const id = metadata?.success === true ? metadata.data._meta.threadId : undefined;
    const store = id === undefined ? undefined : this.options.store;
    let context = id === undefined ? this.#volatile : this.#contexts.get(id);
    if (id !== undefined) {
      let saved;
      try { saved = store?.load(id); }
      catch (error) {
        if (!allowCorruptState || !(error instanceof Error) || error.message !== "TASK_STATE_CORRUPT") throw error;
        saved = { revision: store?.revision?.(id) ?? 0, data: {} };
        if (context !== undefined) { context.invalid = true; this.#contexts.delete(id); context = undefined; }
      }
      if (context !== undefined && saved !== undefined && context.revision !== saved.revision) {
        context.invalid = true;
        this.#contexts.delete(id);
        if (context.active > 0) throw new Error("TASK_STATE_CONFLICT");
        context = undefined;
      }
      if (context === undefined) {
        context = { ...empty(), id, ...(saved ?? {}) };
        this.#contexts.set(id, context);
      }
    }
    const bound = context ?? this.#volatile;
    bound.active++;
    try {
      return await this.#storage.run(bound, () => this.#calls.run({ generation: bound.generation }, async () => {
        let outcome: { result: T } | { error: unknown };
        try { outcome = { result: await handler() }; }
        catch (error) { outcome = { error }; }
        if (bound.invalid || this.#calls.getStore()!.generation !== bound.generation) throw new Error("TASK_STATE_CONFLICT");
        if (store !== undefined && id !== undefined) {
          const data = { ...bound.data };
          for (const [name, resource] of bound.resources) {
            const codec = this.#resources.get(name)?.codec;
            if (codec !== undefined) data[name] = codec.encode(resource);
          }
          if (JSON.stringify(data) !== JSON.stringify(bound.data)) {
            try { bound.revision = store.save(id, bound.revision, data); bound.data = structuredClone(data); }
            catch (error) { bound.invalid = true; this.#contexts.delete(id); throw error; }
          } else if ((store.revision?.(id) ?? store.load(id).revision) !== bound.revision) {
            bound.invalid = true; this.#contexts.delete(id); throw new Error("TASK_STATE_CONFLICT");
          }
        }
        if ("error" in outcome) throw outcome.error;
        return outcome.result;
      }));
    } finally {
      bound.active--;
      if (this.#contexts.size > 32) {
        for (const [key, value] of this.#contexts) {
          if (value.active === 0 && key !== id) this.#contexts.delete(key);
          if (this.#contexts.size <= 32) break;
        }
      }
    }
  }

  clear(preserveResources: readonly string[] = []): void {
    const context = this.#storage.getStore();
    if (context?.id === undefined || this.options.store === undefined) throw new Error("TASK_SCOPE_UNAVAILABLE");
    const retained = Object.fromEntries(Object.entries(context.data).filter(([name]) => preserveResources.includes(name)));
    for (const name of preserveResources) {
      const resource = context.resources.get(name), codec = this.#resources.get(name)?.codec;
      if (resource !== undefined && codec !== undefined) retained[name] = codec.encode(resource);
    }
    context.revision = this.options.store.clear(context.id, retained);
    context.generation++;
    this.#calls.getStore()!.generation = context.generation;
    context.data = structuredClone(retained);
    for (const name of context.resources.keys()) if (!preserveResources.includes(name)) context.resources.delete(name);
  }
}

export function mapCodec<T>(parse: (value: unknown) => T): Codec<Map<string, T>> {
  return { encode: value => [...value], decode: value => new Map(z.array(z.tuple([z.string().max(4096), z.unknown()])).max(1024)
    .parse(value).map(([key, item]) => [key, parse(item)])) };
}
