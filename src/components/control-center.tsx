"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Plus, Maximize2, Minimize2, X, ArrowLeft, ArrowRight, PanelsTopLeft, MapPinned, Radio, ChartNoAxesCombined, CircleAlert, RefreshCw } from "lucide-react";
import { controlScreenTypes, type ControlScreenType, type EmbeddedSection } from "@/core/control-screens";
import { maxControlScreens, type ControlScreen } from "@/core/live-tracking-contract";
import { api } from "./api";
import { useLiveRoutes } from "./use-live-routes";
import { LiveRouteView } from "./live-route-view";
import { LiveIncidentsPanel } from "./live-incidents-panel";

type Layout = { screens: ControlScreen[] | null; version: number };
export function ExpandableScreen({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  const root = useRef<HTMLElement>(null);
  const expand = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let wasExpanded = false;
    const changed = () => { const active = document.fullscreenElement === root.current; setExpanded(active); if (wasExpanded && !active) expand.current?.focus(); wasExpanded = active; };
    document.addEventListener("fullscreenchange", changed); return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  async function toggle() {
    try { if (document.fullscreenElement === root.current) await document.exitFullscreen(); else await root.current?.requestFullscreen(); setError(""); }
    catch { setError("El navegador no permitió pantalla completa. Habilita esa función e inténtalo de nuevo."); }
  }
  return <article ref={root} className="control-screen" aria-label={title}>
    <header className="control-screen-header"><button className="control-screen-title" onClick={() => void toggle()} title={`Expandir ${title}`}><PanelsTopLeft size={17} /><strong>{title}</strong></button>
      <div className="row">{actions}<button ref={expand} className="quiet" aria-label={expanded ? `Reducir ${title}` : `Expandir ${title}`} onClick={() => void toggle()}>{expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button></div></header>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="control-screen-body">{children}</div>
  </article>;
}
export function ControlCenter({ revision, onRefresh, refreshDisabled, renderSection }: {
  revision: number;
  onRefresh: () => void;
  refreshDisabled: boolean;
  renderSection: (section: EmbeddedSection) => ReactNode;
}) {
  const [screens, setScreens] = useState<ControlScreen[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedVersion, setSavedVersion] = useState(0);
  const [reload, setReload] = useState(0);
  const [adding, setAdding] = useState(false);
  const [choice, setChoice] = useState<ControlScreenType>("routes");
  const version = useRef(0), working = useRef(false), pending = useRef<ControlScreen[] | null>(null);
  const mounted = useRef(true);
  const dialog = useRef<HTMLDialogElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const feed = useLiveRoutes(revision, screens?.some(s => s.type === "routes" || s.type === "progress") ?? false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true; const controller = new AbortController();
    void api<Layout>("/api/control-center", "GET", undefined, controller.signal).then(layout => {
      if (!active) return;
      version.current = layout.version; setSavedVersion(layout.version); pending.current = null; setSaveError(""); setLoadError("");
      setScreens(layout.screens ?? ["routes", "incidents"].map(type => ({ id: crypto.randomUUID(), type: type as ControlScreenType, driverId: "", vehicleId: "" })));
    }).catch((e: Error) => { if (active) setLoadError(e.message); });
    return () => { active = false; controller.abort(); };
  }, [reload]);
  useEffect(() => {
    if (adding) dialog.current?.showModal();
  }, [adding]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (pending.current || working.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload); return () => window.removeEventListener("beforeunload", unload);
  }, []);
  async function drain() {
    if (working.current || !pending.current) return;
    working.current = true; setSaving(true); setSaveError("");
    try {
      while (pending.current) {
        const candidate: ControlScreen[] = pending.current;
        const saved = await api<Layout>("/api/control-center", "PUT", { expectedVersion: version.current, screens: candidate });
        version.current = saved.version;
        if (mounted.current) setSavedVersion(saved.version);
        if (pending.current === candidate) pending.current = null;
      }
    } catch (e) { if (mounted.current) setSaveError(`${(e as Error).message} Tu distribución local se conserva; no se ha confirmado el guardado.`); }
    finally { working.current = false; if (mounted.current) setSaving(false); }
  }
  function change(next: ControlScreen[]) { setScreens(next); pending.current = next; if (!saveError) void drain(); }
  function closePicker() { setAdding(false); addButton.current?.focus(); }
  function move(index: number, direction: number) { if (!screens) return; const next = [...screens]; [next[index], next[index+direction]] = [next[index+direction], next[index]]; change(next); }
  return <section className="control-center">
    <header className="control-command">
      <div className="control-heading-line">
        <h1>Centro de control</h1>
        <details className="control-help">
          <summary aria-label="Información del Centro de control" title="Cómo usar el Centro de control"><CircleAlert size={17} /></summary>
          <div className="control-help-popover" role="note">
            <strong>Tu operación, en una vista</strong>
            <p>Combina pantallas y dedica cada mapa a un chofer distinto. Cada pantalla conserva sus propios filtros y puede ampliarse.</p>
          </div>
        </details>
      </div>
      <div className="control-command-actions">
        <span role="status" className={`badge ${saveError ? "amber" : "green"}`}>{saving ? "Guardando distribución…" : saveError ? "Cambios sin guardar" : savedVersion ? "Distribución guardada" : "Distribución inicial"}</span>
        <button ref={addButton} onClick={() => setAdding(true)} disabled={!screens || screens.length >= maxControlScreens}><Plus size={16} />Agregar pantalla</button>
        <button className="quiet" onClick={onRefresh} disabled={refreshDisabled}><RefreshCw size={16} />Actualizar</button>
      </div>
    </header>
    {loadError && <p className="notice error" role="alert">{loadError}<button className="quiet" onClick={() => setReload(n => n+1)}>Reintentar</button></p>}
    {saveError && <div className="notice error" role="alert"><p>{saveError}</p><button className="quiet" disabled={saving} onClick={() => void drain()}>Reintentar guardado</button>
      <button className="quiet" disabled={saving} onClick={() => setReload(n => n+1)}>Descartar cambios y cargar distribución guardada</button></div>}
    {!screens && !loadError && <p role="status">Cargando tu centro de control…</p>}
    {screens?.length === 0 && <div className="live-empty"><PanelsTopLeft size={36} /><h2>Diseña tu centro de control</h2><p>Agrega la primera pantalla para comenzar.</p><button onClick={() => setAdding(true)}><Plus size={16} />Agregar pantalla</button></div>}
    <div className={`control-grid ${screens?.length === 1 ? "single" : ""} ${(screens?.length ?? 0) > 2 ? "many" : ""}`}>
      {screens?.map((screen,index) => {
        const name = controlScreenTypes.find(t => t.id === screen.type)!.label;
        const driver = feed.report?.routes.find(r => r.driverId === screen.driverId)?.driver;
        const title = `${index+1} · ${name}${driver ? ` · ${driver}` : ""}`;
        return <ExpandableScreen key={screen.id} title={title} actions={<>
          <button className="quiet" disabled={index === 0} aria-label={`Mover pantalla ${index+1} antes`} onClick={() => move(index,-1)}><ArrowLeft size={15} /></button>
          <button className="quiet" disabled={index === screens.length-1} aria-label={`Mover pantalla ${index+1} después`} onClick={() => move(index,1)}><ArrowRight size={15} /></button>
          <button className="quiet" aria-label={`Quitar pantalla ${index+1}`} onClick={() => change(screens.filter(s => s.id !== screen.id))}><X size={16} /></button>
        </>}>
          {screen.type === "routes" || screen.type === "progress" ? <LiveRouteView feed={feed} filter={screen} progressOnly={screen.type === "progress"}
            onFilter={filter => change(screens.map(s => s.id === screen.id ? { ...s, ...filter } : s))} />
            : screen.type === "incidents" ? <LiveIncidentsPanel compact revision={revision}
              selectedDriverId={screen.driverId} onDriverChange={driverId => change(screens.map(s => s.id === screen.id ? { ...s, driverId } : s))} />
            : renderSection(screen.type.slice(6) as EmbeddedSection)}
        </ExpandableScreen>;
      })}
    </div>
    {adding && <dialog ref={dialog} className="control-add-dialog" aria-label="Agregar pantalla al centro de control" onCancel={event => { event.preventDefault(); closePicker(); }}>
      <header><div><span className="eyebrow">PERSONALIZAR CENTRO DE CONTROL</span><h2>¿Qué quieres ver?</h2></div><button className="quiet" aria-label="Cerrar selector de pantallas" onClick={closePicker}><X size={20} /></button></header>
      <p>Puedes repetir una pantalla y elegir un chofer diferente en cada una. Los paneles administrativos mantienen sus acciones reales.</p>
      <div className="control-screen-choices" role="radiogroup" aria-label="Tipo de pantalla">{controlScreenTypes.map(type => {
        const Icon = type.id === "routes" ? MapPinned : type.id === "incidents" ? Radio : type.id === "progress" ? ChartNoAxesCombined : PanelsTopLeft;
        return <label key={type.id} className={choice === type.id ? "chosen" : ""}><input type="radio" name="screen-type" value={type.id} checked={choice === type.id} onChange={() => setChoice(type.id)} />
          <Icon size={23} /><span><strong>{type.label}</strong><small>{type.description}</small></span></label>;
      })}</div>
      <footer><span className="small">{screens?.length ?? 0}/{maxControlScreens} pantallas</span><button className="quiet" onClick={closePicker}>Cancelar</button>
        <button onClick={() => { change([...(screens ?? []), { id: crypto.randomUUID(), type: choice, driverId: "", vehicleId: "" }]); closePicker(); }}><Plus size={17} />Agregar pantalla</button></footer>
    </dialog>}
  </section>;
}
