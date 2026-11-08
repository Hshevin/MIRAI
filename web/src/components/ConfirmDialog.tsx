import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

interface Props {
  open: boolean; title: string; children: ReactNode;
  cancelLabel: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void;
}

export function ConfirmDialog({ open, title, children, cancelLabel, confirmLabel, onCancel, onConfirm }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (open && element && !element.open) {
      element.showModal();
      cancel.current?.focus();
    } else if (!open) element?.close();
  }, [open]);
  return (
    <dialog ref={dialog} className="confirm-dialog" aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onCancel(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onCancel();
      }}>
      <h2 id={titleId}>{title}</h2>
      {children}
      <div className="dialog-actions">
        <button ref={cancel} type="button" className="btn subtle" onClick={onCancel}>{cancelLabel}</button>
        <button type="button" className="btn danger" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </dialog>
  );
}
