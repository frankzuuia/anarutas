"use client";
import Image from "next/image";
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
  FileSpreadsheet,
  MapPinned,
  Sparkles,
  Send,
} from "lucide-react";
import type { Plan } from "@/core/plans";
import type { Vehicle } from "@/core/fleet-contract";
import type {
  ImportResult,
  OrderBoard,
  Shipment,
} from "@/core/orders-contract";
import { todayInTimezone } from "@/core/local-date";
import { api, errors } from "./api";
import { RouteMapDialog } from "./route-map-dialog";
import { RouteOriginDialog } from "./route-origin-dialog";
import type { PublicOptimization } from "@/core/routing-contract";
import type {
  CandidateBatch,
  CandidateSelection,
  ConfirmationResult,
} from "@/core/order-candidates-contract";
import { OrderCandidatePicker } from "./order-candidate-picker";

const minuteText = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;

type RoutePublication = {
  vehicle_id: string;
  driver_id: string;
  revision: number;
  source_plan_version: number;
  published_at: string;
  started_at: string | null;
};

type PublishTarget = {
  planId: string;
  scope: "all" | "vehicle";
  vehicleId?: string;
  label: string;
};

type ManualRecalculationStatus = {
  version: number;
  current: boolean;
  status: "pending" | "running" | "failed" | null;
  errorCode: string | null;
};

function PublishRouteDialog({
  target,
  busy,
  error,
  calculating,
  onClose,
  onConfirm,
}: {
  target: PublishTarget;
  busy: boolean;
  error: string;
  calculating: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      className="fleet-dialog publish-route-dialog"
      ref={dialog}
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="panel-header">
        <h2 id={title}>Confirmar publicación</h2>
        <button
          type="button"
          className="quiet"
          aria-label="Cerrar confirmación"
          disabled={busy}
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="panel-body stack">
        <p>
          {target.scope === "all"
            ? "¿Publicar las rutas de todas las camionetas elegibles?"
            : `¿Publicar la ruta de ${target.label}?`}
        </p>
        <p className="muted">
          El chofer podrá ver la versión publicada de sus pedidos y recorrido.
          Si aún no hay recorrido vigente, se medirán calles y tiempos con
          Google Routes antes de publicar, conservando exactamente el orden
          manual. Esto puede generar consumo de Google. Publicar no inicia la
          ruta.
        </p>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer className="fleet-actions">
        <button
          type="button"
          className="quiet"
          disabled={busy}
          onClick={onClose}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="route-publish"
          disabled={busy}
          onClick={onConfirm}
        >
          <Send size={15} aria-hidden="true" />
          {calculating
            ? "Calculando recorrido…"
            : busy
              ? "Publicando…"
              : "Confirmar publicación"}
        </button>
      </footer>
    </dialog>
  );
}

