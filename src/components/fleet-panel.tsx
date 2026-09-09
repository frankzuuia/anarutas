"use client";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import Image from "next/image";
import {
  Plus,
  Truck,
  UserRound,
  Pencil,
  Link2,
  FileImage,
  X,
  Upload,
  Phone,
} from "lucide-react";
import { api, errors, navigateAfterAuth } from "./api";
import {
  fuels,
  bloodTypes,
  documentKinds,
  documentLabels,
  maxDocumentBytes,
  type Driver,
  type Vehicle,
  type DocumentKind,
} from "@/core/fleet-contract";

type ModalState =
  | { type: "vehicle"; id: string; data: Vehicle | null }
  | { type: "driver"; id: string; data: Driver | null; returnTo?: Vehicle }
  | { type: "assign"; data: Vehicle }
  | { type: "documents"; data: Driver };

function Modal({
  title,
  busy,
  onClose,
  children,
}: {
  title: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      className="fleet-dialog"
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="panel-header">
        <h2 id={titleId}>{title}</h2>
        <button
          className="quiet"
          type="button"
          aria-label="Cerrar formulario"
          disabled={busy}
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      <div className="panel-body">{children}</div>
    </dialog>
  );
}

export function FleetPanel({
  section,
  revision,
}: {
  section: "vehicles" | "drivers";
  revision: number;
}) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    const [v, d] = await Promise.all([
      api<Vehicle[]>("/api/vehicles"),
      api<Driver[]>("/api/drivers"),
    ]);
    setVehicles(v);
    setDrivers(d);
  }, []);
  useEffect(() => {
    let current = true;
    Promise.all([
      api<Vehicle[]>("/api/vehicles"),
      api<Driver[]>("/api/drivers"),
    ])
      .then(([v, d]) => {
        if (current) {
          setVehicles(v);
          setDrivers(d);
        }
      })
      .catch((e: Error) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [revision]);
  function open(next: ModalState) {
    setError("");
    setNotice("");
    setModal(next);
  }
  function close() {
    setModal(null);
    setError("");
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function saveVehicle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (modal?.type !== "vehicle") return;
    const form = new FormData(event.currentTarget);
    const input = {
      ...Object.fromEntries(form),
      id: modal.id,
      mileage: Number(form.get("mileage")),
      available: form.get("available") === "on",
      expectedVersion: modal.data?.version,
    };
    void run(async () => {
      await api(
        modal.data ? `/api/vehicles/${modal.id}` : "/api/vehicles",
        modal.data ? "PATCH" : "POST",
        input,
      );
      close();
      setNotice("Camioneta guardada.");
      await refresh();
    });
  }
  function saveDriver(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (modal?.type !== "driver") return;
    const form = new FormData(event.currentTarget);
    const input = {
      ...Object.fromEntries(form),
      id: modal.id,
      active: form.get("active") === "on",
      expectedVersion: modal.data?.version,
    };
    void run(async () => {
      const record = await api<Driver>(
        modal.data ? `/api/drivers/${modal.id}` : "/api/drivers",
        modal.data ? "PATCH" : "POST",
        input,
      );
      if (modal.returnTo) setModal({ type: "assign", data: modal.returnTo });
      else setModal({ type: "documents", data: record });
      setNotice("Chofer guardado. Puedes completar sus fotos y licencia.");
      await refresh();
    });
  }
  function saveAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (modal?.type !== "assign") return;
    const selected = new FormData(event.currentTarget).get("driver_id");
    void run(async () => {
      await api(`/api/vehicles/${modal.data.id}/driver`, "PUT", {
        driver_id: selected || null,
        expectedVersion: modal.data.version,
      });
      close();
      setNotice(
        selected
          ? "Chofer asignado."
          : "Asignación retirada. El chofer queda libre.",
      );
      await refresh();
    });
  }
  function toggleVehicleAvailability(vehicle: Vehicle) {
    void run(async () => {
      await api<Vehicle>(`/api/vehicles/${vehicle.id}`, "PATCH", {
        name: vehicle.name,
        brand: vehicle.brand,
        model: vehicle.model,
        plate: vehicle.plate,
        mileage: Number(vehicle.mileage),
        fuel: vehicle.fuel,
        available: !vehicle.available,
        expectedVersion: vehicle.version,
      });
      setNotice(
        vehicle.available
          ? "Camioneta marcada como no disponible."
          : "Camioneta marcada como disponible.",
      );
      await refresh();
    });
  }
  function upload(event: FormEvent<HTMLFormElement>, kind: DocumentKind) {
    event.preventDefault();
    if (modal?.type !== "documents") return;
    const form = event.currentTarget;
    const file = new FormData(form).get("file");
    if (!(file instanceof File) || !file.size) {
      setError("Selecciona una foto para subir.");
      return;
    }
    if (file.size > maxDocumentBytes) {
      setError(errors.DOCUMENT_TOO_LARGE);
      return;
    }
    void run(async () => {
      const response = await fetch(
        `/api/drivers/${modal.data.id}/documents/${kind}`,
        {
          method: "PUT",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            "Content-Type": file.type,
            "X-Record-Version": String(modal.data.version),
          },
          body: file,
        },
      );
      const result = await response.json();
      if (response.status === 401) navigateAfterAuth("/login");
      if (!response.ok)
        throw new Error(errors[result.error] || "No se pudo guardar la foto.");
      setModal({ type: "documents", data: result as Driver });
      form.reset();
      setNotice("Foto guardada de forma privada.");
      await refresh();
    });
  }
  const titles = {
    vehicle:
      modal?.type === "vehicle" && modal.data
        ? "Editar camioneta"
        : "Añadir camioneta",
    driver:
      modal?.type === "driver" && modal.data
        ? "Editar chofer"
        : "Registrar chofer",
    assign: "Asignar chofer",
    documents: "Fotos y licencia",
  };
  return (
    <div className="stack">
      <div className="row between fleet-toolbar">
        <div className="row">
          <span className="badge">
            {section === "vehicles"
              ? `${vehicles.length} camionetas`
              : `${drivers.length} choferes`}
          </span>
          <span className="small">
            {section === "vehicles"
              ? `${vehicles.filter((v) => v.available).length} disponibles`
              : `${drivers.filter((d) => d.active).length} activos`}
          </span>
        </div>
        <button
          className="primary"
          disabled={loading || busy}
          onClick={() =>
            section === "vehicles"
              ? open({ type: "vehicle", id: crypto.randomUUID(), data: null })
              : open({ type: "driver", id: crypto.randomUUID(), data: null })
          }
        >
          <Plus size={16} />
          {section === "vehicles" ? "Añadir camioneta" : "Registrar chofer"}
        </button>
      </div>
      {!modal && error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {!modal && notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {loading ? (
        <p role="status">Cargando flota…</p>
      ) : (
        <>
          {section === "vehicles" ? (
            <div className="fleet-grid">
              {vehicles.map((v) => {
                const assignedDriver = drivers.find(
                  (driver) => driver.id === v.driver_id,
                );
                const hasDriverPhoto =
                  assignedDriver?.documents.includes("photo") ?? false;
                return (
                  <article
                    className="panel fleet-card"
                    key={v.id}
                    aria-label={v.name}
                  >
                    <header className="panel-header">
                      <div className="row">
                        <Truck size={19} />
                        <h2>{v.name}</h2>
                      </div>
                      <div className="availability-control">
                        <span
                          className={`badge ${v.available ? "green" : "amber"}`}
                        >
                          {v.available ? "Disponible" : "No disponible"}
                        </span>
                        <button
                          className="availability-switch"
                          type="button"
                          role="switch"
                          aria-checked={v.available}
                          aria-label={`Disponibilidad de ${v.name}`}
                          title={
                            v.available
                              ? "Marcar como no disponible"
                              : "Marcar como disponible"
                          }
                          disabled={busy}
                          onClick={() => toggleVehicleAvailability(v)}
                        >
                          <span className="availability-track" aria-hidden>
                            <span className="availability-thumb" />
                          </span>
                        </button>
                      </div>
                    </header>
                    <div className="panel-body stack">
                      <div>
                        <strong>{v.plate}</strong>
                        <p className="small">
                          {v.brand} · {v.model}
                        </p>
                      </div>
                      <div className="row between small">
                        <span>
                          {Number(v.mileage).toLocaleString("es-MX")} km
                        </span>
                        <span>{v.fuel}</span>
                      </div>
                      <div className="fleet-assignee">
                        {v.driver_id && hasDriverPhoto ? (
                          <Image
                            unoptimized
                            className="driver-avatar-photo"
                            src={`/api/drivers/${v.driver_id}/documents/photo?v=${assignedDriver?.version}`}
                            width={36}
                            height={36}
                            alt={`Foto de ${v.driver_name}`}
                          />
                        ) : (
                          <span className="driver-avatar-fallback" aria-hidden>
                            <UserRound size={16} />
                          </span>
                        )}
                        <span>{v.driver_name || "Sin chofer asignado"}</span>
                      </div>
                    </div>
                    <footer className="fleet-actions">
                      <button
                        className="quiet"
                        disabled={busy}
                        onClick={() =>
                          open({ type: "vehicle", data: v, id: v.id })
                        }
                      >
                        <Pencil size={14} />
                        Editar
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => open({ type: "assign", data: v })}
                      >
                        <Link2 size={14} />
                        {v.driver_id ? "Cambiar chofer" : "Asignar chofer"}
                      </button>
                    </footer>
                  </article>
                );
              })}
              {!vehicles.length && (
                <div className="panel empty">
                  <Truck size={26} />
                  <h3>Aún no hay camionetas</h3>
                  <p>
                    Registra una unidad para después seleccionarla al planificar
                    tus rutas.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="fleet-grid">
              {drivers.map((d) => (
                <article
                  className="panel fleet-card"
                  key={d.id}
                  aria-label={d.name}
                >
                  <header className="panel-header">
                    <div className="row">
                      <UserRound size={19} />
                      <h2>{d.name}</h2>
                    </div>
                    <span className={`badge ${d.active ? "green" : "amber"}`}>
                      {d.active ? "Activo" : "Inactivo"}
                    </span>
                  </header>
                  <div className="panel-body stack">
                    <div className="row">
                      <Phone size={14} />
                      <span>{d.phone}</span>
                    </div>
                    <span className="small">
                      {vehicles.find((v) => v.driver_id === d.id)?.name ||
                        "Sin camioneta asignada"}
                    </span>
                    <span className="small">
                      Documentos: {d.documents.length} de 3 cargados
                    </span>
                  </div>
                  <footer className="fleet-actions">
                    <button
                      className="quiet"
                      disabled={busy}
                      onClick={() =>
                        open({ type: "driver", data: d, id: d.id })
                      }
                    >
                      <Pencil size={14} />
                      Editar
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => open({ type: "documents", data: d })}
                    >
                      <FileImage size={14} />
                      Fotos y licencia
                    </button>
                  </footer>
                </article>
              ))}
              {!drivers.length && (
                <div className="panel empty">
                  <UserRound size={26} />
                  <h3>Aún no hay choferes</h3>
                  <p>
                    Registra sus datos y documentos. Esto no crea una cuenta de
                    acceso al panel.
                  </p>
                </div>
              )}
            </div>
          )}
          <p className="small">
            Las asignaciones son de la flota. La selección de camionetas por día
            se conectará con la carga de pedidos.
          </p>
        </>
      )}
      {modal && (
        <Modal
          key={`${modal.type}-${modal.type === "vehicle" || modal.type === "driver" ? modal.id : modal.data.id}`}
          title={titles[modal.type]}
          busy={busy}
          onClose={close}
        >
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="notice">
              {notice}
            </p>
          )}
          {modal.type === "vehicle" && (
            <form className="stack" onSubmit={saveVehicle}>
              <fieldset disabled={busy} className="fleet-fields">
                <label className="span-two">
                  Nombre de unidad
                  <input
                    name="name"
                    defaultValue={modal.data?.name}
                    placeholder="Ej. Camioneta 1"
                    required
                    maxLength={120}
                  />
                </label>
                <label>
                  Marca
                  <input
                    name="brand"
                    defaultValue={modal.data?.brand}
                    required
                    maxLength={120}
                  />
                </label>
                <label>
                  Modelo
                  <input
                    name="model"
                    defaultValue={modal.data?.model}
                    required
                    maxLength={120}
                  />
                </label>
                <label>
                  Placas
                  <input
                    name="plate"
                    defaultValue={modal.data?.plate}
                    required
                    maxLength={32}
                  />
                </label>
                <label>
                  Kilometraje
                  <input
                    type="number"
                    name="mileage"
                    defaultValue={modal.data?.mileage}
                    required
                    min={0}
                    max={9999999999.99}
                    step="0.01"
                  />
                </label>
                <label>
                  Combustible
                  <select
                    name="fuel"
                    aria-label="Combustible"
                    defaultValue={modal.data?.fuel || ""}
                    required
                  >
                    <option value="" disabled>
                      Selecciona combustible
                    </option>
                    {fuels.map((fuel) => (
                      <option key={fuel}>{fuel}</option>
                    ))}
                  </select>
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    name="available"
                    defaultChecked={modal.data?.available ?? true}
                  />
                  Disponible para operar
                </label>
              </fieldset>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="quiet"
                  disabled={busy}
                  onClick={close}
                >
                  Cancelar
                </button>
                <button className="primary" disabled={busy}>
                  {busy ? "Guardando…" : "Guardar camioneta"}
                </button>
              </div>
            </form>
          )}
          {modal.type === "driver" && (
            <form className="stack" onSubmit={saveDriver}>
              <fieldset disabled={busy} className="fleet-fields">
                <label className="span-two">
                  Nombre del chofer
                  <input
                    name="name"
                    defaultValue={modal.data?.name}
                    required
                    minLength={2}
                    maxLength={120}
                  />
                </label>
                <label>
                  Teléfono del chofer
                  <input
                    type="tel"
                    name="phone"
                    defaultValue={modal.data?.phone}
                    required
                    minLength={5}
                    maxLength={40}
                  />
                </label>
                <label>
                  Tipo de sangre (opcional)
                  <select
                    name="blood_type"
                    aria-label="Tipo de sangre (opcional)"
                    defaultValue={modal.data?.blood_type || ""}
                  >
                    {bloodTypes.map((type) => (
                      <option value={type} key={type}>
                        {type || "No indicado"}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Contacto de emergencia
                  <input
                    name="emergency_name"
                    defaultValue={modal.data?.emergency_name}
                    maxLength={120}
                  />
                </label>
                <label>
                  Teléfono de emergencia
                  <input
                    type="tel"
                    name="emergency_phone"
                    defaultValue={modal.data?.emergency_phone}
                    maxLength={40}
                  />
                </label>
                <label className="check-label span-two">
                  <input
                    type="checkbox"
                    name="active"
                    defaultChecked={modal.data?.active ?? true}
                  />
                  Chofer activo
                </label>
              </fieldset>
              <p className="small">
                Después de guardar podrás cargar su foto y las fotos de su
                licencia. Sus documentos son privados.
              </p>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="quiet"
                  disabled={busy}
                  onClick={close}
                >
                  Cancelar
                </button>
                <button className="primary" disabled={busy}>
                  {busy ? "Guardando…" : "Guardar chofer"}
                </button>
              </div>
            </form>
          )}
          {modal.type === "assign" && (
            <form className="stack" onSubmit={saveAssignment}>
              <p>
                <strong>{modal.data.name}</strong>
                <br />
                <span className="small">{modal.data.plate}</span>
              </p>
              <label>
                Chofer
                <select
                  name="driver_id"
                  aria-label="Chofer"
                  defaultValue={modal.data.driver_id || ""}
                  disabled={busy}
                >
                  <option value="">Sin chofer · quitar asignación</option>
                  {drivers.map((d) => {
                    const occupied = vehicles.find(
                      (v) => v.driver_id === d.id && v.id !== modal.data.id,
                    );
                    return (
                      <option
                        key={d.id}
                        value={d.id}
                        disabled={
                          !d.active ||
                          Boolean(occupied) ||
                          !modal.data.available
                        }
                      >
                        {d.name}
                        {occupied
                          ? ` · En ${occupied.name}`
                          : !d.active
                            ? " · Inactivo"
                            : ""}
                      </option>
                    );
                  })}
                </select>
              </label>
              {!modal.data.available && (
                <p className="small">
                  Esta camioneta no está disponible. Edítala antes de asignar un
                  chofer.
                </p>
              )}
              <button
                type="button"
                className="quiet"
                disabled={busy}
                onClick={() =>
                  open({
                    type: "driver",
                    id: crypto.randomUUID(),
                    data: null,
                    returnTo: modal.data,
                  })
                }
              >
                <Plus size={14} />
                Registrar nuevo chofer
              </button>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="quiet"
                  disabled={busy}
                  onClick={close}
                >
                  Cancelar
                </button>
                <button className="primary" disabled={busy}>
                  {busy ? "Guardando…" : "Guardar asignación"}
                </button>
              </div>
            </form>
          )}
          {modal.type === "documents" && (
            <div className="stack">
              <p>
                <strong>{modal.data.name}</strong>
                <br />
                <span className="small">
                  JPG, PNG o WebP · máximo 8 MB y 20 megapíxeles por foto. Una
                  nueva subida reemplaza la foto de ese apartado.
                </span>
              </p>
              {documentKinds.map((kind) => (
                <form
                  className="document-slot"
                  key={kind}
                  onSubmit={(event) => upload(event, kind)}
                >
                  <label>
                    {documentLabels[kind]}
                    <input
                      type="file"
                      name="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={busy}
                      required
                    />
                  </label>
                  {modal.data.documents.includes(kind) ? (
                    <a
                      className="private-photo"
                      href={`/api/drivers/${modal.data.id}/documents/${kind}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Ver ${documentLabels[kind]}`}
                    >
                      <Image
                        unoptimized
                        src={`/api/drivers/${modal.data.id}/documents/${kind}?v=${modal.data.version}`}
                        width={180}
                        height={110}
                        alt={documentLabels[kind]}
                      />
                    </a>
                  ) : (
                    <span className="small">Pendiente de cargar</span>
                  )}
                  <button type="submit" disabled={busy}>
                    <Upload size={14} />
                    {modal.data.documents.includes(kind)
                      ? "Reemplazar foto"
                      : "Subir foto"}
                  </button>
                </form>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
