import { useEffect, useRef, useCallback } from 'react';

/**
 * Provides:
 *  - Escape key → onClose
 *  - Backdrop click → onClose (returns props to spread on the overlay div)
 *  - Focus trap within the modal container
 *  - Auto-focus first focusable element on mount
 */
export function useModal(onClose: () => void) {
    const overlayRef = useRef<HTMLDivElement>(null);

    // Stable close ref so effects don't re-run when onClose identity changes
    const onCloseRef = useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

    // Escape key
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCloseRef.current();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, []);

    // Focus trap + initial focus
    useEffect(() => {
        const el = overlayRef.current;
        if (!el) return;

        const FOCUSABLE =
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

        const getFocusable = () => Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));

        // Focus first element
        const first = getFocusable()[0];
        first?.focus();

        const handleTab = (e: KeyboardEvent) => {
            if (e.key !== 'Tab') return;
            const focusable = getFocusable();
            if (focusable.length === 0) return;
            const firstEl = focusable[0];
            const lastEl = focusable[focusable.length - 1];

            if (e.shiftKey) {
                if (document.activeElement === firstEl) {
                    e.preventDefault();
                    lastEl.focus();
                }
            } else {
                if (document.activeElement === lastEl) {
                    e.preventDefault();
                    firstEl.focus();
                }
            }
        };

        document.addEventListener('keydown', handleTab);
        return () => document.removeEventListener('keydown', handleTab);
    }, []);

    // Backdrop click handler
    const handleOverlayClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === overlayRef.current) onCloseRef.current();
    }, []);

    return { overlayRef, handleOverlayClick };
}
