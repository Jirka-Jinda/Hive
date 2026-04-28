interface Props {
    onClick: () => void;
}

/**
 * Standardised × close button for modal headers (top-right corner).
 */
export default function XCloseButton({ onClick }: Props) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label="Close"
            className="flex items-center justify-center w-7 h-7 rounded-md text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-all focus:outline-none focus:ring-2 focus:ring-amber-500/40"
        >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
        </button>
    );
}
