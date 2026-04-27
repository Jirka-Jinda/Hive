import type { AgentUsageRow, CredentialUsageRow, SessionUsageRow, UsageSummary, UsageTotals } from '../../api/client';

interface Props {
    repoName: string | null;
    summary: UsageSummary | null;
    loading: boolean;
    error: string;
    onRefresh: () => void;
    onClose: () => void;
}

function formatTokens(value: number): string {
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: value >= 1000 ? 1 : 0 }).format(value);
}

function formatExact(value: number): string {
    return new Intl.NumberFormat('en').format(value);
}

function formatPercent(numerator: number, denominator: number): string {
    if (denominator === 0) return '0%';
    return `${Math.round((numerator / denominator) * 100)}%`;
}

function MetricCard({ label, value, detail }: { label: string; value: number | string; detail: string }) {
    return (
        <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-3">
            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{label}</div>
            <div className="mt-1 text-xl font-semibold text-gray-100">{value}</div>
            <div className="mt-1 text-[11px] text-gray-500">{detail}</div>
        </div>
    );
}

function UsageTable<T>({
    title,
    emptyLabel,
    rows,
    columns,
}: {
    title: string;
    emptyLabel: string;
    rows: T[];
    columns: { key: string; label: string; render: (row: T) => React.ReactNode; align?: 'left' | 'right' }[];
}) {
    return (
        <section className="rounded-lg border border-gray-800 bg-gray-950/60 overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-800 text-xs font-semibold text-gray-300">{title}</div>
            {rows.length === 0 ? (
                <div className="px-3 py-4 text-xs text-gray-500">{emptyLabel}</div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                        <thead className="bg-gray-900/70 text-gray-500 uppercase tracking-wider">
                            <tr>
                                {columns.map((column) => (
                                    <th
                                        key={column.key}
                                        className={`px-3 py-2 font-semibold ${column.align === 'right' ? 'text-right' : 'text-left'}`}
                                    >
                                        {column.label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, index) => (
                                <tr key={index} className="border-t border-gray-800/80 text-gray-300">
                                    {columns.map((column) => (
                                        <td
                                            key={column.key}
                                            className={`px-3 py-2 ${column.align === 'right' ? 'text-right text-gray-200 font-medium' : ''}`}
                                        >
                                            {column.render(row)}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}

export default function UsageModal({ repoName, summary, loading, error, onRefresh, onClose }: Props) {
    const totals = summary?.totals ?? {
        context_tokens: 0,
        input_tokens: 0,
        prompt_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
    } satisfies UsageTotals;
    const topSession = summary?.sessions[0] ?? null;
    const topAgent = summary?.by_agent[0] ?? null;
    const topCredential = summary?.by_credential[0] ?? null;
    const scopeLabel = repoName ?? 'All repositories';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-gray-900 border border-gray-700/60 rounded-xl shadow-2xl w-full max-w-6xl mx-4 max-h-[88vh] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                    <div>
                        <div className="flex items-center gap-2">
                            <svg className="w-4 h-4 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 19h16M7 15l3-3 2 2 5-6" />
                            </svg>
                            <span className="text-sm font-semibold text-gray-200">Token Usage</span>
                        </div>
                        <p className="mt-1 text-[11px] text-gray-500">Approximate prompt and output tokens for {scopeLabel}.</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onRefresh}
                            className="text-xs px-3 py-1.5 rounded border border-gray-700 bg-gray-800 text-gray-300 hover:text-white hover:border-gray-600 font-medium transition-all"
                        >
                            Refresh
                        </button>
                        <button
                            onClick={onClose}
                            className="text-xs px-3 py-1.5 rounded border border-gray-700 bg-gray-800 text-gray-400 hover:text-gray-200 font-medium transition-all"
                        >
                            Close
                        </button>
                    </div>
                </div>

                <div className="p-4 space-y-4 overflow-y-auto">
                    {error && (
                        <div className="rounded-lg border border-red-800/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                            {error}
                        </div>
                    )}

                    <div className="grid gap-3 md:grid-cols-4">
                        <MetricCard label="Total Tokens" value={loading ? '…' : formatTokens(totals.total_tokens)} detail={loading ? 'Loading usage…' : `${formatExact(totals.total_tokens)} exact`} />
                        <MetricCard label="Prompt Tokens" value={loading ? '…' : formatTokens(totals.prompt_tokens)} detail={`${formatPercent(totals.prompt_tokens, totals.total_tokens)} of total`} />
                        <MetricCard label="Output Tokens" value={loading ? '…' : formatTokens(totals.output_tokens)} detail={`${formatPercent(totals.output_tokens, totals.total_tokens)} of total`} />
                        <MetricCard label="Tracked Sessions" value={summary?.sessions.length ?? 0} detail={repoName ? 'Current sessions in this repo' : 'Current sessions across repos'} />
                    </div>

                    <section className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-3">
                        <div className="text-xs font-semibold text-gray-300">Quick Analysis</div>
                        <div className="mt-2 grid gap-2 md:grid-cols-3 text-[11px] text-gray-400">
                            <div className="rounded-md border border-gray-800 bg-gray-900/40 px-3 py-2">
                                <div className="font-semibold text-gray-200">Top Session</div>
                                <div className="mt-1">{topSession ? `${topSession.session_name} • ${formatTokens(topSession.total_tokens)}` : 'No session usage recorded yet.'}</div>
                            </div>
                            <div className="rounded-md border border-gray-800 bg-gray-900/40 px-3 py-2">
                                <div className="font-semibold text-gray-200">Top Agent</div>
                                <div className="mt-1">{topAgent ? `${topAgent.agent_type} • ${formatTokens(topAgent.total_tokens)}` : 'No agent usage recorded yet.'}</div>
                            </div>
                            <div className="rounded-md border border-gray-800 bg-gray-900/40 px-3 py-2">
                                <div className="font-semibold text-gray-200">Top Credential</div>
                                <div className="mt-1">{topCredential ? `${topCredential.credential_name} • ${formatTokens(topCredential.total_tokens)}` : 'No credential usage recorded yet.'}</div>
                            </div>
                        </div>
                    </section>

                    <UsageTable<SessionUsageRow>
                        title="Session Totals"
                        emptyLabel="No session usage has been recorded yet."
                        rows={summary?.sessions ?? []}
                        columns={[
                            {
                                key: 'session',
                                label: 'Session',
                                render: (row) => (
                                    <div>
                                        <div className="font-medium text-gray-100">{row.session_name}</div>
                                        <div className="text-[11px] text-gray-500">{row.agent_type} • {row.credential_name}</div>
                                    </div>
                                ),
                            },
                            {
                                key: 'repo',
                                label: 'Repo',
                                render: (row) => row.repo_name,
                            },
                            {
                                key: 'status',
                                label: 'State',
                                render: (row) => `${row.status} / ${row.state}`,
                            },
                            {
                                key: 'prompt',
                                label: 'Prompt',
                                align: 'right',
                                render: (row) => formatExact(row.prompt_tokens),
                            },
                            {
                                key: 'output',
                                label: 'Output',
                                align: 'right',
                                render: (row) => formatExact(row.output_tokens),
                            },
                            {
                                key: 'total',
                                label: 'Total',
                                align: 'right',
                                render: (row) => formatExact(row.total_tokens),
                            },
                        ]}
                    />

                    <div className="grid gap-4 lg:grid-cols-2">
                        <UsageTable<AgentUsageRow>
                            title="By Agent"
                            emptyLabel="No agent usage has been recorded yet."
                            rows={summary?.by_agent ?? []}
                            columns={[
                                {
                                    key: 'agent',
                                    label: 'Agent',
                                    render: (row) => row.agent_type,
                                },
                                {
                                    key: 'prompt',
                                    label: 'Prompt',
                                    align: 'right',
                                    render: (row) => formatExact(row.prompt_tokens),
                                },
                                {
                                    key: 'output',
                                    label: 'Output',
                                    align: 'right',
                                    render: (row) => formatExact(row.output_tokens),
                                },
                                {
                                    key: 'total',
                                    label: 'Total',
                                    align: 'right',
                                    render: (row) => formatExact(row.total_tokens),
                                },
                            ]}
                        />

                        <UsageTable<CredentialUsageRow>
                            title="By Credential"
                            emptyLabel="No credential usage has been recorded yet."
                            rows={summary?.by_credential ?? []}
                            columns={[
                                {
                                    key: 'credential',
                                    label: 'Credential',
                                    render: (row) => row.credential_name,
                                },
                                {
                                    key: 'prompt',
                                    label: 'Prompt',
                                    align: 'right',
                                    render: (row) => formatExact(row.prompt_tokens),
                                },
                                {
                                    key: 'output',
                                    label: 'Output',
                                    align: 'right',
                                    render: (row) => formatExact(row.output_tokens),
                                },
                                {
                                    key: 'total',
                                    label: 'Total',
                                    align: 'right',
                                    render: (row) => formatExact(row.total_tokens),
                                },
                            ]}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}