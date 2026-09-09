"use client";
import { useState } from "react";
import { ArrowRight, Route, ShieldCheck } from "lucide-react";
import { api, navigateAfterAuth } from "./api";
export function AuthForm({ setup = false }: { setup?: boolean }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const input = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api(setup ? "/api/setup" : "/api/session", "POST", input);
      if (setup) {
        setDone(true);
      } else {
        navigateAfterAuth("/");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-screen">
      <section className="auth-story">
        <div className="brand">
          <Route size={32} />
          <div>
            ANA RUTAS<small>BY FIVE</small>
          </div>
        </div>
        <article>
          <span className="eyebrow">Tu operación, en un solo lugar</span>
          <h1>
            Todo listo.
            <br />
            Antes de salir.
          </h1>
          <p className="lead">
            Un espacio propio para organizar el día y trabajar juntos en la
            planificación.
          </p>
        </article>
        <footer>
          <ShieldCheck size={18} />
          Acceso privado · Administración de rutas
        </footer>
      </section>
      <main className="auth-box">
        <div className="auth-form">
          <span className="eyebrow">
            {setup ? "Activar instalación" : "Bienvenido"}
          </span>
          <h2>{setup ? "Tu primera cuenta" : "Inicia sesión"}</h2>
          <p className="muted">
            {setup
              ? "Configura al primer administrador de este panel."
              : "Entra con tu cuenta de administrador de rutas."}
          </p>
          {done ? (
            <div className="notice" role="status">
              Cuenta creada. <a href="/login">Iniciar sesión →</a>
            </div>
          ) : (
            <form onSubmit={submit}>
              {setup && (
                <>
                  <label>
                    Clave de instalación
                    <input
                      name="token"
                      type="password"
                      autoComplete="off"
                      required
                      minLength={32}
                    />
                  </label>
                  <label>
                    Nombre completo
                    <input
                      name="name"
                      autoComplete="name"
                      required
                      minLength={2}
                      maxLength={120}
                    />
                  </label>
                </>
              )}
              <label>
                Usuario
                <input
                  name="login"
                  autoComplete="username"
                  required
                  minLength={3}
                  maxLength={120}
                />
              </label>
              <label>
                Contraseña
                <input
                  name="password"
                  type="password"
                  autoComplete={setup ? "new-password" : "current-password"}
                  required
                  minLength={setup ? 6 : 1}
                  maxLength={128}
                />
              </label>
              {setup && (
                <small>
                  Mínimo 6 caracteres. La clave de instalación se configura en
                  el EasyPanel de este servicio.
                </small>
              )}
              {error && (
                <div className="notice error" role="alert">
                  {error}
                </div>
              )}
              <button className="primary" disabled={busy}>
                {busy
                  ? "Un momento…"
                  : setup
                    ? "Crear administrador"
                    : "Entrar al panel"}
                <ArrowRight size={18} />
              </button>
            </form>
          )}
          <a className="secondary-link" href={setup ? "/login" : "/setup"}>
            {setup
              ? "Volver al acceso"
              : "¿Es la primera instalación? Activar panel"}
          </a>
        </div>
      </main>
    </div>
  );
}
