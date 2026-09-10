"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Building2,
  Download,
  PanelRightClose,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import type {
  Customer,
  CustomerList,
  CustomerSyncResult,
  CustomerWindow,
} from "@/core/customers-contract";
import { api } from "./api";
import {
  CustomerLocationEditor,
  type EditableLocation,
} from "./customer-location-editor";
import { CustomerArchiveDialog } from "./customer-archive-dialog";

const dayLabels = ["L", "M", "X", "J", "V", "S", "D"];
const dayNames = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const clockPattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

type FormWindow = {
  key: string;
  days: number[];
  start: string;
  end: string;
};
type FormState = {
  displayName: string;
  phone: string;
  deliveryNote: string;
  priority: Customer["priority"];
  fulfillmentMode: Customer["fulfillmentMode"];
  deliveryAddress: string;
  mapUrl: string;
  location: EditableLocation | null;
  windows: FormWindow[];
};

function minuteText(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
function formState(customer: Customer): FormState {
  return {
    displayName: customer.displayName,
    phone: customer.phone || "",
    deliveryNote: customer.deliveryNote,
    priority: customer.priority,
    fulfillmentMode: customer.fulfillmentMode,
    deliveryAddress: customer.deliveryAddress,
    mapUrl: customer.mapUrl || "",
    location:
      customer.latitude !== null && customer.longitude !== null
        ? {
            latitude: customer.latitude,
            longitude: customer.longitude,
            placeId: customer.placeId,
          }
        : null,
    windows: customer.windows.map((window) => ({
      key: window.id,
      days: window.days,
      start: minuteText(window.startMinute),
      end: minuteText(window.endMinute),
    })),
  };
}
function clock(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return { hour, minute };
}
function compactWindows(windows: CustomerWindow[]) {
  if (!windows.length) return "Sin horario";
  return (
    windows
      .slice(0, 2)
      .map(
        (window) =>
          `${window.days.map((day) => dayNames[day]).join("/")} ${minuteText(window.startMinute)}–${minuteText(window.endMinute)}`,
      )
      .join(" · ") + (windows.length > 2 ? ` · +${windows.length - 2}` : "")
  );
}
function sourceType(customer: Customer) {
  if (customer.odooIsCompany) return "Matriz";
  if (customer.odooType === "delivery") return "Entrega";
  if (customer.odooType === "invoice") return "Facturación";
  return customer.odooParentId ? "Sucursal / contacto" : "Contacto";
}

export function CustomerPanel({ revision }: { revision: number }) {
  const loadSequence = useRef(0);
  const [archived, setArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [data, setData] = useState<CustomerList>({
    customers: [],
    active: 0,
    archived: 0,
    nextCursor: null,
    hasMore: false,
  });
  const [selected, setSelected] = useState<Customer | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<Customer | null>(null);
  const [editorHidden, setEditorHidden] = useState(false);
  const dirty = Boolean(
    selected &&
    form &&
    JSON.stringify(form) !== JSON.stringify(formState(selected)),
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = useCallback(
    async (append = false) => {
      const request = ++loadSequence.current;
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          archived: String(archived),
          q: debounced,
          limit: "150",
          ...(append && data.nextCursor ? { after: data.nextCursor } : {}),
        });
        const result = await api<CustomerList>(`/api/customers?${params}`);
        if (request !== loadSequence.current) return;
        setData((previous) => ({
          ...result,
          customers: append
            ? [...previous.customers, ...result.customers]
            : result.customers,
        }));
        if (!append && !(selected && dirty)) {
          const refreshed = selected
            ? result.customers.find((customer) => customer.id === selected.id)
            : null;
          if (refreshed && !dirty) {
            setSelected(refreshed);
            setForm(formState(refreshed));
          } else if (!refreshed) {
            setSelected(result.customers[0] || null);
            setForm(
              result.customers[0] ? formState(result.customers[0]) : null,
            );
          }
        }
      } catch (caught) {
        if (request !== loadSequence.current) return;
        setError((caught as Error).message);
      } finally {
        if (request === loadSequence.current) setLoading(false);
      }
    },
    [archived, debounced, data.nextCursor, dirty, selected],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(false), 0);
    // Deliberately reload only when the tab, normalized query or explicit revision changes.
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archived, debounced, revision]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function choose(customer: Customer) {
    if (
      dirty &&
      !window.confirm(
        "Hay cambios sin guardar. ¿Descartarlos y abrir otro cliente?",
      )
    )
      return;
    setSelected(customer);
    setForm(formState(customer));
    setEditorHidden(false);
    setError("");
  }

  function closeEditor() {
    if (!selected || !form) return;
    if (
      dirty &&
      !window.confirm(
        "Hay cambios sin guardar. ¿Descartarlos y ocultar el panel de edición?",
      )
    )
      return;
    if (dirty) setForm(formState(selected));
    setEditorHidden(true);
    setError("");
  }

  async function save() {
    if (!selected || !form) return;
    setBusy(true);
    setError("");
    try {
      const updated = await api<Customer>(
        `/api/customers/${selected.id}`,
        "PATCH",
        {
          displayName: form.displayName,
          phone: form.phone || null,
          deliveryNote: form.deliveryNote,
          priority: form.priority,
          fulfillmentMode: form.fulfillmentMode,
          deliveryAddress: form.deliveryAddress,
          mapUrl: form.mapUrl || null,
          location: form.location,
          windows: form.windows.map((window) => ({
            days: window.days,
            start: clock(window.start),
            end: clock(window.end),
          })),
          expectedVersion: selected.version,
        },
      );
      setSelected(updated);
      setForm(formState(updated));
      setData((previous) => ({
        ...previous,
        customers: previous.customers.map((customer) =>
          customer.id === updated.id ? updated : customer,
        ),
      }));
      setNotice("Cambios del cliente guardados.");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function synchronize() {
    if (dirty) {
      setError("Guarda o descarta la edición antes de actualizar clientes.");
      return;
    }
    setSyncing(true);
    setError("");
    setNotice("");
    let cursor = 0;
    let ceiling: number | undefined;
    const total = { inserted: 0, existing: 0, sourceChanged: 0 };
    try {
      while (true) {
        const result = await api<CustomerSyncResult>(
          "/api/customers/sync",
          "POST",
          { cursor, ...(ceiling === undefined ? {} : { ceiling }) },
        );
        total.inserted += result.inserted;
        total.existing += result.existing;
        total.sourceChanged += result.sourceChanged;
        ceiling = result.ceiling;
        if (!result.hasMore) break;
        if (result.nextCursor <= cursor)
          throw new Error(
            "Odoo no avanzó la paginación; el proceso se detuvo de forma segura.",
          );
        cursor = result.nextCursor;
      }
      await load(false);
      setNotice(
        `${total.inserted} clientes nuevos · ${total.existing} ya existentes · ${total.sourceChanged} cambios sólo en datos fuente Odoo.`,
      );
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  async function changeArchive() {
    if (!archiveTarget) return;
    setBusy(true);
    setError("");
    try {
      await api(
        `/api/customers/${archiveTarget.id}/archive`,
        archived ? "DELETE" : "POST",
        { expectedVersion: archiveTarget.version },
      );
      setArchiveTarget(null);
      setSelected(null);
      setForm(null);
      await load(false);
      setNotice(
        archived
          ? "Cliente restaurado."
          : "Cliente archivado sin borrar su configuración.",
      );
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const exportUrl = useMemo(() => {
    const params = new URLSearchParams({
      archived: String(archived),
      q: debounced,
    });
    return `/api/customers/export?${params}`;
  }, [archived, debounced]);

  return (
    <section className="customer-panel">
      <div className="customer-command-bar">
        <div
          className="customer-tabs"
          role="tablist"
          aria-label="Estado de clientes"
        >
          <button
            className={!archived ? "active" : ""}
            role="tab"
            aria-selected={!archived}
            onClick={() => {
              if (
                !dirty ||
                window.confirm(
                  "Hay cambios sin guardar. ¿Descartarlos y cambiar de lista?",
                )
              )
                setArchived(false);
            }}
          >
            Activos <span>{data.active}</span>
          </button>
          <button
            className={archived ? "active" : ""}
            role="tab"
            aria-selected={archived}
            onClick={() => {
              if (
                !dirty ||
                window.confirm(
                  "Hay cambios sin guardar. ¿Descartarlos y cambiar de lista?",
                )
              )
                setArchived(true);
            }}
          >
            Archivados <span>{data.archived}</span>
          </button>
        </div>
        <label className="customer-search">
          <Search size={16} />
          <span className="sr-only">Buscar clientes</span>
          <input
            value={query}
            maxLength={200}
            placeholder="Buscar cliente, Odoo, teléfono o matriz…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button
          className="quiet"
          disabled={syncing || busy}
          onClick={() => void synchronize()}
        >
          <RefreshCw size={16} className={syncing ? "spin" : ""} />
          {syncing ? "Actualizando…" : "Actualizar clientes"}
        </button>
        <a className="quiet button-link" href={exportUrl}>
          <Download size={16} /> Exportar Excel
        </a>
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
      <div
        className={`customer-workspace ${editorHidden ? "editor-hidden" : ""}`}
      >
        <div className="customer-list" aria-busy={loading}>
          <div className="customer-list-head">
            <span>Cliente / Nombre en Odoo</span>
            <span>Ventanas</span>
            <span>Prioridad</span>
            <span>Domicilio y punto</span>
          </div>
          <div className="customer-list-scroll">
            {!data.customers.length && !loading && (
              <div className="empty compact">
                <Building2 size={28} />
                <h3>
                  {archived
                    ? "No hay clientes archivados"
                    : "Actualiza el directorio de Odoo"}
                </h3>
                <p>
                  La sincronización es de sólo lectura y conserva tus
                  configuraciones.
                </p>
              </div>
            )}
            {data.customers.map((customer) => (
              <button
                key={customer.id}
                className={`customer-row ${selected?.id === customer.id ? "selected" : ""}`}
                onClick={() => choose(customer)}
              >
                <span>
                  <strong>{customer.displayName}</strong>
                  <small>
                    {customer.odooName} · {sourceType(customer)} · ID{" "}
                    {customer.odooPartnerId}
                  </small>
                  {customer.parentName && (
                    <small>Matriz: {customer.parentName}</small>
                  )}
                </span>
                <small>{compactWindows(customer.windows)}</small>
                <span className={`priority-pill ${customer.priority}`}>
                  {customer.priority === "high"
                    ? "Alta"
                    : customer.priority === "medium"
                      ? "Media"
                      : "Por horario"}
                </span>
                <span>
                  <small>{customer.deliveryAddress || "Sin domicilio"}</small>
                  <small
                    className={
                      customer.locationStatus === "pending"
                        ? "warning"
                        : "success"
                    }
                  >
                    {customer.locationStatus === "pending"
                      ? "Punto por confirmar"
                      : "Punto confirmado"}
                  </small>
                </span>
              </button>
            ))}
            {data.hasMore && (
              <button
                className="quiet load-more"
                disabled={loading}
                onClick={() => void load(true)}
              >
                {loading ? "Cargando…" : "Cargar más"}
              </button>
            )}
          </div>
        </div>
        <aside className="customer-editor" hidden={editorHidden}>
          {!selected || !form ? (
            <div className="empty compact">
              <Building2 size={28} />
              <h3>Selecciona un cliente</h3>
              <p>Edita su operación sin escribir en Odoo.</p>
            </div>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <header className="customer-editor-head">
                <div>
                  <small>
                    {sourceType(selected)} · Odoo #{selected.odooPartnerId}
                  </small>
                  <h2>{selected.displayName}</h2>
                </div>
                <div className="customer-editor-head-actions">
                  <button
                    type="button"
                    className={`${archived ? "quiet" : "danger"} customer-archive-action`}
                    onClick={() => {
                      if (dirty)
                        setError(
                          "Guarda o descarta la edición antes de cambiar el estado del cliente.",
                        );
                      else setArchiveTarget(selected);
                    }}
                  >
                    {archived ? <RotateCcw size={15} /> : <Archive size={15} />}
                    {archived ? "Restaurar" : "Archivar"}
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    disabled={busy}
                    title="Ocultar panel de edición"
                    onClick={closeEditor}
                  >
                    <PanelRightClose size={15} /> Ocultar
                  </button>
                </div>
              </header>
              <div className="customer-editor-scroll">
                <div className="form-grid two">
                  <label>
                    Cliente
                    <input
                      required
                      maxLength={180}
                      value={form.displayName}
                      onChange={(event) =>
                        setForm({ ...form, displayName: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Nombre en Odoo
                    <input readOnly value={selected.odooName} />
                  </label>
                  <label>
                    Teléfono operativo
                    <input
                      maxLength={80}
                      value={form.phone}
                      onChange={(event) =>
                        setForm({ ...form, phone: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Teléfonos Odoo
                    <input
                      readOnly
                      value={
                        [selected.odooPhone, selected.odooMobile]
                          .filter(Boolean)
                          .join(" / ") || "Sin teléfono"
                      }
                    />
                  </label>
                </div>
                <fieldset className="priority-field">
                  <legend>Prioridad</legend>
                  <div className="segmented">
                    {(
                      [
                        ["high", "Alta"],
                        ["medium", "Media"],
                        ["schedule", "Por horario"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className={form.priority === value ? "active" : ""}
                        onClick={() => setForm({ ...form, priority: value })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend>Modalidad</legend>
                  <div className="segmented">
                    <button
                      type="button"
                      className={
                        form.fulfillmentMode === "delivery" ? "active" : ""
                      }
                      onClick={() =>
                        setForm({ ...form, fulfillmentMode: "delivery" })
                      }
                    >
                      Entrega
                    </button>
                    <button
                      type="button"
                      className={
                        form.fulfillmentMode === "pickup" ? "active" : ""
                      }
                      onClick={() =>
                        setForm({ ...form, fulfillmentMode: "pickup" })
                      }
                    >
                      Recoge
                    </button>
                  </div>
                </fieldset>
                <fieldset className="windows-editor">
                  <legend>Ventanas de horario · 24 horas</legend>
                  {form.windows.map((window, index) => (
                    <div className="window-row" key={window.key}>
                      <div
                        className="day-picker"
                        aria-label={`Días de la ventana ${index + 1}`}
                      >
                        {dayLabels.map((label, day) => (
                          <button
                            key={label}
                            type="button"
                            className={
                              window.days.includes(day) ? "active" : ""
                            }
                            aria-pressed={window.days.includes(day)}
                            onClick={() =>
                              setForm({
                                ...form,
                                windows: form.windows.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? {
                                        ...item,
                                        days: item.days.includes(day)
                                          ? item.days.filter(
                                              (value) => value !== day,
                                            )
                                          : [...item.days, day].sort(),
                                      }
                                    : item,
                                ),
                              })
                            }
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <label>
                        Desde
                        <input
                          type="text"
                          required
                          maxLength={5}
                          pattern={clockPattern.source}
                          placeholder="HH:MM"
                          title="Usa horario de 24 horas, por ejemplo 11:00"
                          aria-invalid={!clockPattern.test(window.start)}
                          value={window.start}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              windows: form.windows.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, start: event.target.value }
                                  : item,
                              ),
                            })
                          }
                        />
                      </label>
                      <label>
                        Hasta
                        <input
                          type="text"
                          required
                          maxLength={5}
                          pattern={clockPattern.source}
                          placeholder="HH:MM"
                          title="Usa horario de 24 horas, por ejemplo 13:00"
                          aria-invalid={!clockPattern.test(window.end)}
                          value={window.end}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              windows: form.windows.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, end: event.target.value }
                                  : item,
                              ),
                            })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="danger icon-only window-remove-action"
                        aria-label={`Quitar ventana ${index + 1}`}
                        onClick={() =>
                          setForm({
                            ...form,
                            windows: form.windows.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          })
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="quiet"
                    disabled={form.windows.length >= 32}
                    onClick={() =>
                      setForm({
                        ...form,
                        windows: [
                          ...form.windows,
                          {
                            key: crypto.randomUUID(),
                            days: [0, 1, 2, 3, 4],
                            start: "09:00",
                            end: "13:00",
                          },
                        ],
                      })
                    }
                  >
                    <Plus size={15} /> Añadir ventana
                  </button>
                </fieldset>
                <label>
                  Nota de entrega
                  <textarea
                    rows={3}
                    maxLength={2000}
                    value={form.deliveryNote}
                    onChange={(event) =>
                      setForm({ ...form, deliveryNote: event.target.value })
                    }
                  />
                </label>
                <div className="field-with-help">
                  <label htmlFor={`customer-address-${selected.id}`}>
                    Domicilio de entrega
                  </label>
                  <textarea
                    id={`customer-address-${selected.id}`}
                    aria-describedby={`customer-address-source-${selected.id}`}
                    rows={3}
                    maxLength={600}
                    value={form.deliveryAddress}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        deliveryAddress: event.target.value,
                        location: null,
                        mapUrl: "",
                      })
                    }
                  />
                  <small id={`customer-address-source-${selected.id}`}>
                    Odoo: {selected.odooAddress || "Sin domicilio"}
                  </small>
                </div>
                <CustomerLocationEditor
                  key={selected.id}
                  address={form.deliveryAddress}
                  location={form.location}
                  mapUrl={form.mapUrl}
                  onLocation={(location) =>
                    setForm((current) =>
                      current ? { ...current, location } : current,
                    )
                  }
                  onMapUrl={(mapUrl) =>
                    setForm((current) =>
                      current ? { ...current, mapUrl } : current,
                    )
                  }
                />
              </div>
              <footer className="customer-editor-actions">
                <span>
                  {dirty
                    ? "Cambios sin guardar"
                    : `Guardado · v${selected.version}`}
                </span>
                <button className="primary" disabled={busy || !dirty}>
                  <Save size={16} /> {busy ? "Guardando…" : "Guardar cambios"}
                </button>
              </footer>
            </form>
          )}
        </aside>
      </div>
      {archiveTarget && (
        <CustomerArchiveDialog
          customer={archiveTarget}
          restoring={archived}
          busy={busy}
          onClose={() => setArchiveTarget(null)}
          onConfirm={() => void changeArchive()}
        />
      )}
    </section>
  );
}
