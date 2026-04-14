import { useEffect } from 'react';
import { useAppStore } from '../../store/appStore';

const TOAST_DURATION_MS = 5_000;

export function ToastContainer(): JSX.Element | null {
    const notifications = useAppStore((s) => s.notifications);
    const dismissNotification = useAppStore((s) => s.dismissNotification);
    const setSelectedSession = useAppStore((s) => s.setSelectedSession);
    const setActiveView = useAppStore((s) => s.setActiveView);
    const sessions = useAppStore((s) => s.sessions);

    // Auto-dismiss each toast after TOAST_DURATION_MS
    useEffect(() => {
        if (notifications.length === 0) return;
        const timers = notifications.map((n) =>
            setTimeout(() => dismissNotification(n.id), TOAST_DURATION_MS),
        );
        return () => timers.forEach(clearTimeout);
    }, [notifications, dismissNotification]);

    if (notifications.length === 0) return null;

    return (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end pointer-events-none">
            {notifications.map((n) => (
                <div
                    key={n.id}
                    className="flex items-center gap-3 bg-gray-900 border border-gray-700/60 rounded-xl shadow-2xl px-4 py-3 min-w-[240px] pointer-events-auto cursor-pointer"
                    role="alert"
                    onClick={() => {
                        const session = sessions.find((s) => s.id === n.sessionId);
                        if (session) {
                            setSelectedSession(session);
                            setActiveView('terminal');
                        }
                        dismissNotification(n.id);
                    }}
                >
                    <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                    <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-xs font-semibold text-white truncate">{n.sessionName}</span>
                        <span className="text-xs text-gray-400">Agent is idle — ready for input</span>
                    </div>
                    <button
                        className="text-gray-500 hover:text-gray-300 shrink-0 ml-1"
                        onClick={(e) => {
                            e.stopPropagation();
                            dismissNotification(n.id);
                        }}
                        aria-label="Dismiss"
                    >
                        ✕
                    </button>
                </div>
            ))}
        </div>
    );
}