function LoadDialog({
  board,
  timezone,
  busy,
  onClose,
  onSubmit,
  onManualSubmit,
  onConfirm,
}: {
  board: OrderBoard;
  timezone: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (
    vehicleIds: string[],
    validationDate: string,
  ) => Promise<CandidateBatch>;
  onConfirm: (
    batch: CandidateBatch,
    vehicleIds: string[],
    selection: CandidateSelection,
  ) => Promise<void>;
  onManualSubmit: (orderNames: string[], vehicleIds: string[]) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState(board.vehicles.map((v) => v.id));
  const [validationDate, setValidationDate] = useState(() =>
    todayInTimezone(timezone),
  );
  const nextManualId = useRef(2);
  const [manualRows, setManualRows] = useState([{ id: 1, suffix: "" }]);
  const [operation, setOperation] = useState<"dated" | "manual" | null>(null);
  const [batch, setBatch] = useState<CandidateBatch | null>(null);
  const querying = useRef(false);
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
  const submit = async () => {
    if (querying.current) return;
    querying.current = true;
    setError("");
    setOperation("dated");
    try {
      setBatch(await onSubmit(chosen, validationDate));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOperation(null);
      querying.current = false;
    }
  };
  const submitManual = async () => {
    if (querying.current || !chosen.length) {
      if (!chosen.length)
        setError("Selecciona al menos una camioneta para continuar.");
      return;
    }
    querying.current = true;
    setError("");
    setOperation("manual");
    try {
      await onManualSubmit(
        manualRows.map((row) => `S${row.suffix}`),
        chosen,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOperation(null);
      querying.current = false;
    }
  };
  const updateManualRow = (id: number, value: string) => {
    const normalized = value.trim().toUpperCase();
    const suffix = normalized.startsWith("S")
      ? normalized.slice(1)
      : normalized;
    if (![...suffix].every((character) => "0123456789".includes(character)))
      return;
    setManualRows((rows) =>
      rows.map((row) => (row.id === id ? { ...row, suffix } : row)),
    );
  };
  const manualReady =
    manualRows.length > 0 && manualRows.every((row) => row.suffix.length > 0);
  return (
    <dialog
      className={`fleet-dialog ${batch ? "candidate-dialog" : ""}`}
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
        {batch ? (
          <OrderCandidatePicker
            batch={batch}
            timezone={timezone}
            busy={busy}
            onBack={() => {
              setBatch(null);
              setError("");
            }}
            onClose={onClose}
            onConfirm={(selection) => onConfirm(batch, chosen, selection)}
          />
        ) : (
          <>
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
              <legend>Fecha de pedidos</legend>
              <label className="validation-date-field">
                <span className="sr-only">Fecha de pedidos</span>
                <input
                  aria-label="Fecha de pedidos"
                  type="date"
                  value={validationDate}
                  max={board.plan.service_date}
                  onChange={(e) => setValidationDate(e.target.value)}
                  required
                />
              </label>
              <p className="muted">
                {timezone} · Validados por fecha de validación y pendientes por
                fecha programada.
              </p>
            </fieldset>
            <div className="order-actions">
              <button
                className="primary"
                disabled={
                  busy ||
                  !loaded ||
                  !chosen.length ||
                  !validationDate ||
                  validationDate > board.plan.service_date
                }
                onClick={() => void submit()}
              >
                <Download size={16} />
                {operation === "dated" ? "Consultando…" : "Consultar pedidos"}
              </button>
            </div>
            <fieldset
              disabled={busy}
              className="vehicle-choice manual-order-box"
            >
              <legend>Cargar pedido manual fuera de fecha</legend>
              <p className="muted">
                Escribe los folios exactos. Sólo se cargarán surtidos validados
                de la empresa configurada.
              </p>
              <div className="manual-order-list">
                {manualRows.map((row, index) => (
                  <div className="manual-order-row" key={row.id}>
                    <label>
                      <span className="sr-only">
                        Folio del pedido {index + 1}
                      </span>
                      <span className="manual-order-input">
                        <span
                          className="manual-order-prefix"
                          aria-hidden="true"
                        >
                          S
                        </span>
                        <input
                          aria-label={`Número del folio S, pedido ${index + 1}`}
                          inputMode="numeric"
                          maxLength={20}
                          placeholder="00001"
                          value={row.suffix}
                          onChange={(event) =>
                            updateManualRow(row.id, event.target.value)
                          }
                        />
                      </span>
                    </label>
                    <button
                      type="button"
                      className="quiet manual-row-remove"
                      aria-label={`Quitar folio ${index + 1}`}
                      disabled={manualRows.length === 1}
                      onClick={() =>
                        setManualRows((rows) =>
                          rows.filter((candidate) => candidate.id !== row.id),
                        )
                      }
                    >
                      <X size={15} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="order-actions manual-order-actions">
                <button
                  type="button"
                  className="quiet"
                  disabled={manualRows.length >= 50}
                  onClick={() =>
                    setManualRows((rows) => [
                      ...rows,
                      { id: nextManualId.current++, suffix: "" },
                    ])
                  }
                >
                  + Agregar pedido
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={busy || !loaded || !chosen.length || !manualReady}
                  onClick={() => void submitManual()}
                >
                  <Download size={16} aria-hidden="true" />
                  {operation === "manual" ? "Cargando…" : "Confirmar pedidos"}
                </button>
              </div>
            </fieldset>
          </>
        )}
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

function RemoveShipmentDialog({
  shipment,
  busy,
  onClose,
  onConfirm,
}: {
  shipment: Shipment;
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
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return (
    <dialog
      className="fleet-dialog remove-vehicle-dialog"
      ref={dialog}
      aria-labelledby={title}
      aria-describedby={description}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="panel-header">
        <h2 id={title}>Eliminar pedido del ruteo</h2>
        <button
          className="quiet"
          aria-label="Cerrar confirmación"
          disabled={busy}
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="panel-body stack">
        <div id={description}>
          <p>¿Desea eliminar este pedido del ruteo?</p>
          <p className="removal-impact">
            <strong>{shipment.orderName}</strong> · Surtido{" "}
            {shipment.pickingName}
            <br />
            {shipment.customerName}
          </p>
        </div>
        <p className="muted">
          Sólo se quitará de este borrador. Odoo no se modifica y podrás
          recuperarlo volviendo a cargar pedidos.
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
            <Trash2 size={16} aria-hidden="true" />
            {busy ? "Eliminando…" : "Aceptar y eliminar"}
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
  onPendingValidationCount,
}: {
  plan: Plan;
  timezone: string;
  revision: number;
  onPlan: (plan: Plan) => void;
  onBusy: (busy: boolean) => void;
  onPendingValidationCount: (planId: string, count: number) => void;
}) {
  const [board, setBoard] = useState<OrderBoard | null>(null);
  const [modal, setModal] = useState(false);
  const [addVehiclesOpen, setAddVehiclesOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{
    id: string;
    name: string;
    shipmentCount: number;
  } | null>(null);
  const [removeShipmentTarget, setRemoveShipmentTarget] =
    useState<Shipment | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [originOpen, setOriginOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [publicationState, setPublicationState] = useState<{
    key: string;
    data: RoutePublication[] | null;
    error: string;
  } | null>(null);
  const [publishTarget, setPublishTarget] = useState<PublishTarget | null>(
    null,
  );
  const [publishError, setPublishError] = useState("");
  const [calculatingManual, setCalculatingManual] = useState(false);
  const publishing = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [expandedShipments, setExpandedShipments] = useState<Set<string>>(
    () => new Set(),
  );
  const endpoint = `/api/plans/${plan.id}/orders`;
  const publicationEndpoint = `/api/plans/${plan.id}/publications`;
  const publicationKey = `${plan.id}:${plan.version}:${revision}`;
  const publications =
    publicationState?.key === publicationKey ? publicationState.data : null;
  const publicationError =
    publicationState?.key === publicationKey ? publicationState.error : "";
  const update = useCallback(
    (data: OrderBoard) => {
      setBoard(data);
      onPlan(data.plan);
      onPendingValidationCount(
        data.plan.id,
        data.shipments.filter(
          (shipment) => shipment.fulfillmentStatus === "pending_validation",
        ).length,
      );
    },
    [onPendingValidationCount, onPlan],
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
    let current = true;
    api<RoutePublication[]>(publicationEndpoint)
      .then((data) => {
        if (current)
          setPublicationState({ key: publicationKey, data, error: "" });
      })
      .catch((caught) => {
        if (current)
          setPublicationState({
            key: publicationKey,
            data: null,
            error: (caught as Error).message,
          });
      });
    return () => {
      current = false;
    };
  }, [publicationEndpoint, publicationKey]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  function working(value: boolean) {
    setBusy(value);
    onBusy(value);
  }
  async function load(vehicleIds: string[], validationDate: string) {
    if (!board) throw new Error("El tablero todavía no está disponible.");
    working(true);
    setError("");
    setNotice("");
    try {
      return await api<CandidateBatch>(`${endpoint}/candidates`, "POST", {
        date: validationDate,
        vehicleIds,
        expectedVersion: board.plan.version,
      });
    } finally {
      working(false);
    }
  }
  async function confirmSelection(
    batch: CandidateBatch,
    vehicleIds: string[],
    selection: CandidateSelection,
  ) {
    working(true);
    setError("");
    setNotice("");
    try {
      const result = await api<ConfirmationResult>(
        `${endpoint}/confirm`,
        "POST",
        {
          batchId: batch.batchId,
          expectedVersion: batch.expectedVersion,
          vehicleIds,
          selection,
        },
      );
      setNotice(
        `${result.inserted} pedidos nuevos · ${result.updated} actualizados · ${result.existing} ya cargados · ${result.pending} pendientes de validar.`,
      );
      setModal(false);
      await refresh().catch((e) => setError(e.message));
    } finally {
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
  async function loadManual(orderNames: string[], vehicleIds: string[]) {
    if (!board) return;
    working(true);
    setError("");
    setNotice("");
    try {
      const result = await api<ImportResult>(`${endpoint}/manual`, "POST", {
        orderNames,
        vehicleIds,
        expectedVersion: board.plan.version,
      });
      setNotice(
        `${result.inserted} pedidos nuevos · ${result.existing} ya cargados.`,
      );
      setModal(false);
    } catch (error) {
      throw new Error(
        `${(error as Error).message} No se cargó parcialmente el lote manual.`,
      );
    } finally {
      await refresh().catch((error) => setError(error.message));
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
  async function removeOrder() {
    if (!board || !removeShipmentTarget) return;
    const target = removeShipmentTarget;
    working(true);
    setError("");
    setNotice("");
    try {
      update(
        await api<OrderBoard>(endpoint, "DELETE", {
          shipmentId: target.id,
          expectedVersion: board.plan.version,
        }),
      );
      setNotice(
        `${target.orderName} se eliminó del ruteo. Puedes recuperarlo volviendo a cargar desde Odoo.`,
      );
      setRemoveShipmentTarget(null);
    } catch (error) {
      setRemoveShipmentTarget(null);
      setError((error as Error).message);
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
  async function optimize() {
    if (!board || busy) return;
    setOptimizing(true);
    working(true);
    setError("");
    setNotice("");
    try {
      const result = await api<PublicOptimization>(
        `/api/plans/${plan.id}/optimization`,
        "POST",
        { expectedVersion: board.plan.version },
      );
      const kilometers = (
        result.metrics.travelDistanceMeters / 1000
      ).toLocaleString("es-MX", { maximumFractionDigits: 1 });
      setNotice(
        `Ruta armada · ${result.metrics.performedShipmentCount} pedidos · ${kilometers} km · ${result.skipped.length} sin asignar.`,
      );
      await refresh();
      setMapOpen(true);
    } catch (caught) {
      setError((caught as Error).message);
      await refresh().catch(() => {});
    } finally {
      setOptimizing(false);
      working(false);
    }
  }
  async function publish() {
    if (
      !board ||
      !publishTarget ||
      publishing.current ||
      publishTarget.planId !== plan.id
    )
      return;
    publishing.current = true;
    working(true);
    setPublishError("");
    try {
      const manualEndpoint = `/api/plans/${plan.id}/recalculation/manual`;
      const queued = await api<{ queued: boolean; current: boolean }>(
        manualEndpoint,
        "POST",
        { expectedVersion: board.plan.version },
      );
      if (!queued.current) {
        setCalculatingManual(true);
        let current = false;
        for (let attempt = 0; attempt < 180; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          const status = await api<ManualRecalculationStatus>(manualEndpoint);
          if (status.version !== board.plan.version)
            throw new Error(errors.VERSION_CONFLICT);
          if (status.current) {
            current = true;
            break;
          }
          if (status.status === "failed")
            throw new Error(
              errors[status.errorCode || ""] ||
                errors.ROUTING_GOOGLE_UNAVAILABLE,
            );
        }
        if (!current)
          throw new Error(
            "El recorrido sigue calculándose. Vuelve a confirmar la publicación en unos minutos; no se duplicará el cálculo.",
          );
        setCalculatingManual(false);
      }
      const result = await api<{
        changes: { vehicleId: string; revision: number; action: string }[];
        publications: RoutePublication[];
      }>(publicationEndpoint, "POST", {
        scope: publishTarget.scope,
        ...(publishTarget.vehicleId
          ? { vehicleId: publishTarget.vehicleId }
          : {}),
        expectedVersion: board.plan.version,
      });
      setPublicationState({
        key: publicationKey,
        data: result.publications,
        error: "",
      });
      setPublishTarget(null);
      setNotice(
        result.changes.length
          ? `${result.changes.length} ${result.changes.length === 1 ? "ruta actualizada" : "rutas actualizadas"} y visibles para sus choferes.`
          : "Las rutas ya estaban publicadas; no se duplicó ninguna.",
      );
    } catch (caught) {
      setPublishError((caught as Error).message);
    } finally {
      setCalculatingManual(false);
      publishing.current = false;
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
        <div className="shipment-card-head">
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
            </span>
            <ChevronDown
              className="shipment-chevron"
              size={14}
              aria-hidden="true"
            />
            <span className="shipment-tags">
              <span className="badge">
                {s.fulfillmentStatus === "pending_validation"
                  ? "Pendiente Odoo"
                  : "Validado"}
              </span>
              <span className="badge">
                {s.deliveryWindows.length
                  ? s.deliveryWindows
                      .map(
                        (window) =>
                          `${minuteText(window.startMinute)}–${minuteText(window.endMinute)}`,
                      )
                      .join(" / ")
                  : "Sin horario"}
              </span>
              <span className={`badge shipment-priority ${s.priority}`}>
                {s.priority === "high"
                  ? "Prioridad alta"
                  : s.priority === "medium"
                    ? "Prioridad media"
                    : "Por horario"}
              </span>
            </span>
          </button>
          <button
            type="button"
            className="shipment-remove"
            draggable={false}
            disabled={busy}
            aria-label={`Eliminar pedido ${s.orderName} del ruteo`}
            onClick={() => setRemoveShipmentTarget(s)}
          >
            <span className="shipment-remove-visual" aria-hidden="true">
              <Trash2 size={12} />
            </span>
          </button>
        </div>
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
            {s.phone && <p className="muted">Teléfono: {s.phone}</p>}
            {s.deliveryNote && (
              <p className="delivery-note">Entrega: {s.deliveryNote}</p>
            )}
            {s.mapUrl && (
              <a
                href={s.mapUrl}
                target="_blank"
                rel="noreferrer"
                className="map-link"
              >
                Abrir punto en Google Maps
              </a>
            )}
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
  const publicationByVehicle = new globalThis.Map<string, RoutePublication>(
    publications?.map((publication) => [publication.vehicle_id, publication]) ??
      [],
  );
  const eligible =
    board?.vehicles.filter(
      (vehicle) =>
        board.shipments.some(
          (shipment) => shipment.vehicle_id === vehicle.id,
        ) && !publicationByVehicle.get(vehicle.id)?.started_at,
    ) ?? [];
  const hasPublished = eligible.some((vehicle) =>
    publicationByVehicle.has(vehicle.id),
  );
  const globalPublishLabel = hasPublished
    ? "Guardar y publicar"
    : "Publicar rutas";
  return (
    <div className="orders-section" aria-busy={busy}>
      <div className="orders-toolbar">
        <span className="muted">
          {board
            ? `${board.shipments.length} pedidos · ${board.vehicles.length} camionetas`
            : "Cargando tablero…"}
        </span>
        <div className="orders-toolbar-actions">
          {board && (
            <a
              className="quiet button-link"
              href={`/api/plans/${board.plan.id}/export`}
              aria-label={`Exportar ${board.plan.label} a Excel`}
            >
              <FileSpreadsheet size={16} />
              <span className="toolbar-action-label">Exportar Excel</span>
            </a>
          )}
          <button
            className="quiet"
            disabled={!board || busy}
            aria-label="Configurar punto de salida"
            onClick={() => setOriginOpen(true)}
          >
            <MapPinned size={16} />
            <span className="toolbar-action-label">Punto de salida</span>
          </button>
          <button
            className="quiet"
            disabled={!board || busy}
            aria-label="Añadir camioneta"
            onClick={() => setAddVehiclesOpen(true)}
          >
            <Truck size={16} />
            <span className="toolbar-action-label">Añadir camioneta</span>
          </button>
          <button
            className="quiet"
            disabled={!board || busy || !board.shipments.length}
            aria-label="Ver mapa de rutas"
            onClick={() => setMapOpen(true)}
          >
            <Map size={16} />
            <span className="toolbar-action-label">Ver mapa de rutas</span>
          </button>
          <button
            className="odoo-load"
            disabled={busy || !board}
            aria-label="Cargar pedidos de Odoo"
            onClick={() => setModal(true)}
          >
            <Image
              className="odoo-mark"
              src="/odoo-logo-inverted.svg"
              alt=""
              width={64}
              height={22}
            />
            <span className="toolbar-action-label">Cargar pedidos</span>
          </button>
          <button
            className="route-optimize"
            disabled={
              !board ||
              busy ||
              !board.shipments.length ||
              !board.vehicles.length
            }
            aria-label="Armar ruta con optimización vial de Google"
            onClick={() => void optimize()}
          >
            <Sparkles size={16} />
            <span className="toolbar-action-label">
              {optimizing ? "Calculando…" : "Armar ruta"}
            </span>
          </button>
          <button
            type="button"
            className="route-publish"
            disabled={
              !board ||
              board.plan.id !== plan.id ||
              busy ||
              !publications ||
              !eligible.length
            }
            aria-label={globalPublishLabel}
            onClick={() => {
              setPublishError("");
              setPublishTarget({
                planId: plan.id,
                scope: "all",
                label: "todas las camionetas",
              });
            }}
          >
            <Send size={16} aria-hidden="true" />
            <span className="toolbar-action-label">{globalPublishLabel}</span>
          </button>
        </div>
      </div>
      {publicationError && (
        <p className="publication-load-error" role="alert">
          No se pudo consultar qué rutas están publicadas: {publicationError}
        </p>
      )}
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
            const publication = v.id
              ? publicationByVehicle.get(v.id)
              : undefined;
            const fleetChanged = Boolean(
              v.id && v.driver_id !== v.fleet_driver_id,
            );
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
                    <small>
                      {publication?.started_at
                        ? `Ruta de ${v.driver_name || "chofer sin nombre"}`
                        : v.fleet_driver_name || "Sin chofer en flota"}
                      {fleetChanged &&
                      publication?.started_at &&
                      v.fleet_driver_name
                        ? ` · Flota: ${v.fleet_driver_name}`
                        : ""}
                    </small>
                  )}
                  {v.id && lane.length > 0 && publications && (
                    <div className="lane-publication">
                      {publication?.started_at ? (
                        <span className="lane-publication-state">
                          Ruta iniciada
                        </span>
                      ) : (
                        <>
                          {publication && (
                            <span className="lane-publication-state">
                              {fleetChanged
                                ? "Requiere republicar para el nuevo chofer"
                                : "Ruta publicada"}
                            </span>
                          )}
                          <button
                            type="button"
                            className="lane-publish"
                            disabled={
                              busy ||
                              board.plan.id !== plan.id ||
                              !v.fleet_driver_id ||
                              !v.available
                            }
                            onClick={() => {
                              setPublishError("");
                              setPublishTarget({
                                planId: plan.id,
                                scope: "vehicle",
                                vehicleId: v.id,
                                label: v.name,
                              });
                            }}
                          >
                            <Send size={12} aria-hidden="true" />
                            {publication
                              ? "Guardar y publicar"
                              : "Activar ruta"}
                          </button>
                        </>
                      )}
                    </div>
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
          onManualSubmit={loadManual}
          onConfirm={confirmSelection}
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
      {removeShipmentTarget && (
        <RemoveShipmentDialog
          shipment={removeShipmentTarget}
          busy={busy}
          onClose={() => setRemoveShipmentTarget(null)}
          onConfirm={removeOrder}
        />
      )}
      {mapOpen && board && (
        <RouteMapDialog
          board={board}
          timezone={timezone}
          onClose={() => {
            setMapOpen(false);
            void api<OrderBoard>(endpoint)
              .then(update)
              .catch((caught) => setNotice((caught as Error).message));
          }}
        />
      )}
      {originOpen && (
        <RouteOriginDialog
          plan={board?.plan || plan}
          onPlan={(saved) => {
            if (board) update({ ...board, plan: saved });
          }}
          onClose={() => setOriginOpen(false)}
          onSaved={() => setNotice("Punto de salida confirmado.")}
        />
      )}
      {publishTarget?.planId === plan.id && (
        <PublishRouteDialog
          target={publishTarget}
          busy={busy}
          error={publishError}
          calculating={calculatingManual}
          onClose={() => setPublishTarget(null)}
          onConfirm={() => void publish()}
        />
      )}
    </div>
  );
}
