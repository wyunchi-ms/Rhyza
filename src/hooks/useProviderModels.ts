import { useEffect, useState } from "react";
import type { ModelInfo, ProviderId } from "../shared/ipc";
import { errorToMessage } from "../shared/value";
import { getRhyzaBridge } from "./useRhyzaBridge";

type ModelCatalogState = {
	providerId: ProviderId;
	models: ModelInfo[];
	loading: boolean;
	error: string | null;
};

export function useProviderModels(providerId: ProviderId) {
	const [catalog, setCatalog] = useState<ModelCatalogState | null>(null);
	useEffect(() => {
		const bridge = getRhyzaBridge();
		if (!bridge) return;
		let cancelled = false;
		setCatalog({ providerId, models: [], loading: true, error: null });
		void bridge.modelCatalog({ providerId }).then(
			(result) => {
				if (!cancelled) {
					setCatalog({
						providerId,
						models: result.models,
						loading: false,
						error: result.error ?? null,
					});
				}
			},
			(error: unknown) => {
				if (!cancelled) {
					setCatalog({ providerId, models: [], loading: false, error: errorToMessage(error) });
				}
			},
		);
		return () => {
			cancelled = true;
		};
	}, [providerId]);

	// Hide the old catalog during the render before the new provider's effect runs.
	return catalog?.providerId === providerId
		? catalog
		: { providerId, models: [], loading: Boolean(getRhyzaBridge()), error: null };
}
