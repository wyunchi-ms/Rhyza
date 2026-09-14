import { Clock3 } from "lucide-react";
import type { AgentCacheRequest } from "../../shared/ipc";
import { useCacheClock } from "../../hooks/useCacheClock";
import { cacheStatus } from "../../utils/cacheStatus";
import "./cacheStatus.css";

export function CacheStatus({
	request,
	selectedModel,
	compact = false,
}: {
	request?: AgentCacheRequest;
	selectedModel?: string;
	compact?: boolean;
}) {
	// No subscription and no placeholder when the response contains no usable TTL.
	if (!cacheStatus(request, Date.now(), selectedModel)) return null;
	return <TimedCacheStatus request={request} selectedModel={selectedModel} compact={compact} />;
}

function TimedCacheStatus({
	request,
	selectedModel,
	compact,
}: {
	request?: AgentCacheRequest;
	selectedModel?: string;
	compact: boolean;
}) {
	const now = useCacheClock();
	const status = cacheStatus(request, now, selectedModel);
	if (!status) return null;
	const detail = `${status.detail} Minimum retention window ends around ${new Date(status.expiresAt).toLocaleString()}.`;
	if (compact) {
		return (
			<span
				className="node-cache-status nodrag nopan"
				data-state={status.state}
				title={`${status.label}. ${detail}`}
				aria-label={`${status.label}. ${detail}`}
				tabIndex={0}
			>
				<Clock3 size={13} aria-hidden="true" />
			</span>
		);
	}
	return (
		<details className="composer-cache-status" data-state={status.state}>
			<summary title={detail}>
				<Clock3 size={12} aria-hidden="true" />
				{status.label}
			</summary>
			<div className="composer-cache-details">
				<p>{detail}</p>
			</div>
		</details>
	);
}
