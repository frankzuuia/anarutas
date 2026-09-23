import type { Pool } from "pg";

type Listener = (event: "change" | "disconnected") => void;
type Hub = { subscribe: (listener: Listener) => () => void };
const hubs = new WeakMap<Pool, Promise<Hub>>();

async function connect(pool: Pool): Promise<Hub> {
  const client = await pool.connect();
  const listeners = new Set<Listener>();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    hubs.delete(pool);
    client.release(true);
    for (const listener of listeners) listener("disconnected");
    listeners.clear();
  };
  client.on("error", close);
  client.on("end", close);
  client.on("notification", (message) => {
    if (message.channel === "ana_rutas_panel" && message.payload === "changed")
      for (const listener of listeners) listener("change");
  });
  try {
    // Commit LISTEN before the client receives reset and reads its snapshot.
    await client.query("LISTEN ana_rutas_panel");
  } catch (error) {
    close();
    throw error;
  }
  return {
    subscribe(listener) {
      if (closed) throw new Error("PANEL_LISTENER_CLOSED");
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) close();
      };
    },
  };
}

export async function subscribePanelChanges(pool: Pool, listener: Listener) {
  let pending = hubs.get(pool);
  if (!pending) {
    pending = connect(pool).catch((error) => {
      hubs.delete(pool);
      throw error;
    });
    hubs.set(pool, pending);
  }
  return (await pending).subscribe(listener);
}
