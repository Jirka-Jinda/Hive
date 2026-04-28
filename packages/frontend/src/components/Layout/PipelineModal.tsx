import { useEffect, useState } from 'react';
import { api, type PipelineNodeDto, type PipelinePhase } from '../../api/client';
import { useModal } from '../../hooks/useModal';
import Toggle from '../ui/Toggle';
import XCloseButton from '../ui/XCloseButton';

interface Props {
    onClose: () => void;
    onNodesChanged?: (nodes: PipelineNodeDto[]) => void;
}

const PHASE_LABELS: Record<PipelinePhase, string> = {
    'session-start': 'Session Start',
    'user-input': 'User Input',
    'agent-output': 'Agent Output',
};

const PHASE_COLORS: Record<PipelinePhase, string> = {
    'session-start': 'bg-violet-900/60 text-violet-300 border-violet-700/60',
    'user-input': 'bg-sky-900/60 text-sky-300 border-sky-700/60',
    'agent-output': 'bg-emerald-900/60 text-emerald-300 border-emerald-700/60',
};

export default function PipelineModal({ onClose, onNodesChanged }: Props) {
    const [nodes, setNodes] = useState<PipelineNodeDto[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [toggling, setToggling] = useState<string | null>(null);
    const { overlayRef, handleOverlayClick } = useModal(onClose);

    useEffect(() => {
        api.pipeline.list()
            .then(setNodes)
            .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load pipeline'))
            .finally(() => setLoading(false));
    }, []);

    const handleToggle = async (node: PipelineNodeDto) => {
        if (toggling) return;
        setToggling(node.id);
        try {
            const updated = await api.pipeline.setEnabled(node.id, !node.enabled);
            setNodes(updated);
            onNodesChanged?.(updated);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Failed to update node');
        } finally {
            setToggling(null);
        }
    };

    return (
        <div ref={overlayRef} onClick={handleOverlayClick} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-gray-900 border border-gray-700/60 rounded-xl shadow-2xl w-full max-w-lg mx-4">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                    <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                        </svg>
                        <span className="text-sm font-semibold text-gray-200">Prompt Pipeline</span>
                    </div>
                    <XCloseButton onClick={onClose} />
                </div>

                {/* Explainer */}
                <div className="px-4 pt-3 pb-0">
                    <p className="text-[11px] text-gray-500 leading-relaxed">
                        Each node intercepts prompts at a specific phase and can transform the text before it is passed on.
                        Nodes run in registration order.
                    </p>
                </div>

                {/* Node list */}
                <div className="p-4 space-y-3 max-h-[60vh] overflow-y-auto">
                    {loading && (
                        <p className="text-sm text-gray-500 text-center py-4">Loading…</p>
                    )}
                    {!loading && nodes.length === 0 && !error && (
                        <p className="text-sm text-gray-500 text-center py-4">No pipeline nodes registered.</p>
                    )}
                    {error && (
                        <p className="text-xs text-red-400">{error}</p>
                    )}
                    {nodes.map((node) => (
                        <div
                            key={node.id}
                            className="flex items-start gap-3 rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-3"
                        >
                            {/* Toggle */}
                            <div className="mt-0.5">
                                <Toggle
                                    checked={node.enabled}
                                    onChange={() => void handleToggle(node)}
                                    disabled={toggling === node.id}
                                    title={node.enabled ? 'Disable node' : 'Enable node'}
                                />
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className={`text-sm font-medium ${node.enabled ? 'text-gray-100' : 'text-gray-500'}`}>
                                        {node.name}
                                    </span>
                                    {node.phases.map((phase) => (
                                        <span
                                            key={phase}
                                            className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${PHASE_COLORS[phase]}`}
                                        >
                                            {PHASE_LABELS[phase]}
                                        </span>
                                    ))}
                                </div>
                                <p className={`text-[11px] mt-0.5 leading-relaxed ${node.enabled ? 'text-gray-500' : 'text-gray-600'}`}>
                                    {node.description}
                                </p>
                                {node.id === 'token-usage' && (
                                    <p className="text-[11px] mt-1 leading-relaxed text-gray-500">
                                        Disabling this hides the token usage box and stops counting new tokens immediately. Existing totals stay stored.
                                    </p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}