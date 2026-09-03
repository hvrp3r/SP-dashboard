import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as notificationsApi from '../api/notifications.js';
import type { AppNotification } from '../types.js';

const POLL_INTERVAL_MS = 10000;
const WIGGLE_DURATION_MS = 500;

export default function NotificationBell() {
  const [count, setCount] = useState(0);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [wiggling, setWiggling] = useState(false);
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);
  const wiggleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sonde à la fois le badge et la liste : la liste doit rester fraîche même quand
  // le panneau reste ouvert, pas juste au moment où on l'ouvre.
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const [{ count }, list] = await Promise.all([
          notificationsApi.getUnreadCount(),
          notificationsApi.listNotifications(),
        ]);
        if (cancelled) return;
        if (count > prevCountRef.current) {
          setWiggling(true);
          if (wiggleTimeoutRef.current) clearTimeout(wiggleTimeoutRef.current);
          wiggleTimeoutRef.current = setTimeout(() => setWiggling(false), WIGGLE_DURATION_MS);
        }
        prevCountRef.current = count;
        setCount(count);
        setNotifications(list);
      } catch {
        // Silencieux : le badge et la liste gardent leurs dernières valeurs connues.
      }
    }
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (wiggleTimeoutRef.current) clearTimeout(wiggleTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleToggle() {
    setOpen((v) => !v);
  }

  function handleNotificationClick(n: AppNotification) {
    setOpen(false);
    if (!n.read_at) {
      setCount((c) => Math.max(0, c - 1));
      setNotifications((prev) =>
        prev.map((item) =>
          item.id === n.id ? { ...item, read_at: new Date().toISOString() } : item
        )
      );
      notificationsApi.markRead(n.id).catch(() => {});
    }
    if (n.link) navigate(n.link);
  }

  async function handleMarkAllRead() {
    setCount(0);
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() }))
    );
    try {
      await notificationsApi.markAllRead();
    } catch {
      // Best effort : au pire, ça se resynchronise au prochain poll.
    }
  }

  return (
    <div className="relative flex-shrink-0" ref={containerRef}>
      <button
        onClick={handleToggle}
        className="relative p-2 rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-all duration-200 hover:scale-110 active:scale-95"
        aria-label="Notifications"
      >
        <span
          className="inline-block"
          style={wiggling ? { animation: `wiggle ${WIGGLE_DURATION_MS}ms ease-in-out` } : undefined}
        >
          🔔
        </span>
        {count > 0 && (
          <span
            key={count > 9 ? '9+' : count}
            className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center"
            style={{ animation: 'popIn 0.3s ease-out, softPulse 2s ease-in-out 0.3s infinite' }}
          >
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-80 max-w-[90vw] bg-zinc-900 border border-zinc-800 rounded-xl shadow-lg shadow-black/30 z-50 overflow-hidden origin-top-right"
          style={{ animation: 'fadeSlideIn 0.18s ease-out' }}
        >
          <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
            <span className="text-sm font-semibold text-zinc-200">Notifications</span>
            {notifications.some((n) => !n.read_at) && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-emerald-400 font-medium hover:underline transition-transform hover:scale-105 active:scale-95"
              >
                Tout marquer lu
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="p-4 text-sm text-zinc-500 text-center">Aucune notification.</p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleNotificationClick(n)}
                  className={`block w-full text-left px-4 py-3 text-sm border-b border-zinc-800 last:border-0 hover:bg-zinc-800/60 hover:pl-5 transition-all duration-150 ${
                    n.read_at ? 'text-zinc-500' : 'text-zinc-100'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {!n.read_at && (
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0 animate-pulse" />
                    )}
                    <span>{n.message}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
