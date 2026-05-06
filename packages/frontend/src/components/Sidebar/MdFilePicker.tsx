import type { MdFile } from '../../api/client';

const typeIcon: Record<MdFile['type'], string> = {
    documentation: '📖',
    skill: '🧠',
    tool: '🔧',
    instruction: '📋',
    prompt: '📝',
    other: '📄',
};

interface Props {
    files: MdFile[];
    selected: number[];
    onChange: (ids: number[]) => void;
    label?: string;
}

export default function MdFilePicker({ files, selected, onChange, label = 'Context files' }: Props) {
    const visibleFiles = files.filter((f) => f.type !== 'prompt');
    if (visibleFiles.length === 0) return null;

    const toggle = (id: number) =>
        onChange(
            selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]
        );

    return (
        <div>
            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1">
                {label}
            </div>
            <div className="space-y-0.5 max-h-36 overflow-y-auto rounded-md border border-gray-700/60 bg-gray-900 p-1">
                {visibleFiles.map((f) => {
                    const name = f.path.split(/[/\\]/).pop() ?? f.path;
                    const checked = selected.includes(f.id);
                    return (
                        <label
                            key={f.id}
                            className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs transition-all select-none ${checked
                                ? 'bg-orange-600/20 text-orange-300'
                                : 'text-gray-400 hover:bg-gray-800'
                                }`}
                        >
                            <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggle(f.id)}
                                className="w-3 h-3 rounded accent-orange-500 shrink-0"
                            />
                            <span className="opacity-60 shrink-0">{typeIcon[f.type]}</span>
                            <span className="truncate">{name}</span>
                            {f.scope === 'repo' && (
                                <span className="ml-auto shrink-0 text-[9px] font-bold text-gray-600 uppercase tracking-wider">
                                    repo
                                </span>
                            )}
                            {f.scope === 'session' && (
                                <span className="ml-auto shrink-0 text-[9px] font-bold text-gray-600 uppercase tracking-wider">
                                    session
                                </span>
                            )}
                        </label>
                    );
                })}
            </div>
        </div>
    );
}
