import clsx from "clsx";
import appIcon from "../../resources/branding/icon.png";
import {
	Ellipsis,
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
import { useTranslation } from "../i18n";
import { PathSummaryProvider, PathSummaryToolbar } from "./PathSummarySelection";
import { errorToMessage } from "../shared/value";

const Layout: React.FC = () => (
	<PathSummaryProvider>
		<LayoutContent />
	</PathSummaryProvider>
);

const LayoutContent: React.FC = () => {
	const { t } = useTranslation();
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
	const desktopTitleBar = window.rhyza?.platform === "win32";
	const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
	const { pathname } = useLocation();
	const isSettingsPage = pathname === "/settings";
	const workspaceSidebarVisible = sidebarVisible && !isSettingsPage;
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
		<div className="app-frame">
			{desktopTitleBar && (
				<DesktopTitleBar
					sidebarVisible={workspaceSidebarVisible}
					showSidebarControls={!isSettingsPage}
					onToggleSidebar={sidebarVisible ? closeSidebar : openSidebar}
					onOpenSearch={() => setGlobalSearchOpen(true)}
				/>
			)}
			<div className={clsx("app-shell", !workspaceSidebarVisible && "has-collapsed-sidebar")}>
				<aside
					className={clsx("app-sidebar", !workspaceSidebarVisible && "is-collapsed")}
					aria-label={t("Workspace sidebar")}
					aria-hidden={!workspaceSidebarVisible}
					inert={!workspaceSidebarVisible}
					style={{
						width: workspaceSidebarVisible ? sidebarWidth : 0,
						flexBasis: workspaceSidebarVisible ? sidebarWidth : 0,
					}}
				>
					{!desktopTitleBar && (
						<div className="app-sidebar-brand">
							<button
								type="button"
								className="sidebar-icon-button"
								onClick={closeSidebar}
								title={t("Close sidebar")}
								aria-label={t("Close sidebar")}
							>
								<PanelLeftClose size={17} />
							</button>
							<button
								type="button"
								className="sidebar-icon-button"
								onClick={() => setGlobalSearchOpen(true)}
								title={t("Search all chats")}
								aria-label={t("Search all chats")}
							>
								<Search size={16} />
							</button>
						</div>
					)}
					<PathSummaryToolbar />
					{/* Retain each view's local state and DOM scroll position across switches. */}
					<div className="sidebar-view-content" hidden={graphMode}>
						<SessionTree
							embedded
							visible={!graphMode && sidebarVisible}
							leafStatuses={leafStatuses}
							onClearFilter={() => setLeafStatuses([])}
							viewControl={
								<>
									<SessionStatusFilter statuses={leafStatuses} onChange={setLeafStatuses} />
									<IconSwitch
										checked={false}
										onChange={setGraphMode}
										icon={GitBranch}
										label={t("Node view")}
										description={t(
											"On: preview each conversation round as a node. Off: return to the chat list.",
										)}
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
											label={t("Node view")}
											description={t(
												"On: preview each conversation round as a node. Off: return to the chat list.",
											)}
										/>
									</>
								}
							/>
						</div>
					)}
					<nav className="app-sidebar-footer" aria-label={t("Workspace navigation")}>
						<SidebarNavIcon to="/knowledge" icon={<Library size={14} />} label={t("Knowledge")} />
						<SidebarNavIcon to="/sources" icon={<FolderOpen size={14} />} label={t("Sources")} />
						<SidebarNavIcon to="/changes" icon={<History size={14} />} label={t("Changes")} />
						<SidebarNavIcon to="/settings" icon={<Settings size={14} />} label={t("Settings")} />
					</nav>
				</aside>
				{isCompactViewport && workspaceSidebarVisible && (
					<button
						type="button"
						className="sidebar-scrim"
						onClick={closeSidebar}
						aria-label={t("Close navigation sidebar")}
					/>
				)}
				{workspaceSidebarVisible && !isCompactViewport && (
					<PanelResizeHandle
						side="left"
						label={t("Resize navigation sidebar")}
						value={sidebarWidth}
						min={graphMode ? 360 : 200}
						max={currentMax}
						defaultValue={graphMode ? Math.min(640, currentMax) : 260}
						onChange={currentSize.setValue}
						onCommit={currentSize.commit}
					/>
				)}
				{!sidebarVisible && !desktopTitleBar && !isSettingsPage && (
					<button
						type="button"
						className="sidebar-reopen"
						onClick={openSidebar}
						title={t("Open sidebar")}
						aria-label={t("Open sidebar")}
					>
						<PanelLeftOpen size={18} />
					</button>
				)}
				<main className="app-main" id="main-content" tabIndex={-1}>
					<Outlet />
				</main>
				<GlobalSearch open={globalSearchOpen} onClose={() => setGlobalSearchOpen(false)} />
			</div>
		</div>
	);
};

function DesktopTitleBar({
	sidebarVisible,
	showSidebarControls,
	onToggleSidebar,
	onOpenSearch,
}: {
	sidebarVisible: boolean;
	showSidebarControls: boolean;
	onToggleSidebar: () => void;
	onOpenSearch: () => void;
}) {
	const [menuError, setMenuError] = useState<string | null>(null);
	return (
		<header className="app-titlebar" aria-label="Rhyza window">
			<img src={appIcon} alt="" width={15} height={15} />
			<button
				type="button"
				aria-label="Application menu"
				title="Application menu"
				onClick={() => {
					const bridge = window.rhyza;
					if (!bridge) {
						setMenuError("The application menu is unavailable.");
						return;
					}
					void bridge.showApplicationMenu().then(
						() => setMenuError(null),
						(error: unknown) => setMenuError(errorToMessage(error)),
					);
				}}
			>
				<Ellipsis size={15} />
			</button>
			{showSidebarControls && (
				<button
					type="button"
					onClick={onToggleSidebar}
					aria-label={sidebarVisible ? "Close sidebar" : "Open sidebar"}
					title={sidebarVisible ? "Close sidebar" : "Open sidebar"}
				>
					{sidebarVisible ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
				</button>
			)}
			<button
				type="button"
				onClick={onOpenSearch}
				aria-label="Search all chats"
				title="Search all chats"
			>
				<Search size={15} />
			</button>
			{menuError && <span role="alert">{menuError}</span>}
		</header>
	);
}

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
