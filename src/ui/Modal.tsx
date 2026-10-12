"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { CloseIcon } from "./Icons";

export function Modal({
  title,
  onClose,
  children,
  footer,
  size,
  className,
  closeLabel = "Close",
  dismissOnBackdrop = true,
  placement = "center",
}: {
  title: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "wide" | "narrow" | "board";
  className?: string;
  closeLabel?: string;
  dismissOnBackdrop?: boolean;
  /** "side": docked to the right on wide screens so the world stays visible. */
  placement?: "center" | "side";
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onClose) onClose();
    };
    window.addEventListener("keydown", onKey);
    // Move focus into the panel for keyboard and screen-reader users.
    const first = ref.current?.querySelector<HTMLElement>("input, textarea, button:not(.close-x)");
    first?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      className={`modal-backdrop ${placement === "side" ? "side" : ""}`}
      onPointerDown={(e) => {
        if (dismissOnBackdrop && e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <div ref={ref} className={`modal paper ${size ?? ""} ${placement === "side" ? "side" : ""} ${className ?? ""}`} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}>
        <div className="modal-head">
          <h2>{title}</h2>
          {onClose && (
            <button className="icon-btn close-x" onClick={onClose} aria-label={closeLabel} title={closeLabel}>
              <CloseIcon />
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
