import { useAppStore } from '../../store/appStore';
import type { Agent, Credential } from '../../api/client';

interface Props {
    agentType: string;
    credentialId: number | undefined;
    onAgentChange: (type: string) => void;
    onCredentialChange: (id: number | undefined) => void;
}

export default function AgentPicker({
    agentType,
    credentialId,
    onAgentChange,
    onCredentialChange,
}: Props) {
    const { agents, credentials } = useAppStore();
    const installedAgents = agents.filter((a: Agent) => a.installed);
    const filteredCreds = credentials.filter(
        (c: Credential) => !agentType || c.agent_type === agentType
    );

    return (
        <div className="space-y-1">
            <select
                className="w-full bg-gray-900 border border-gray-700 text-sm px-2 py-1.5 rounded-md text-gray-100 focus:outline-none focus:border-indigo-500 transition-all"
                value={agentType}
                onChange={(e) => {
                    onAgentChange(e.target.value);
                    onCredentialChange(undefined);
                }}
            >
                <option value="">Select agent...</option>
                {installedAgents.map((a: Agent) => (
                    <option key={a.id} value={a.id}>
                        {a.name}
                    </option>
                ))}
                {agents
                    .filter((a: Agent) => !a.installed)
                    .map((a: Agent) => (
                        <option key={a.id} value={a.id} disabled>
                            {a.name} (not installed)
                        </option>
                    ))}
            </select>

            <select
                className="w-full bg-gray-900 border border-gray-700 text-sm px-2 py-1.5 rounded-md text-gray-100 focus:outline-none focus:border-indigo-500 transition-all disabled:opacity-40"
                value={credentialId ?? ''}
                onChange={(e) =>
                    onCredentialChange(e.target.value ? parseInt(e.target.value, 10) : undefined)
                }
                disabled={!agentType}
            >
                <option value="">No credential profile</option>
                {filteredCreds.map((c: Credential) => (
                    <option key={c.id} value={c.id}>
                        {c.name}
                    </option>
                ))}
            </select>
        </div>
    );
}
