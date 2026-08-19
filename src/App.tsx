import type React from "react";
import { useEffect } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Changes from "./pages/Changes";
import Knowledge from "./pages/Knowledge";
import Settings from "./pages/Settings";
import Sources from "./pages/Sources";
import Workspace from "./pages/Workspace";
import { useAppStore } from "./store";

const App: React.FC = () => {
	const appearance = useAppStore((state) => state.settings);
	const entities = useAppStore((state) => state.entities);
	const relations = useAppStore((state) => state.relations);
	const diagrams = useAppStore((state) => state.diagrams);
	const reconcileKnowledge = useAppStore((state) => state.reconcileKnowledge);
	useEffect(() => {
		document.documentElement.style.fontSize = `${appearance.fontScale * 100}%`;
		document.documentElement.classList.toggle("reduce-motion", appearance.reduceMotion);
		document.documentElement.classList.toggle("high-contrast", appearance.highContrast);
	}, [appearance]);
	useEffect(() => {
		const timeout = window.setTimeout(reconcileKnowledge, 800);
		return () => window.clearTimeout(timeout);
	}, [entities, relations, diagrams, reconcileKnowledge]);
	useEffect(() => {
		const interval = window.setInterval(reconcileKnowledge, 5 * 60_000);
		return () => window.clearInterval(interval);
	}, [reconcileKnowledge]);
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
