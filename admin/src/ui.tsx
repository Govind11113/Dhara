import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { messageOf } from './lib/api';
import { api } from './lib/appwrite';
import type { PhotoResult } from './lib/types';

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload(): void;
}

/** Runs `load` on mount and whenever `deps` change. Ignores stale answers. */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    load()
      .then((d) => {
        if (current) setData(d);
      })
      .catch((e: unknown) => {
        if (current) setError(messageOf(e));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
    // `load` is recreated every render; the caller's deps decide when to rerun.
  }, [...deps, tick]);

  return { data, error, loading, reload: useCallback(() => setTick((t) => t + 1), []) };
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

interface Toast {
  id: number;
  text: string;
  bad: boolean;
}

const ToastContext = createContext<(text: string, bad?: boolean) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);

  const push = useCallback((text: string, bad = false) => {
    const id = ++next.current;
    setToasts((t) => [...t, { id, text, bad }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), bad ? 7000 : 4000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      {/* Announced to screen readers without stealing focus. */}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.bad ? ' toast-bad' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="spinner-row" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn btn-small" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {hint && <p className="muted">{hint}</p>}
    </div>
  );
}

type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral';

const TONES: Record<string, Tone> = {
  alive: 'good', approved: 'good', fulfilled: 'good', answered: 'good', approve: 'good', ok: 'good', resolved: 'good',
  pending_review: 'warn', manual_review: 'warn', pending: 'warn', open: 'warn', review: 'warn', processing: 'info', triaged: 'info',
  rejected: 'bad', dead: 'bad', failed: 'bad', reject: 'bad', unavailable: 'bad', cancelled: 'neutral', closed: 'neutral',
  critical: 'bad', high: 'bad', medium: 'warn', low: 'neutral', at_risk: 'warn', missed: 'warn', skipped: 'neutral',
};

export function Pill({ value, tone }: { value: string; tone?: Tone }) {
  const t = tone ?? TONES[value] ?? 'neutral';
  return <span className={`pill pill-${t}`}>{value.replace(/_/g, ' ')}</span>;
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      <div className="page-actions">{children}</div>
    </header>
  );
}

export function Pager({
  offset,
  limit,
  total,
  onChange,
}: {
  offset: number;
  limit: number;
  total: number;
  onChange(offset: number): void;
}) {
  if (total <= limit) return null;
  const from = offset + 1;
  const to = Math.min(total, offset + limit);
  return (
    <nav className="pager" aria-label="Pagination">
      <button type="button" className="btn btn-small" disabled={offset <= 0} onClick={() => onChange(Math.max(0, offset - limit))}>
        Previous
      </button>
      <span className="muted">
        {from}–{to} of {total}
      </span>
      <button type="button" className="btn btn-small" disabled={to >= total} onClick={() => onChange(offset + limit)}>
        Next
      </button>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Dialog asking for a reason (used for anything a person will read)
// ---------------------------------------------------------------------------

export function ReasonDialog({
  open,
  title,
  description,
  label = 'Reason',
  confirmLabel,
  danger = false,
  required = true,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  label?: string;
  confirmLabel: string;
  danger?: boolean;
  required?: boolean;
  onConfirm(reason: string): void | Promise<void>;
  onCancel(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const id = useId();

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      setText('');
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  const ready = !required || text.trim().length >= 3;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    try {
      await onConfirm(text.trim());
    } finally {
      setBusy(false);
    }
  }

  return (
    // The native <dialog> gives focus trapping and Escape for free.
    <dialog ref={ref} className="dialog" aria-labelledby={`${id}-t`} onCancel={onCancel} onClose={() => open && onCancel()}>
      <form onSubmit={submit}>
        <h2 id={`${id}-t`}>{title}</h2>
        {description && <div className="dialog-body">{description}</div>}
        <label htmlFor={`${id}-r`}>{label}</label>
        <textarea
          id={`${id}-r`}
          rows={3}
          value={text}
          maxLength={200}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={!ready || busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Private photos
// ---------------------------------------------------------------------------

const photoCache = new Map<string, Promise<PhotoResult>>();

function fetchPhoto(bucketId: string, fileId: string): Promise<PhotoResult> {
  const key = `${bucketId}/${fileId}`;
  let hit = photoCache.get(key);
  if (!hit) {
    hit = api.call<PhotoResult>('/admin/photo', { bucketId, fileId });
    // Do not cache a failure: the next look should try again.
    hit.catch(() => photoCache.delete(key));
    photoCache.set(key, hit);
  }
  return hit;
}

/** Buckets are private to each user, so photos are fetched through the API. */
export function Photo({
  bucketId = 'tree_photos',
  fileId,
  alt,
  className,
}: {
  bucketId?: string;
  fileId?: string;
  alt: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setSrc(null);
    setError(null);
    if (!fileId) return;
    fetchPhoto(bucketId, fileId)
      .then((p) => current && setSrc(p.dataUrl))
      .catch((e: unknown) => current && setError(messageOf(e)));
    return () => {
      current = false;
    };
  }, [bucketId, fileId]);

  if (!fileId) return <div className={`photo photo-empty ${className ?? ''}`}>No photo</div>;
  if (error) return <div className={`photo photo-empty ${className ?? ''}`} role="alert">{error}</div>;
  if (!src) return <div className={`photo photo-empty ${className ?? ''}`}>Loading photo…</div>;
  return <img className={`photo ${className ?? ''}`} src={src} alt={alt} />;
}

/** A link-styled button that shows a photo in a dialog. */
export function PhotoButton({ bucketId, fileId, label }: { bucketId?: string; fileId?: string; label: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [shown, setShown] = useState(false);
  if (!fileId) return <span className="muted">—</span>;
  return (
    <>
      <button
        type="button"
        className="link"
        onClick={() => {
          setShown(true);
          ref.current?.showModal();
        }}
      >
        View
      </button>
      <dialog ref={ref} className="dialog dialog-wide" aria-label={label} onClose={() => setShown(false)}>
        {shown && <Photo bucketId={bucketId} fileId={fileId} alt={label} className="photo-large" />}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => ref.current?.close()}>
            Close
          </button>
        </div>
      </dialog>
    </>
  );
}
