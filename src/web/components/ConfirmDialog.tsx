import { useState } from 'react';
import { Modal } from './Modal';
import { SpinnerIcon } from './icons';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}

/** The only confirmation in the app — reserved for destructive actions. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onCancel}
      title={title}
      size="max-w-md"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={() => void confirm()}
            disabled={busy}
          >
            {busy && <SpinnerIcon className="h-4 w-4" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{message}</p>
    </Modal>
  );
}
