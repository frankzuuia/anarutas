"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Download,
  Truck,
  X,
  ArrowUp,
  ArrowDown,
  Map,
  ChevronDown,
  Trash2,
} from "lucide-react";
import type { Plan } from "@/core/plans";
import type { Vehicle } from "@/core/fleet-contract";
import type {
  ImportResult,
  OrderBoard,
  Shipment,
} from "@/core/orders-contract";
import { api } from "./api";
import { RouteMapDialog } from "./route-map-dialog";

function previousDay(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function LoadDialog({
  board,
  timezone,
  busy,
  onClose,
  onSubmit,
}: {
  board: OrderBoard;
  timezone: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (
    vehicleIds: string[],
    from: string,
    to: string,
    load: boolean,
  ) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState(board.vehicles.map((v) => v.id));
  const [from, setFrom] = useState(previousDay(board.plan.service_date));
  const [to, setTo] = useState(previousDay(board.plan.service_date));
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement;
    let current = true;
    element?.showModal();
    api<Vehicle[]>("/api/vehicles")
      .then((v) => {
        if (current) {
          setVehicles(v);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
      element?.close();
      previous?.focus();
    };
  }, []);
  const submit = async (load: boolean) => {
    setError("");
    try {
      await onSubmit(chosen, from, to, load);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <dialog
      className="fleet-dialog"
      ref={dialog}
      aria-labelledby={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="panel-header">
        <h2 id={title}>Cargar pedidos de Odoo</h2>
        <button
          className="quiet"
          aria-label="Cerrar carga"
          disabled={busy}
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      <div className="panel-body stack">
        <p className="muted">
          {loaded
            ? `${vehicles.filter((v) => v.available).length} camionetas disponibles`
            : "Consultando camionetas…"}{" "}
          · Plan {board.plan.service_date}
        </p>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <fieldset disabled={busy} className="vehicle-choice">
          <legend>Camionetas del día</legend>
          {vehicles.map((v) => (
            <label className="vehicle-option" key={v.id}>
              <input
                type="checkbox"
                checked={chosen.includes(v.id)}
                disabled={!v.available && !chosen.includes(v.id)}
                onChange={(e) =>
                  setChosen(
                    e.target.checked
                      ? [...chosen, v.id]
                      : chosen.filter((id) => id !== v.id),
                  )
                }
              />
              <span>
                <strong>{v.name}</strong>
                <small>
                  {v.plate} · {v.driver_name || "Sin chofer asignado"}
                </small>
              </span>
              <span className={`badge ${v.available ? "" : "amber"}`}>
                {v.available ? "Disponible" : "No disponible"}
              </span>
            </label>
          ))}
          {loaded && !vehicles.length && (
            <p className="muted">
              Registra una camioneta en Camionetas para cargar pedidos.
            </p>
          )}
        </fieldset>
        <fieldset disabled={busy} className="vehicle-choice">
          <legend>Fecha de validación del surtido</legend>
          <div className="form-row">
            <label>
              Desde
              <input
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
                required
              />
            </label>
            <label>
              Hasta
              <input
                type="date"
                value={to}
                min={from}
                max={board.plan.service_date}
                onChange={(e) => setTo(e.target.value)}
                required
              />
            </label>
          </div>
          <p className="muted">
            {timezone} · Se propone el día anterior al plan. Ajusta el rango
            para recuperar pendientes.
          </p>
        </fieldset>
        <div className="order-actions">
          <button
            className="quiet"
            disabled={busy || !loaded}
            onClick={() => void submit(false)}
          >
            Guardar camionetas
          </button>
          <button
            className="primary"
            disabled={
              busy || !loaded || !chosen.length || !from || !to || from > to
            }
            onClick={() => void submit(true)}
          >
            <Download size={16} />
            {busy ? "Cargando…" : "Cargar pedidos"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

function AddVehiclesDialog({
  board,
  busy,
  onClose,
  onSubmit,
}: {
  board: OrderBoard;
  busy: boolean;
  onClose: () => void;
  onSubmit: (vehicleIds: string[]) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const assigned = new Set(board.vehicles.map((vehicle) => vehicle.id));
  const candidates = vehicles.filter((vehicle) => !assigned.has(vehicle.id));
  const availableIds = new Set(
    candidates
      .filter((vehicle) => vehicle.available)
      .map((vehicle) => vehicle.id),
  );
  const selected = chosen.filter((id) => availableIds.has(id));

  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement;
    let current = true;
    element?.showModal();
    api<Vehicle[]>("/api/vehicles")
      .then((records) => {
        if (current) {
          setVehicles(records);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
      element?.close();
      previous?.focus();
    };
  }, []);

  async function submit() {
    setError("");
    try {
      await onSubmit(selected);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <dialog
      className="fleet-dialog"
      ref={dialog}
      aria-labelledby={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="panel-header">
        <h2 id={title}>Añadir camionetas al plan</h2>
        <button
          className="quiet"
          aria-label="Cerrar selección de camionetas"
          disabled={busy}
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      <div className="panel-body stack">
        <p className="muted">
          {loaded
            ? `${availableIds.size} ${availableIds.size === 1 ? "camioneta disponible" : "camionetas disponibles"} para agregar`
            : "Consultando la flota…"}{" "}
          · Plan {board.plan.service_date}
        </p>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <fieldset disabled={busy} className="vehicle-choice">
          <legend>Camionetas fuera del plan</legend>
          {candidates.map((vehicle) => (
            <label className="vehicle-option" key={vehicle.id}>
              <input
                type="checkbox"
                checked={chosen.includes(vehicle.id)}
                disabled={!vehicle.available}
                onChange={(e) =>
                  setChosen(
                    e.target.checked
                      ? [...chosen, vehicle.id]
                      : chosen.filter((id) => id !== vehicle.id),
                  )
                }
              />
              <span>
                <strong>{vehicle.name}</strong>
                <small>
                  {vehicle.plate} ·{" "}
                  {vehicle.driver_name || "Sin chofer asignado"}
                </small>
              </span>
              <span className={`badge ${vehicle.available ? "" : "amber"}`}>
                {vehicle.available ? "Disponible" : "No disponible"}
              </span>
            </label>
          ))}
          {loaded && !candidates.length && (
            <p className="muted">
              Todas las camionetas registradas ya pertenecen a este plan.
            </p>
          )}
          {loaded && candidates.length > 0 && !availableIds.size && (
            <p className="muted">
              No hay camionetas disponibles para agregar en este momento.
            </p>
          )}
        </fieldset>
        <div className="order-actions">
          <button className="quiet" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button
            className="primary"
            disabled={busy || !loaded || !selected.length}
            onClick={() => void submit()}
          >
            <Truck size={16} />
            {busy ? "Añadiendo…" : "Añadir seleccionadas"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

function RemoveVehicleDialog({
  vehicle,
  shipmentCount,
  busy,
  onClose,
  onConfirm,
}: {
  vehicle: { id: string; name: string };
  shipmentCount: number;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const description = useId();

  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);

  return (
    <dialog
      className="fleet-dialog remove-vehicle-dialog"
      ref={dialog}
      aria-labelledby={title}
      aria-describedby={description}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="panel-header">
        <h2 id={title}>Quitar camioneta del plan</h2>
        <button
          className="quiet"
          aria-label="Cerrar confirmación"
          disabled={busy}
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      <div className="panel-body stack">
        <div id={description}>
          <p>
            ¿Quieres quitar <strong>{vehicle.name}</strong> de este borrador?
          </p>
          {shipmentCount > 0 ? (
            <p className="removal-impact">
              {shipmentCount === 1
                ? "Su pedido pasará"
                : `Sus ${shipmentCount} pedidos pasarán`}{" "}
              a <strong>Pedidos sin asignar</strong> y conservará
              {shipmentCount === 1 ? "" : "n"} todos sus datos.
            </p>
          ) : (
            <p className="muted">
              Esta camioneta no tiene pedidos asignados en el borrador.
            </p>
          )}
        </div>
        <p className="muted">
          La camioneta seguirá registrada en la flota y podrás volver a añadirla
          después. Odoo no se modifica.
        </p>
        <div className="order-actions">
          <button className="quiet" disabled={busy} onClick={onClose}>
            Cancelar
          </button>
          <button
            className="danger"
            disabled={busy}
            onClick={() => void onConfirm()}
          >
            <Trash2 size={16} />
            {busy ? "Quitando…" : "Quitar camioneta"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

export function OrdersBoard({
  plan,
  timezone,
  revision,
  onPlan,
  onBusy,
}: {
  plan: Plan;
  timezone: string;
  revision: number;
  onPlan: (plan: Plan) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [board, setBoard] = useState<OrderBoard | null>(null);
  const [modal, setModal] = useState(false);
  const [addVehiclesOpen, setAddVehiclesOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{
    id: string;
    name: string;
    shipmentCount: number;
  } | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [expandedShipments, setExpandedShipments] = useState<Set<string>>(
    () => new Set(),
  );
  const endpoint = `/api/plans/${plan.id}/orders`;
  const update = useCallback(
    (data: OrderBoard) => {
      setBoard(data);
      onPlan(data.plan);
    },
    [onPlan],
  );
  const refresh = useCallback(
    async () => update(await api<OrderBoard>(endpoint)),
    [endpoint, update],
  );
  useEffect(() => {
    let current = true;
    api<OrderBoard>(endpoint)
      .then((data) => {
        if (current) update(data);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [endpoint, revision, plan.version, update]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  function working(value: boolean) {
    setBusy(value);
    onBusy(value);
  }
  async function load(
    vehicleIds: string[],
    from: string,
    to: string,
    importOrders: boolean,
  ) {
    if (!board) return;
    working(true);
    setError("");
    setNotice("");
    try {
      update(
        await api<OrderBoard>(`/api/plans/${plan.id}/vehicles`, "PUT", {
          vehicleIds,
          expectedVersion: board.plan.version,
        }),
      );
      if (importOrders) {
        let cursor = 0,
          ceiling: number | undefined;
        const totals = {
          inserted: 0,
          existing: 0,
          otherPlan: 0,
          changed: 0,
          excluded: 0,
        };
        while (true) {
          const page = await api<ImportResult>(endpoint, "POST", {
            from,
            to,
            cursor,
            ceiling,
          });
          for (const key of Object.keys(totals) as (keyof typeof totals)[])
            totals[key] += page[key];
          setNotice(
            `${totals.inserted} pedidos nuevos guardados · ${totals.existing} ya estaban en este plan`,
          );
          if (!page.hasMore) break;
          if (page.nextCursor <= cursor)
            throw new Error(
              "La consulta no avanzó. Vuelve a cargar; lo guardado se conserva.",
            );
          cursor = page.nextCursor;
          ceiling = page.ceiling;
        }
        setNotice(
          `${totals.inserted} pedidos nuevos · ${totals.existing} ya cargados · ${totals.otherPlan} en otro plan · ${totals.changed} con cambios en Odoo para revisar · ${totals.excluded} surtidos sin pedidos aplicables.`,
        );
      } else setNotice("Camionetas del día guardadas.");
      setModal(false);
    } catch (e) {
      throw new Error(
        `${(e as Error).message} Los lotes ya guardados se conservan. Puedes reintentar la carga.`,
      );
    } finally {
      await refresh().catch((e) => setError(e.message));
      working(false);
    }
  }
  async function addVehicles(vehicleIds: string[]) {
    if (!board) return;
    working(true);
    setError("");
    setNotice("");
    try {
      update(
        await api<OrderBoard>(`/api/plans/${plan.id}/vehicles`, "POST", {
          vehicleIds,
          expectedVersion: board.plan.version,
        }),
      );
      setNotice(
        `${vehicleIds.length} ${vehicleIds.length === 1 ? "camioneta añadida" : "camionetas añadidas"} al plan.`,
      );
      setAddVehiclesOpen(false);
    } catch (e) {
      await refresh().catch(() => {});
      throw e;
    } finally {
      working(false);
    }
  }
  async function removeVehicle() {
    if (!board || !removeTarget) return;
    const target = removeTarget;
    working(true);
    setError("");
    setNotice("");
    try {
      update(
        await api<OrderBoard>(`/api/plans/${plan.id}/vehicles`, "DELETE", {
          vehicleId: target.id,
          expectedVersion: board.plan.version,
        }),
      );
      setNotice(
        target.shipmentCount > 0
          ? `${target.name} se quitó del plan · ${target.shipmentCount} ${target.shipmentCount === 1 ? "pedido pasó" : "pedidos pasaron"} a Sin asignar.`
          : `${target.name} se quitó del plan.`,
      );
      setRemoveTarget(null);
    } catch (e) {
      setRemoveTarget(null);
      setError((e as Error).message);
      await refresh().catch(() => {});
    } finally {
      working(false);
    }
  }
  async function move(
    id: string,
    vehicleId: string | null,
    beforeId: string | null = null,
  ) {
    if (!board || busy) return;
    working(true);
    setError("");
    try {
      update(
        await api<OrderBoard>(endpoint, "PATCH", {
          shipmentId: id,
          vehicleId,
          beforeId,
          expectedVersion: board.plan.version,
        }),
      );
      setNotice("Asignación y orden guardados.");
    } catch (e) {
      setError((e as Error).message);
      await refresh().catch(() => {});
    } finally {
      working(false);
    }
  }
  function toggleShipment(id: string) {
    setExpandedShipments((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function card(s: Shipment, lane: Shipment[], index: number) {
    const expanded = expandedShipments.has(s.id);
    const detailId = `shipment-detail-${s.id}`;
    return (
      <article
        className={`shipment-card ${expanded ? "is-expanded" : ""}`}
        key={s.id}
        draggable={!busy}
        onDragStart={(e) =>
          e.dataTransfer.setData("application/x-rutas-shipment", s.id)
        }
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = e.dataTransfer.getData("application/x-rutas-shipment");
          if (id) void move(id, s.vehicle_id, s.id);
        }}
      >
        <button
          type="button"
          className="shipment-toggle"
          aria-expanded={expanded}
          aria-controls={detailId}
          aria-label={`${expanded ? "Ocultar" : "Mostrar"} detalles de ${s.customerName} ${s.orderName}`}
          onClick={() => toggleShipment(s.id)}
        >
          <span className="shipment-stop-index" aria-hidden="true">
            {s.vehicle_id ? index + 1 : "—"}
          </span>
          <span className="shipment-summary">
            <strong>{s.customerName}</strong>
            <small>
              Pedido {s.orderName} · {s.lines.length} partidas
            </small>
            <span className="shipment-tags">
              <span className="badge">
                {s.window_start
                  ? `${s.window_start}–${s.window_end}`
                  : "Sin horario"}
              </span>
              <span className="badge">
                {s.high_priority === null
                  ? "Prioridad pendiente"
                  : s.high_priority
                    ? "Prioridad alta"
                    : "Prioridad normal"}
              </span>
            </span>
          </span>
          <ChevronDown
            className="shipment-chevron"
            size={14}
            aria-hidden="true"
          />
        </button>
        {expanded && (
          <div className="shipment-expanded" id={detailId}>
            <div className="shipment-reference">
              <p className="shipment-folio">Surtido {s.pickingName}</p>
              <p
                className={`shipment-address ${!s.address ? "warning" : "muted"}`}
              >
                {s.address || "Dirección pendiente"}
              </p>
            </div>
            {s.promisedAt && (
              <p className="muted">
                Promesa Odoo:{" "}
                {new Date(s.promisedAt).toLocaleString("es-MX", {
                  timeZone: timezone,
                })}
              </p>
            )}
            <details>
              <summary>{s.lines.length} partidas · Ver productos</summary>
              <ul className="shipment-lines">
                {s.lines.map((line) => (
                  <li key={line.moveId}>
                    <span>
                      {line.name}
                      {line.pickerNote && (
                        <small className="picker-note">{line.pickerNote}</small>
                      )}
                    </span>
                    <strong>
                      {line.quantity} {line.unit}
                    </strong>
                  </li>
                ))}
              </ul>
            </details>
            <div className="shipment-controls">
              <label>
                <span className="sr-only">
                  Camioneta para {s.orderName} {s.pickingName}
                </span>
                <select
                  disabled={busy}
                  value={s.vehicle_id || ""}
                  onChange={(e) => void move(s.id, e.target.value || null)}
                >
                  <option value="">Sin asignar</option>
                  {board?.vehicles.map((v) => (
                    <option value={v.id} key={v.id} disabled={!v.available}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="quiet"
                disabled={busy || index === 0}
                aria-label={`Subir ${s.orderName}`}
                onClick={() =>
                  void move(s.id, s.vehicle_id, lane[index - 1].id)
                }
              >
                <ArrowUp size={14} />
              </button>
              <button
                className="quiet"
                disabled={busy || index === lane.length - 1}
                aria-label={`Bajar ${s.orderName}`}
                onClick={() =>
                  void move(s.id, s.vehicle_id, lane[index + 2]?.id ?? null)
                }
              >
                <ArrowDown size={14} />
              </button>
            </div>
          </div>
        )}
      </article>
    );
  }
  return (
    <div className="orders-section" aria-busy={busy}>
      <div className="orders-toolbar">
        <span className="muted">
          {board
            ? `${board.shipments.length} pedidos · ${board.vehicles.length} camionetas`
            : "Cargando tablero…"}
        </span>
        <div className="orders-toolbar-actions">
          <button
            className="quiet"
            disabled={!board || busy}
            onClick={() => setAddVehiclesOpen(true)}
          >
            <Truck size={16} />
            Añadir camioneta
          </button>
          <button
            className="quiet"
            disabled={!board || busy || !board.shipments.length}
            onClick={() => setMapOpen(true)}
          >
            <Map size={16} />
            Ver mapa de rutas
          </button>
          <button
            className="primary"
            disabled={busy || !board}
            onClick={() => setModal(true)}
          >
            <Download size={16} />
            Cargar pedidos de Odoo
          </button>
        </div>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {board && (
        <div
          className="orders-lanes"
          role="region"
          aria-label="Camionetas del plan; desplaza horizontalmente para ver más"
          tabIndex={0}
        >
          {[
            { id: null, name: "Pedidos sin asignar", driver_name: null },
            ...board.vehicles,
          ].map((v) => {
            const lane = board.shipments.filter((s) => s.vehicle_id === v.id);
            return (
              <section
                className="lane order-lane"
                key={v.id || "unassigned"}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData(
                    "application/x-rutas-shipment",
                  );
                  if (id) void move(id, v.id);
                }}
              >
                <header>
                  <span>
                    {v.id && <Truck size={15} />} {v.name}
                  </span>
                  <span className="badge">{lane.length}</span>
                  {v.id && (
                    <button
                      className="lane-remove"
                      disabled={busy}
                      aria-label={`Quitar ${v.name} del plan`}
                      onClick={() =>
                        setRemoveTarget({
                          id: v.id,
                          name: v.name,
                          shipmentCount: lane.length,
                        })
                      }
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  )}
                  {v.id && (
                    <small>{v.driver_name || "Sin chofer asignado"}</small>
                  )}
                </header>
                <div
                  className="shipment-list"
                  role="region"
                  aria-label={`Pedidos de ${v.name}`}
                  tabIndex={0}
                >
                  {lane.map((s, i) => card(s, lane, i))}
                  {!lane.length && (
                    <p className="muted lane-empty">
                      {v.id
                        ? "Arrastra un pedido aquí"
                        : board.shipments.length
                          ? "Todos los pedidos asignados"
                          : "Sin pedidos cargados"}
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {modal && board && (
        <LoadDialog
          board={board}
          timezone={timezone}
          busy={busy}
          onClose={() => setModal(false)}
          onSubmit={load}
        />
      )}
      {addVehiclesOpen && board && (
        <AddVehiclesDialog
          board={board}
          busy={busy}
          onClose={() => setAddVehiclesOpen(false)}
          onSubmit={addVehicles}
        />
      )}
      {removeTarget && (
        <RemoveVehicleDialog
          vehicle={removeTarget}
          shipmentCount={removeTarget.shipmentCount}
          busy={busy}
          onClose={() => setRemoveTarget(null)}
          onConfirm={removeVehicle}
        />
      )}
      {mapOpen && board && (
        <RouteMapDialog board={board} onClose={() => setMapOpen(false)} />
      )}
    </div>
  );
}
