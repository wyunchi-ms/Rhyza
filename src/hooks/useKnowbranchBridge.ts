import { useEffect, useRef, useState } from "react";
import type { ProviderId, WorkspaceInfo } from "../shared/ipc";
import { errorToMessage } from "../shared/value";
import {
	createProviderConnection,
	initialProviderConnectionState,
	type ProviderConnectionState,
} from "../utils/providerConnection";

export function getKnowbranchBridge() {
	return window.knowbranch;
}

export function isElectronRuntime(): boolean {
	return window.knowbranch?.isElectron === true;
}

export function useElectronProviderState(providerId: ProviderId) {
	const [state, setState] = useState<ProviderConnectionState | null>(null);
	const connectionRef = useRef<ReturnType<typeof createProviderConnection> | null>(null);
	const [workspace, setWorkspace] = useState<WorkspaceInfo>({ path: null });
	const [workspaceError, setWorkspaceError] = useState<string | null>(null);

	useEffect(() => {
		const bridge = getKnowbranchBridge();
		if (!bridge) return;
		const connection = createProviderConnection(bridge, providerId, setState);
		connectionRef.current = connection;
		void connection.refresh(false);
		return () => {
			connection.dispose();
			connectionRef.current = null;
		};
	}, [providerId]);

	useEffect(() => {
		const bridge = getKnowbranchBridge();
		if (!bridge) return;
		let cancelled = false;
		void bridge.getWorkspace().then(
			(info) => {
				if (!cancelled) setWorkspace(info);
			},
			(error: unknown) => {
				if (!cancelled) setWorkspaceError(errorToMessage(error));
			},
		);
		return () => {
			cancelled = true;
		};
	}, []);

	const connection =
		connectionRef.current?.providerId === providerId ? connectionRef.current : null;
	const current =
		connection && state?.providerId === providerId
			? state
			: initialProviderConnectionState(providerId, isElectronRuntime());

	return {
		...current,
		isElectron: isElectronRuntime(),
		workspace,
		workspaceError,
		setWorkspace,
		setWorkspaceError,
		refresh: () => connection?.refresh(),
		login: () => connection?.login(),
		logout: () => connection?.logout(),
	};
}
