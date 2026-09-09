"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Route,
  CalendarDays,
  Users,
  History,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  Truck,
  Info,
  Menu,
} from "lucide-react";
import type { User } from "@/core/auth";
import type { Plan } from "@/core/plans";
import { api, navigateAfterAuth } from "./api";
import { DraftName } from "./draft-name";
import { FleetPanel } from "./fleet-panel";
import { OrdersBoard } from "./orders-board";

type Section = "plans" | "vehicles" | "drivers" | "users" | "audit";
const sections = [
  { id: "plans" as const, label: "Planificar rutas", icon: Route },
  { id: "vehicles" as const, label: "Camionetas", icon: Truck },
  { id: "drivers" as const, label: "Choferes", icon: Users },
  { id: "users" as const, label: "Usuarios y accesos", icon: Users },
  { id: "audit" as const, label: "Auditoría", icon: History },
];
type AuditRow = {
  id: string;
  actor: string;
  action: string;
  created_at: string;
  entity_id: string | null;
};
const events: Record<string, string> = {
  "account.bootstrap": "Activó la instalación",
  "account.created": "Creó una cuenta",
  "account.activated": "Activó una cuenta",
  "account.deactivated": "Desactivó una cuenta",
  "session.login": "Inició sesión",
  "session.logout": "Cerró sesión",
  "plan.created": "Creó un borrador",
  "plan.updated": "Modificó un borrador",
  "vehicle.created": "Registró una camioneta",
  "vehicle.updated": "Modificó una camioneta",
  "vehicle.driver.assigned": "Cambió la asignación de chofer",
  "driver.created": "Registró un chofer",
  "driver.updated": "Modificó un chofer",
  "driver.document.saved": "Guardó un documento de chofer",
  "odoo.connection.checked": "Verificó la conexión Odoo",
  "orders.imported": "Cargó surtidos desde Odoo",
  "plan.vehicles.selected": "Seleccionó camionetas del día",
  "shipment.moved": "Movió un pedido en el plan",
};

