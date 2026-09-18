import type {
	AuthBridgeEvent,
	KnowbranchBridge,
	ModelInfo,
	ProviderId,
	ProviderStatusResponse,
} from "../shared/ipc";
import { getProviderInfo } from "../shared/providers";
import { errorToMessage } from "../shared/value";

type ProviderAction = "refresh" | "login" | "logout";
type ProviderBridge = Pick<
	KnowbranchBridge,
	"providerStatus" | "providerLogin" | "providerLogout" | "modelCatalog" | "onAuthEvent"
>;

export interface ProviderConnectionState {
	providerId: ProviderId;
	providerStatus: ProviderStatusResponse | null;
	models: ModelInfo[];
	authEvents: AuthBridgeEvent[];
	loading: boolean;
	action: ProviderAction | null;
	error: string | null;
}

export function initialProviderConnectionState(
	providerId: ProviderId,
	loading = false,
): ProviderConnectionState {
	return {
		providerId,
		providerStatus: null,
		models: [],
		authEvents: [],
		loading,
		action: null,
		error: null,
	};
}

export function createProviderConnection(
	bridge: ProviderBridge,
	providerId: ProviderId,
	publish: (state: ProviderConnectionState) => void,
) {
	const provider = getProviderInfo(providerId);
	let state = initialProviderConnectionState(providerId);
	let disposed = false;
	let pending = false;
	const update = (patch: Partial<ProviderConnectionState>) => {
		if (disposed) return;
		state = { ...state, ...patch };
		publish(state);
	};
	// Auth events are untagged and only Copilot has an in-app login flow.
	const unsubscribe =
		providerId === "github-copilot"
			? bridge.onAuthEvent((event) => {
					if (state.action === "login") {
						update({ authEvents: [event, ...state.authEvents].slice(0, 5) });
					}
				})
			: undefined;

	const run = async (action: ProviderAction, refreshCatalog = true) => {
		if (disposed || pending) return;
		if (action !== "refresh" && (provider.externalAuth || state.providerStatus?.externalAuth)) {
			update({
				error: `Manage ${provider.label} sign-in in its local CLI, then check the connection.`,
			});
			return;
		}
		pending = true;
		update({ loading: true, action, error: null, authEvents: [] });
		try {
			if (action === "refresh") {
				const [status, catalog] = await Promise.allSettled([
					bridge.providerStatus({ providerId }),
					bridge.modelCatalog({ providerId, refresh: refreshCatalog }),
				]);
				update({
					providerStatus: status.status === "fulfilled" ? status.value : null,
					models: catalog.status === "fulfilled" ? catalog.value.models : [],
					error:
						(status.status === "fulfilled" ? status.value.error : errorToMessage(status.reason)) ??
						(catalog.status === "fulfilled"
							? catalog.value.error
							: errorToMessage(catalog.reason)) ??
						null,
				});
			} else {
				const result = await (action === "login"
					? bridge.providerLogin({ providerId })
					: bridge.providerLogout({ providerId }));
				if (disposed) return;
				const actionError =
					result.error ??
					result.status.error ??
					(result.ok
						? null
						: `${provider.label} sign-${action === "login" ? "in" : "out"} failed.`);
				update({
					providerStatus: result.status,
					error: actionError,
					...(action === "logout" && result.ok ? { models: [] } : {}),
				});
				if (action === "login" && result.ok) {
					const catalog = await bridge.modelCatalog({ providerId, refresh: true });
					update({ models: catalog.models, error: actionError ?? catalog.error ?? null });
				}
			}
		} catch (error) {
			update({ error: errorToMessage(error) });
		} finally {
			pending = false;
			update({ loading: false, action: null });
		}
	};

	return {
		providerId,
		refresh: (refreshCatalog = true) => run("refresh", refreshCatalog),
		login: () => run("login"),
		logout: () => run("logout"),
		dispose: () => {
			disposed = true;
			unsubscribe?.();
		},
	};
}
