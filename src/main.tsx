import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "./interface.css";
import "./pages/library-pages.css";
import "./pages/settings-page.css";
import { setWorkspacePersistencePath, useAppStore } from "./store";
import { startDocumentLocalization } from "./i18n/document";
import { AlertCircle } from "lucide-react";
import { errorToMessage } from "./shared/value";
import { useTranslation } from "./i18n";

async function bootstrap(): Promise<void> {
	if (window.rhyza) {
		const workspace = await window.rhyza.getWorkspace();
		setWorkspacePersistencePath(workspace.path);
	}
	await useAppStore.persist.rehydrate();
	if (!useAppStore.persist.hasHydrated())
		throw new Error(
			"Could not load workspace state. Retry without discarding your saved workspace.",
		);
	startDocumentLocalization();
	useAppStore.getState().pruneLegacyDiagrams();
}

function Startup() {
	const { t } = useTranslation();
	const [attempt, setAttempt] = React.useState(0);
	const [ready, setReady] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	React.useEffect(() => {
		let cancelled = false;
		setError(null);
		void bootstrap().then(
			() => {
				if (!cancelled) setReady(true);
			},
			(reason: unknown) => {
				if (!cancelled) setError(errorToMessage(reason));
			},
		);
		return () => {
			cancelled = true;
		};
	}, [attempt]);
	if (ready)
		return (
			<React.StrictMode>
				<App />
			</React.StrictMode>
		);
	return (
		<main className="startup-state" aria-busy={!error}>
			{error ? (
				<>
					<AlertCircle size={28} aria-hidden="true" />
					<h1>{t("Could not open workspace")}</h1>
					<p role="alert">{error}</p>
					<button
						type="button"
						className="command-button"
						onClick={() => setAttempt((value) => value + 1)}
					>
						{t("Retry")}
					</button>
				</>
			) : (
				<p role="status">{t("Opening workspace…")}</p>
			)}
		</main>
	);
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Startup />);
