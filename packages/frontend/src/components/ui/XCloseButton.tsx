import { useEffect, useRef } from 'react';

interface Props {
    onClick: () => void;
}

export default function XCloseButton({ onClick }: Props) {
    const onClickRef = useRef(onClick);
    useEffect(() => { onClickRef.current = onClick; });

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !e.defaultPrevented) {
                e.preventDefault();
                onClickRef.current();
            }
        };
        window.addEventListener('keydown', handler, true);
        return () => window.removeEventListener('keydown', handler, true);
    }, []);

    return (
        <button
            onClick={onClick}
            title="Close (Esc)"
            className="inline-flex items-center justify-center w-6 h-6 rounded border bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-200 hover:bg-gray-750 hover:border-gray-600 transition-all"
        >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
        </button>
    );
}
