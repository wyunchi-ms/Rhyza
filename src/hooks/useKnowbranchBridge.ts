import { useEffect, useState } from "react";
import type {
	AuthBridgeEvent,
	ModelInfo,
	ProviderStatusResponse,
	WorkspaceInfo,
} from "../shared/ipc";

export const githubCopilotProviderId = "github-copilot" as const;

export function getKnowbranchBridge() {
	return window.knowbranch;
}

export function isTauriRuntime(): boolean {
	return window.knowbranch?.isTauri === true;
}

export function useDesktopProviderState() {
	const [providerStatus, setProviderStatus] =
		useState<ProviderStatusResponse | null>(null);
	const [models, setModels] = useState<ModelInfo[]>([]);
	const [workspace, setWorkspace] = useState<WorkspaceInfo>({ path: null });
	const [authEvents, setAuthEvents] = useState<AuthBridgeEvent[]>([]);
	const [loading, setLoading] = useState(isTauriRuntime());
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const bridge = getKnowbranchBridge();
		if (!bridge) {
			setLoading(false);
			return;
		}

		let cancelled = false;
		const activeBridge = bridge;
		const unsubscribe = activeBridge.onAuthEvent((event) => {
			setAuthEvents((events) => [event, ...events].slice(0, 5));
		});

		async function load() {
			try {
				setLoading(true);
				const [status, catalog, workspaceInfo] = await Promise.all([
					activeBridge.providerStatus({ providerId: githubCopilotProviderId }),
					activeBridge.modelCatalog({ providerId: githubCopilotProviderId }),
					activeBridge.getWorkspace(),
				]);
				if (!cancelled) {
					setProviderStatus(status);
					setModels(catalog.models);
					setWorkspace(workspaceInfo);
					setError(status.error ?? catalog.error ?? null);
				}
			} catch (loadError) {
				if (!cancelled) {
					setError(errorToMessage(loadError));
				}
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		}

		void load();
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, []);

	return {
		isDesktop: isTauriRuntime(),
		providerStatus,
		models,
		workspace,
		authEvents,
		loading,
		error,
		setProviderStatus,
		setModels,
		setWorkspace,
		setAuthEvents,
		setError,
	};
}

function errorToMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
