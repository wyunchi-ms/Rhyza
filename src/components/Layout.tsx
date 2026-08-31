import clsx from "clsx";
import { Clock3, Database, FileCode2, PanelLeftClose, PanelLeftOpen, Search, Settings, Sparkles } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAppStore } from "../store";
import { GlobalSearch } from "./GlobalSearch";
import { PanelResizeHandle, usePanelSize, useViewportWidth } from "./PanelResizeHandle";
import { SessionTree } from "./SessionTree";

const Layout: React.FC = () => {
	const sidebarOpen = useAppStore((state) => state.sidebarOpen);
	const toggleSidebar = useAppStore((state) => state.toggleSidebar);
	const viewportWidth = useViewportWidth();
	const isCompactViewport = viewportWidth <= 900;
	const [compactSidebarOpen, setCompactSidebarOpen] = useState(false);
	const sidebarMax = Math.min(420, Math.max(260, viewportWidth * 0.35));
	const sidebarSize = usePanelSize("knowbranch-layout-sidebar-width", 260, 200, sidebarMax);
	const sidebarWidth = Math.min(sidebarSize.value, sidebarMax);
	const sidebarVisible = sidebarOpen && (!isCompactViewport || compactSidebarOpen);
	const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
	useEffect(() => {
		if (!isCompactViewport) setCompactSidebarOpen(false);
	}, [isCompactViewport]);

	const openSidebar = () => {
		if (isCompactViewport) {
			if (!sidebarOpen) toggleSidebar();
			setCompactSidebarOpen(true);
			return;
		}
		toggleSidebar();
	};

	const closeSidebar = () => {
		if (isCompactViewport) {
			setCompactSidebarOpen(false);
			return;
		}
		toggleSidebar();
	};

	useEffect(() => {
		const openSearch = (event: KeyboardEvent) => {
			if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.key.toLocaleLowerCase() !== "f") return;
			event.preventDefault();
			setGlobalSearchOpen(true);
		};
		window.addEventListener("keydown", openSearch);
		return () => window.removeEventListener("keydown", openSearch);
	}, []);
	return (
		<div className="app-shell">
			<aside
				className={clsx("app-sidebar", !sidebarVisible && "is-collapsed")}
				style={{ width: sidebarVisible ? sidebarWidth : 0, flexBasis: sidebarVisible ? sidebarWidth : 0 }}
			>
				<div className="app-sidebar-brand">
					<div className="brand-mark"><Sparkles size={15} /></div>
					<span>Rhyza</span>
					<button type="button" className="sidebar-icon-button ml-auto" onClick={() => setGlobalSearchOpen(true)} title="Search chats (Ctrl+Shift+F)" aria-label="Search all chats"><Search size={16} /></button>
					<button type="button" className="sidebar-icon-button" onClick={closeSidebar} title="Close sidebar" aria-label="Close sidebar"><PanelLeftClose size={17} /></button>
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
			{isCompactViewport && sidebarVisible && <button type="button" className="sidebar-scrim" onClick={closeSidebar} aria-label="Close navigation sidebar" />}
			{sidebarVisible && !isCompactViewport && <PanelResizeHandle side="left" label="Resize navigation sidebar" value={sidebarWidth} min={200} max={sidebarMax} defaultValue={260} onChange={sidebarSize.setValue} onCommit={sidebarSize.commit} />}
			{!sidebarVisible && <button type="button" className="sidebar-reopen" onClick={openSidebar} title="Open sidebar" aria-label="Open sidebar"><PanelLeftOpen size={18} /></button>}
			<main className="app-main"><Outlet /></main>
			<GlobalSearch open={globalSearchOpen} onClose={() => setGlobalSearchOpen(false)} />
		</div>
	);
};

function NavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
	return <NavLink to={to} className={({ isActive }) => clsx("app-nav-item", isActive && "is-active")}><span>{icon}</span><span className="truncate">{label}</span></NavLink>;
}

export default Layout;
