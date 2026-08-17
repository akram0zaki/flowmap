/**
 * A confirm step for destructive actions. The action name is the same word on
 * the button that opened this and the button that finishes it.
 */

import { useEffect, useId, useRef } from 'react';

import { t } from '../i18n/t.js';

export type ConfirmDialogProps = {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly danger?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
};

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div className="fm-modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="fm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onCancel();
          }
        }}
      >
        <h2 id={titleId}>{title}</h2>
        <p id={bodyId}>{body}</p>
        <div className="fm-dialog__actions">
          <button ref={cancelRef} type="button" onClick={onCancel}>
            {t('action.cancel')}
          </button>
          <button type="button" className={danger ? 'fm-danger' : 'fm-primary'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
