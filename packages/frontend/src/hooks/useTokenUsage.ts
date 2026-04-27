import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { PipelineNodeDto, UsageSummary } from '../api/client';

export function useTokenUsage(selectedRepoId?: number) {
    const [summary, setSummary] = useState<UsageSummary | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [tokenUsageEnabled, setTokenUsageEnabled] = useState(true);

    const refreshUsage = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const nextSummary = await api.usage.summary(selectedRepoId);
            setSummary(nextSummary);
        } catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : 'Failed to load usage');
            setSummary(null);
        } finally {
            setLoading(false);
        }
    }, [selectedRepoId]);

    const syncTokenUsageEnabled = useCallback((nodes: PipelineNodeDto[]) => {
        const tokenNode = nodes.find((node) => node.id === 'token-usage');
        setTokenUsageEnabled(tokenNode?.enabled ?? true);
    }, []);

    useEffect(() => {
        api.pipeline.list().then(syncTokenUsageEnabled).catch(console.error);
    }, [syncTokenUsageEnabled]);

    useEffect(() => {
        if (!tokenUsageEnabled) {
            setSummary(null);
            setLoading(false);
            setError('');
            return;
        }

        void refreshUsage();
    }, [refreshUsage, tokenUsageEnabled]);

    return {
        summary,
        loading,
        error,
        tokenUsageEnabled,
        refreshUsage,
        syncTokenUsageEnabled,
    };
}