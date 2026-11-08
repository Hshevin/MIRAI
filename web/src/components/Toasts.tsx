import { createContext, useContext } from "react";
import { useI18n } from "../i18n";
import { AlertIcon, CheckIcon, CloseIcon, InfoIcon } from "./Icons";

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

const TOAST_ICONS = {
  info: InfoIcon,
  success: CheckIcon,
  error: AlertIcon,
} as const;

export function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="toast-viewport" aria-live="polite">
      {toasts.map((toast) => {
        const ToastIcon = TOAST_ICONS[toast.kind];
        return (
          <div
            key={toast.id}
            className={`toast toast-${toast.kind}`}
            role={toast.kind === "error" ? "alert" : "status"}
          >
            <ToastIcon className="toast-icon" />
            <span className="toast-message">{toast.message}</span>
            <button
              type="button"
              className="icon-btn small"
              aria-label={t("toast.dismiss")}
              onClick={() => onDismiss(toast.id)}
            >
              <CloseIcon size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
