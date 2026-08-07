import type React from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Changes from "./pages/Changes";
import Knowledge from "./pages/Knowledge";
import Settings from "./pages/Settings";
import Sources from "./pages/Sources";
import Workspace from "./pages/Workspace";

const App: React.FC = () => {
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
