interface ToggleProps {
    checked: boolean;
    onChange: () => void;
    disabled?: boolean;
    title?: string;
}

/**
 * Shared accessible toggle switch — amber accent, consistent across all modals.
 */
export default function Toggle({ checked, onChange, disabled, title }: ToggleProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={onChange}
            disabled={disabled}
            title={title}
            className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/40 disabled:opacity-40 ${
                checked ? 'bg-amber-500 border-amber-400' : 'bg-gray-700 border-gray-600'
            }`}
        >
            <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                    checked ? 'translate-x-4' : 'translate-x-0.5'
                }`}
            />
        </button>
    );
}
