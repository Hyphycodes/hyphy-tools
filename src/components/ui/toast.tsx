'use client';
import Link from 'next/link';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './icon';

type Toast = {
  id: number;
  title: string;
  description?: string;
  icon?: IconName;
  href?: string;
  action?: string;
};

const ToastContext = createContext<(toast: Omit<Toast, 'id'>) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);
  const push = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = next.current++;
    setToasts((current) => [...current.slice(-2), { ...toast, id }]);
    setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4200);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="toast-stack pointer-events-none fixed inset-x-0 bottom-[calc(84px+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 lg:inset-x-auto lg:right-6 lg:bottom-6 lg:items-end"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex w-full max-w-[400px] animate-rise items-center gap-3 rounded-[14px] bg-night py-2.5 pr-3 pl-2.5 text-white shadow-pop"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-white/10 text-[#9dffcf]">
              <Icon name={toast.icon ?? 'check'} size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium">{toast.title}</p>
              {toast.description && (
                <p className="truncate text-[12.5px] text-white/60">{toast.description}</p>
              )}
            </div>
            {toast.href && (
              <Link
                href={toast.href}
                className="rounded-md px-2 py-1 text-[13px] font-medium text-[#b9bdff] hover:text-white"
              >
                {toast.action ?? 'View'}
              </Link>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
