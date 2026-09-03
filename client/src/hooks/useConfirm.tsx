import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmInput = ConfirmOptions | string;

interface ConfirmContextValue {
  confirm: (options: ConfirmInput) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((input: ConfirmInput) => {
    const normalized = typeof input === 'string' ? { message: input } : input;
    setOptions(normalized);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const close = useCallback((result: boolean) => {
    setOptions(null);
    resolverRef.current?.(result);
    resolverRef.current = null;
  }, []);

  useEffect(() => {
    if (!options) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [options, close]);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {options && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60"
          style={{ animation: 'fadeIn 0.15s ease-out' }}
          onClick={() => close(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl shadow-black/40 p-6"
            style={{ animation: 'fadeSlideIn 0.18s ease-out' }}
            onClick={(e) => e.stopPropagation()}
          >
            {options.title && (
              <h2 className="text-lg font-bold text-zinc-50 mb-2">{options.title}</h2>
            )}
            <p className="text-sm text-zinc-300 whitespace-pre-line mb-6">{options.message}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => close(false)}
                className="px-4 py-2 rounded-md text-sm font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-all duration-150 hover:scale-105 active:scale-95"
              >
                {options.cancelLabel ?? 'Annuler'}
              </button>
              <button
                onClick={() => close(true)}
                autoFocus
                className={`px-4 py-2 rounded-md text-sm font-semibold transition-all duration-150 hover:scale-105 active:scale-95 ${
                  options.danger
                    ? 'bg-red-500 hover:bg-red-400 text-zinc-950'
                    : 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950'
                }`}
              >
                {options.confirmLabel ?? 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): (options: ConfirmInput) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm doit être utilisé dans un ConfirmProvider');
  return ctx.confirm;
}
