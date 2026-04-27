import { useCallback, useEffect, useRef, useState } from 'react';

export function useDragResize(initial: number, min: number, max: number, side: 'right' | 'left' = 'right') {
    const [width, setWidth] = useState(initial);
    const dragging = useRef(false);
    const startX = useRef(0);
    const startW = useRef(0);

    const onMouseDown = useCallback((e: React.MouseEvent) => {
        dragging.current = true;
        startX.current = e.clientX;
        startW.current = width;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    }, [width]);

    useEffect(() => {
        const move = (e: MouseEvent) => {
            if (!dragging.current) return;
            const delta = side === 'right' ? e.clientX - startX.current : startX.current - e.clientX;
            setWidth(Math.max(min, Math.min(max, startW.current + delta)));
        };
        const up = () => {
            if (!dragging.current) return;
            dragging.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
        return () => {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
        };
    }, [min, max, side]);

    return { width, onMouseDown };
}