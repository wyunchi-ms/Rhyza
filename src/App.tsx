import type React from "react";
import { useEffect, useLayoutEffect } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Changes from "./pages/Changes";
import Knowledge from "./pages/Knowledge";
import Settings from "./pages/Settings";
import Sources from "./pages/Sources";
import Workspace from "./pages/Workspace";
import { useAppStore } from "./store";
import { useKnowledgeReconciliation } from "./hooks/useKnowledgeReconciliation";
import { startPerformanceDiagnostics } from "./utils/performanceDiagnostics";

const App: React.FC = () => {
	const appearance = useAppStore((state) => state.settings);
	useKnowledgeReconciliation();
	useLayoutEffect(() => {
		document.documentElement.dataset.theme = appearance.theme;
		document.documentElement.style.colorScheme = appearance.theme;
		document.documentElement.style.fontSize = `${appearance.fontScale * 100}%`;
		document.documentElement.classList.toggle("reduce-motion", appearance.reduceMotion);
		document.documentElement.classList.toggle("high-contrast", appearance.highContrast);
	}, [appearance]);
	useEffect(() => {
		return startPerformanceDiagnostics();
	}, []);
	return (
		<HashRouter>
			<Routes>
				<Route path="/" element={<Layout />}>
					<Route index element={<Workspace />} />
					<Route path="knowledge" element={<Knowledge />} />
					<Route path="sources" element={<Sources />} />
					<Route path="changes" element={<Changes />} />
					<Route path="settings" element={<Settings />} />
				</Route>
			</Routes>
		</HashRouter>
	);
};

export default App;