export function Dashboard({
  user,
  displayName,
  today,
  timezone,
}: {
  user: User;
  displayName: string;
  today: string;
  timezone: string;
}) {
  const [section, setSection] = useState<Section>("plans");
  const [menuClosed, setMenuClosed] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [fleetRevision, setFleetRevision] = useState(0);
  const [boardRevision, setBoardRevision] = useState(0);
  const [plans, setPlans] = useState<Plan[]>([]),
    [users, setUsers] = useState<User[]>([]),
    [audit, setAudit] = useState<AuditRow[]>([]);
  const [selected, setSelected] = useState<Plan | null>(null);
  const adoptPlan = useCallback((plan: Plan) => {
    setSelected(plan);
    setPlans((previous) => previous.map((p) => (p.id === plan.id ? plan : p)));
  }, []);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      if (section === "vehicles" || section === "drivers")
        setFleetRevision((value) => value + 1);
      if (section === "plans") {
        setPlans(await api<Plan[]>("/api/plans"));
        setBoardRevision((value) => value + 1);
      }
      if (section === "users") setUsers(await api<User[]>("/api/users"));
      if (section === "audit") setAudit(await api<AuditRow[]>("/api/audit"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [section]);
  useEffect(() => {
    let current = true;
    const fail = (error: Error) => {
      if (current) setError(error.message);
    };
    const done = () => {
      if (current) setLoading(false);
    };
    const requests: Record<Section, () => Promise<void>> = {
      vehicles: () => Promise.resolve(),
      drivers: () => Promise.resolve(),
      plans: () =>
        api<Plan[]>("/api/plans").then((data) => {
          if (current) setPlans(data);
        }),
      users: () =>
        api<User[]>("/api/users").then((data) => {
          if (current) setUsers(data);
        }),
      audit: () =>
        api<AuditRow[]>("/api/audit").then((data) => {
          if (current) setAudit(data);
        }),
    };
    void requests[section]().catch(fail).finally(done);
    return () => {
      current = false;
    };
  }, [section]);
  async function perform(action: () => Promise<void>) {
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
  function createDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = Object.fromEntries(new FormData(event.currentTarget));
    void perform(async () => {
      const plan = await api<Plan>("/api/plans", "POST", input);
      setSelected(plan);
      setCreateOpen(false);
      await refresh();
      setNotice(
        "Borrador guardado. Si el día ya existía, abrimos ese mismo plan.",
      );
    });
  }
  function saveDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = Object.fromEntries(new FormData(event.currentTarget));
    void perform(async () => {
      if (!selected) return;
      const plan = await api<Plan>(`/api/plans/${selected.id}`, "PATCH", {
        ...input,
        expectedVersion: selected.version,
      });
      setSelected(plan);
      await refresh();
      setNotice("Nombre del borrador actualizado.");
    });
  }
  function addUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = Object.fromEntries(new FormData(form));
    void perform(async () => {
      await api("/api/users", "POST", input);
      form.reset();
      await refresh();
      setNotice("Cuenta creada. Ya puede iniciar sesión en este panel.");
    });
  }
  const title = sections.find((item) => item.id === section)!.label;
  return (
    <div
      className={`app ${menuClosed ? "menu-closed" : ""} ${section === "plans" ? "planner-app" : ""}`}
    >
      <aside className="sidebar" id="app-navigation" hidden={menuClosed}>
        <div className="brand">
          <Route size={30} />
          <div>
            ANA RUTAS<small>BY FIVE</small>
          </div>
        </div>
        <nav className="nav" aria-label="Navegación principal">
          <span className="eyebrow">Operación</span>
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={id === section ? "active" : ""}
              aria-current={id === section ? "page" : undefined}
              onClick={() => {
                setNotice("");
                setSection(id);
              }}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <ShieldCheck size={20} />
          <p style={{ marginTop: 12 }}>Administración de rutas</p>
          <small>
            Acceso y datos propios.
            <br />
            Sin cambios en ventas o precios.
          </small>
        </div>
      </aside>
      <div className="content">
        <header className="topbar">
          <div className="row">
            <button
              className="quiet"
              aria-label={menuClosed ? "Abrir menú" : "Cerrar menú"}
              aria-expanded={!menuClosed}
              aria-controls="app-navigation"
              onClick={() => setMenuClosed((value) => !value)}
            >
              <Menu size={19} />
            </button>
            <span className="small">
              {displayName} <span aria-hidden="true"> / </span> Administración
            </span>
          </div>
          <div className="row">
            <div className="avatar" aria-hidden="true">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <span className="small">{user.name}</span>
            <button
              className="quiet"
              aria-label="Cerrar sesión"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await api("/api/session", "DELETE");
                  navigateAfterAuth("/login");
                })
              }
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <main className={`main ${section === "plans" ? "planner-main" : ""}`}>
          <header className="page-heading">
            <div>
              <span className="eyebrow">
                {section === "plans" ? "Plan de operación" : "Administración"}
              </span>
              <h1>{title}</h1>
              <p>
                {section === "plans"
                  ? "Prepara el día. Conserva cada cambio en un borrador compartido."
                  : section === "vehicles"
                    ? "Registra tus unidades y administra la asignación de choferes."
                    : section === "drivers"
                      ? "Datos de contacto, disponibilidad y documentos privados de tu equipo."
                      : section === "users"
                        ? "Una cuenta por persona. Todos administran únicamente Ana Rutas."
                        : "Actividad registrada con su autor y fecha."}
              </p>
            </div>
            <button
              className="quiet"
              onClick={() => void refresh()}
              disabled={loading || busy}
            >
              <RefreshCw size={16} />
              Actualizar
            </button>
          </header>
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
          {(section === "vehicles" || section === "drivers") && (
            <FleetPanel
              key={section}
              section={section}
              revision={fleetRevision}
            />
          )}
          {section === "plans" && (
            <div className="planner-grid">
              <div className="planner-workspace">
                <section className="panel planner-controls">
                  <div className="planner-select-row">
                    <label>
                      Abrir borrador
                      <select
                        aria-label="Abrir borrador"
                        disabled={busy || loading}
                        value={selected?.id || ""}
                        onChange={(e) =>
                          setSelected(
                            plans.find((p) => p.id === e.target.value) || null,
                          )
                        }
                      >
                        <option value="">Seleccionar día…</option>
                        {plans.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label} · {p.service_date}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="badge planner-timezone">
                      <CalendarDays size={13} />
                      {timezone}
                    </span>
                    <button
                      className="quiet"
                      aria-expanded={createOpen || !plans.length}
                      aria-controls="create-plan-fields"
                      onClick={() => setCreateOpen((v) => !v)}
                      disabled={busy}
                    >
                      <Plus size={16} />
                      Nuevo borrador
                    </button>
                  </div>
                  <div
                    id="create-plan-fields"
                    hidden={!createOpen && !!plans.length}
                  >
                    <div className="panel-body">
                      <form className="form-row" onSubmit={createDraft}>
                        <label className="date">
                          Fecha de operación
                          <input
                            type="date"
                            name="date"
                            defaultValue={today}
                            required
                          />
                        </label>
                        <label>
                          Nombre del plan
                          <input
                            name="label"
                            placeholder="Ej. Entregas del día"
                            maxLength={120}
                            required
                          />
                        </label>
                        <button className="primary" disabled={busy}>
                          <Plus size={17} />
                          Crear borrador
                        </button>
                      </form>
                    </div>
                  </div>
                </section>
                <section className="panel planner-board-panel">
                  {selected ? (
                    <>
                      <DraftName
                        key={`${selected.id}-${selected.version}`}
                        plan={selected}
                        busy={busy}
                        onSubmit={saveDraft}
                      />
                      <OrdersBoard
                        key={selected.id}
                        plan={selected}
                        timezone={timezone}
                        revision={boardRevision}
                        onPlan={adoptPlan}
                        onBusy={setBusy}
                      />
                    </>
                  ) : (
                    <>
                      <div className="panel-header">
                        <h2>Tablero del día</h2>
                        <span className="badge amber">
                          Sin plan seleccionado
                        </span>
                      </div>
                      <div className="empty">
                        <Route size={38} />
                        <h3>Empieza con un borrador</h3>
                        <p>
                          Selecciona la fecha y guarda el plan. También puedes
                          abrir uno de los borradores existentes.
                        </p>
                      </div>
                    </>
                  )}
                  <div className="note-line">
                    <Info size={17} style={{ flexShrink: 0 }} />
                    Los cambios se guardan en el borrador. La optimización y el
                    envío a choferes se incorporarán después.
                  </div>
                </section>
              </div>
            </div>
          )}
          {section === "users" && (
            <div className="grid-two">
              <section className="panel">
                <div className="panel-header">
                  <h2>Administradores</h2>
                  <span className="badge">{users.length} cuentas</span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Nombre / usuario</th>
                        <th>Estado</th>
                        <th>Acceso</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((account) => (
                        <tr key={account.id}>
                          <td>
                            {account.name}
                            <small>
                              {account.login}
                              {account.id === user.id ? " · Tú" : ""}
                            </small>
                          </td>
                          <td>
                            <span
                              className={`badge ${account.active ? "green" : ""}`}
                            >
                              {account.active ? "Activo" : "Inactivo"}
                            </span>
                          </td>
                          <td>
                            <button
                              disabled={busy || account.id === user.id}
                              onClick={() =>
                                void perform(async () => {
                                  await api(
                                    `/api/users/${account.id}`,
                                    "PATCH",
                                    { active: !account.active },
                                  );
                                  await refresh();
                                  setNotice(
                                    account.active
                                      ? "Cuenta desactivada y sesiones revocadas."
                                      : "Cuenta activada.",
                                  );
                                })
                              }
                            >
                              {account.active ? "Desactivar" : "Activar"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="panel">
                <div className="panel-header">
                  <h2>Añadir administrador</h2>
                </div>
                <form className="panel-body stack" onSubmit={addUser}>
                  <label>
                    Nombre completo
                    <input
                      name="name"
                      required
                      minLength={2}
                      maxLength={120}
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    Usuario
                    <input
                      name="login"
                      required
                      minLength={3}
                      maxLength={120}
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    Contraseña
                    <input
                      name="password"
                      type="password"
                      required
                      minLength={6}
                      maxLength={128}
                      autoComplete="new-password"
                    />
                  </label>
                  <p className="security-note">
                    Entre 6 y 128 caracteres. Comparte el acceso por un canal
                    seguro. Esta cuenta no da acceso al bot, vendedores, precios
                    ni Odoo.
                  </p>
                  <button className="primary" disabled={busy}>
                    <Plus size={17} />
                    Crear cuenta
                  </button>
                </form>
              </section>
            </div>
          )}
          {section === "audit" && (
            <section className="panel">
              <div className="panel-header">
                <h2>Últimos eventos</h2>
                <span className="badge">Hasta 100 eventos recientes</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Administrador</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((event) => (
                      <tr key={event.id}>
                        <td>
                          {new Date(event.created_at).toLocaleString("es-MX", {
                            timeZone: timezone,
                          })}
                        </td>
                        <td>{event.actor || "Sistema"}</td>
                        <td>{events[event.action] || event.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <div className="bottom-note">
            <ShieldCheck size={16} />
            Los cambios de este panel pertenecen únicamente a Ana Rutas.
          </div>
        </main>
      </div>
    </div>
  );
}
