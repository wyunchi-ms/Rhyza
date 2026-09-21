import clsx from "clsx";
import {
	Library,
	FolderOpen,
	GitBranch,
	History,
	PanelLeftClose,
	PanelLeftOpen,
	Search,
	Settings,
} from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAppStore } from "../store";
import { GlobalSearch } from "./GlobalSearch";
import { PanelResizeHandle, usePanelSize, useViewportWidth } from "./PanelResizeHandle";
import { SessionTree } from "./SessionTree";
import { SessionGraph } from "./SessionGraph";
import { IconSwitch } from "./IconSwitch";
import { SessionStatusFilter } from "./SessionStatusFilter";
import type { LeafStatusFilter } from "../utils/conversationFilter";

const Layout: React.FC = () => {
	const sidebarOpen = useAppStore((state) => state.sidebarOpen);
	const toggleSidebar = useAppStore((state) => state.toggleSidebar);
	const viewportWidth = useViewportWidth();
	const isCompactViewport = viewportWidth <= 900;
	const [compactSidebarOpen, setCompactSidebarOpen] = useState(false);
	const sidebarMax = Math.min(420, Math.max(260, viewportWidth * 0.35));
	const sidebarSize = usePanelSize("rhyza-layout-sidebar-width", 260, 200, sidebarMax);
	const [graphMode, setGraphModeState] = useState(false);
	const [leafStatuses, setLeafStatuses] = useState<LeafStatusFilter[]>([]);
	const [graphVisited, setGraphVisited] = useState(false);
	const setGraphMode = (enabled: boolean) => {
		if (enabled) setGraphVisited(true);
		setGraphModeState(enabled);
	};
	const graphMax = isCompactViewport
		? Math.max(200, viewportWidth - 32)
		: Math.max(360, viewportWidth - 480);
	const graphSize = usePanelSize(
		"rhyza-layout-graph-width",
		Math.min(640, viewportWidth * 0.48),
		360,
		graphMax,
	);
	const currentSize = graphMode ? graphSize : sidebarSize;
	const currentMax = graphMode ? graphMax : sidebarMax;
	const sidebarWidth = Math.min(currentSize.value, currentMax);
	const sidebarVisible = sidebarOpen && (!isCompactViewport || compactSidebarOpen);
	const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
	const { pathname } = useLocation();
	useEffect(() => {
		if (!isCompactViewport) setCompactSidebarOpen(false);
	}, [isCompactViewport]);
	useEffect(() => {
		setCompactSidebarOpen(false);
	}, [pathname]);
	useEffect(() => {
		if (!isCompactViewport || !compactSidebarOpen) return;
		const dismissSidebar = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			setCompactSidebarOpen(false);
		};
		window.addEventListener("keydown", dismissSidebar);
		return () => window.removeEventListener("keydown", dismissSidebar);
	}, [isCompactViewport, compactSidebarOpen]);

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
			if (
				!(event.ctrlKey || event.metaKey) ||
				!event.shiftKey ||
				event.key.toLocaleLowerCase() !== "f"
			)
				return;
			event.preventDefault();
			setGlobalSearchOpen(true);
		};
		window.addEventListener("keydown", openSearch);
		return () => window.removeEventListener("keydown", openSearch);
	}, []);
	return (
		<div className={clsx("app-shell", !sidebarVisible && "has-collapsed-sidebar")}>
			<a
				className="skip-to-content"
				href="#main-content"
				onClick={(event) => {
					event.preventDefault();
					document.getElementById("main-content")?.focus();
				}}
			>
				Skip to content
			</a>
			<aside
				className={clsx("app-sidebar", !sidebarVisible && "is-collapsed")}
				aria-label="Workspace sidebar"
				aria-hidden={!sidebarVisible}
				inert={!sidebarVisible}
				style={{
					width: sidebarVisible ? sidebarWidth : 0,
					flexBasis: sidebarVisible ? sidebarWidth : 0,
				}}
			>
				<div className="app-sidebar-brand">
					<button
						type="button"
						className="sidebar-icon-button"
						onClick={closeSidebar}
						title="Close sidebar"
						aria-label="Close sidebar"
					>
						<PanelLeftClose size={17} />
					</button>
					<div className="sidebar-header-actions">
						<button
							type="button"
							className="sidebar-icon-button"
							onClick={() => setGlobalSearchOpen(true)}
							title="Search chats (Ctrl+Shift+F)"
							aria-label="Search all chats"
						>
							<Search size={16} />
						</button>
						<nav className="sidebar-header-navigation" aria-label="Workspace navigation">
							<SidebarNavIcon to="/knowledge" icon={<Library size={16} />} label="Knowledge" />
							<SidebarNavIcon to="/sources" icon={<FolderOpen size={16} />} label="Sources" />
							<SidebarNavIcon to="/changes" icon={<History size={16} />} label="Changes" />
							<SidebarNavIcon to="/settings" icon={<Settings size={16} />} label="Settings" />
						</nav>
					</div>
				</div>
				{/* Retain each view's local state and DOM scroll position across switches. */}
				<div className="sidebar-view-content" hidden={graphMode}>
					<SessionTree
						embedded
						leafStatuses={leafStatuses}
						onClearFilter={() => setLeafStatuses([])}
						viewControl={
							<>
								<SessionStatusFilter statuses={leafStatuses} onChange={setLeafStatuses} />
								<IconSwitch
									checked={false}
									onChange={setGraphMode}
									icon={GitBranch}
									label="Node view"
									description="On: preview each conversation round as a node. Off: return to the chat list."
								/>
							</>
						}
					/>
				</div>
				{graphVisited && (
					<div className="sidebar-view-content" hidden={!graphMode}>
						<SessionGraph
							visible={graphMode && sidebarVisible}
							leafStatuses={leafStatuses}
							onClearFilter={() => setLeafStatuses([])}
							viewControl={
								<>
									<SessionStatusFilter statuses={leafStatuses} onChange={setLeafStatuses} />
									<IconSwitch
										checked
										onChange={setGraphMode}
										icon={GitBranch}
										label="Node view"
										description="On: preview each conversation round as a node. Off: return to the chat list."
									/>
								</>
							}
						/>
					</div>
				)}
			</aside>
			{isCompactViewport && sidebarVisible && (
				<button
					type="button"
					className="sidebar-scrim"
					onClick={closeSidebar}
					aria-label="Close navigation sidebar"
				/>
			)}
			{sidebarVisible && !isCompactViewport && (
				<PanelResizeHandle
					side="left"
					label="Resize navigation sidebar"
					value={sidebarWidth}
					min={graphMode ? 360 : 200}
					max={currentMax}
					defaultValue={graphMode ? Math.min(640, currentMax) : 260}
					onChange={currentSize.setValue}
					onCommit={currentSize.commit}
				/>
			)}
			{!sidebarVisible && (
				<button
					type="button"
					className="sidebar-reopen"
					onClick={openSidebar}
					title="Open sidebar"
					aria-label="Open sidebar"
				>
					<PanelLeftOpen size={18} />
				</button>
			)}
			<main className="app-main" id="main-content" tabIndex={-1}>
				<Outlet />
			</main>
			<GlobalSearch open={globalSearchOpen} onClose={() => setGlobalSearchOpen(false)} />
		</div>
	);
};

function SidebarNavIcon({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
	return (
		<NavLink
			to={to}
			className={({ isActive }) => clsx("sidebar-nav-icon", isActive && "is-active")}
			title={label}
			aria-label={label}
		>
			{icon}
		</NavLink>
	);
}

export default Layout;
