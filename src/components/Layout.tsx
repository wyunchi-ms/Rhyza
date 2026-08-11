import clsx from "clsx";
import { Clock3, Database, FileCode2, PanelLeftClose, PanelLeftOpen, Settings, Sparkles } from "lucide-react";
import type React from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAppStore } from "../store";
import { PanelResizeHandle, usePanelSize, useViewportWidth } from "./PanelResizeHandle";
import { SessionTree } from "./SessionTree";

const Layout: React.FC = () => {
	const sidebarOpen = useAppStore((state) => state.sidebarOpen);
	const toggleSidebar = useAppStore((state) => state.toggleSidebar);
	const viewportWidth = useViewportWidth();
	const sidebarMax = Math.min(420, Math.max(260, viewportWidth * 0.35));
	const sidebarSize = usePanelSize("knowbranch-layout-sidebar-width", 260, 200, sidebarMax);
	const sidebarWidth = Math.min(sidebarSize.value, sidebarMax);
	return (
		<div className="app-shell">
			<aside
				className={clsx("app-sidebar", !sidebarOpen && "is-collapsed")}
				style={{ width: sidebarOpen ? sidebarWidth : 0, flexBasis: sidebarOpen ? sidebarWidth : 0 }}
			>
				<div className="app-sidebar-brand">
					<div className="brand-mark"><Sparkles size={15} /></div>
					<span>Rhyza</span>
					<button type="button" className="sidebar-icon-button ml-auto" onClick={toggleSidebar} title="Close sidebar" aria-label="Close sidebar"><PanelLeftClose size={17} /></button>
				</div>
				<nav className="app-nav" aria-label="Workspace navigation">
					<NavItem to="/knowledge" icon={<Database size={17} />} label="Knowledge" />
					<NavItem to="/sources" icon={<FileCode2 size={17} />} label="Sources" />
					<NavItem to="/changes" icon={<Clock3 size={17} />} label="Changes" />
				</nav>
				<SessionTree embedded />
				<div className="app-sidebar-footer">
					<NavItem to="/settings" icon={<Settings size={17} />} label="Settings" />
				</div>
			</aside>
			{sidebarOpen && <PanelResizeHandle side="left" label="Resize navigation sidebar" value={sidebarWidth} min={200} max={sidebarMax} defaultValue={260} onChange={sidebarSize.setValue} onCommit={sidebarSize.commit} />}
			{!sidebarOpen && <button type="button" className="sidebar-reopen" onClick={toggleSidebar} title="Open sidebar" aria-label="Open sidebar"><PanelLeftOpen size={18} /></button>}
			<main className="app-main"><Outlet /></main>
		</div>
	);
};

function NavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
	return <NavLink to={to} className={({ isActive }) => clsx("app-nav-item", isActive && "is-active")}><span>{icon}</span><span className="truncate">{label}</span></NavLink>;
}

export default Layout;
