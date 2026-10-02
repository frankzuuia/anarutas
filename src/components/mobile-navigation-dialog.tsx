"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { outsideNavigationBounds } from "./navigation-hit-test";
import { navigationFocusTarget } from "./navigation-focus";

export const desktopNavigationQuery = "(min-width: 721px)";

export function MobileNavigationDialog({
  open,
  brand,
  children,
  onClose,
  onRestoreFocus,
}: {
  open: boolean;
  brand: ReactNode;
  children: ReactNode;
  onClose: () => void;
  onRestoreFocus: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const outsidePress = useRef(false);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    if (!element) return;
    const desktop = window.matchMedia(desktopNavigationQuery);
    if (desktop.matches) {
      onClose();
      return;
    }
    const previousOverflow = document.documentElement.style.overflow;
    element.showModal();
    document.documentElement.style.overflow = "hidden";
    const resize = (event: MediaQueryListEvent) => {
      if (event.matches) onClose();
    };
    desktop.addEventListener("change", resize);
    return () => {
      desktop.removeEventListener("change", resize);
      outsidePress.current = false;
      element.close();
      document.documentElement.style.overflow = previousOverflow;
      onRestoreFocus();
    };
  }, [open, onClose, onRestoreFocus]);
  return (
    <dialog
      id="mobile-app-navigation"
      className="mobile-navigation-dialog"
      aria-label="Menú de administración"
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={(event) => {
        if (!event.currentTarget.open) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const target = navigationFocusTarget(
          Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ),
          ),
          document.activeElement,
          event.shiftKey,
        );
        if (target) {
          event.preventDefault();
          target.focus();
        }
      }}
      onPointerDown={(event) => {
        outsidePress.current =
          event.target === event.currentTarget &&
          outsideNavigationBounds(
            { x: event.clientX, y: event.clientY },
            event.currentTarget.getBoundingClientRect(),
          );
      }}
      onPointerUp={(event) => {
        outsidePress.current =
          outsidePress.current &&
          event.target === event.currentTarget &&
          outsideNavigationBounds(
            { x: event.clientX, y: event.clientY },
            event.currentTarget.getBoundingClientRect(),
          );
      }}
      onClick={(event) => {
        // Keep the modal through touch compatibility events, then restore focus.
        const dismiss =
          outsidePress.current && event.target === event.currentTarget;
        outsidePress.current = false;
        if (dismiss) {
          event.preventDefault();
          onClose();
        }
      }}
      onPointerCancel={() => {
        outsidePress.current = false;
      }}
    >
      <header className="mobile-navigation-header">
        {brand}
        <button
          type="button"
          className="quiet"
          aria-label="Cerrar menú"
          onClick={onClose}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <div className="mobile-navigation-scroll">{children}</div>
    </dialog>
  );
}
