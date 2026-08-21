import { createContext, useContext } from "react";

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface ToastApi {
  notify: (kind: ToastKind, message: string) => void;
}

const noopToastApi: ToastApi = {
  notify: () => undefined,
};

export const ToastContext = createContext<ToastApi>(noopToastApi);

export function useToasts(): ToastApi {
  return useContext(ToastContext);
}

const TOAST_ICONS: Record<ToastKind, string> = {
  info: "ℹ",
  success: "✓",
  error: "✕",
};

export function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="toast-viewport" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.kind}`}
          role={toast.kind === "error" ? "alert" : "status"}
        >
          <span className="toast-icon" aria-hidden="true">
            {TOAST_ICONS[toast.kind]}
          </span>
          <span className="toast-message">{toast.message}</span>
          <button
            type="button"
            className="toast-close"
            aria-label="Dismiss notification"
            onClick={() => onDismiss(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
