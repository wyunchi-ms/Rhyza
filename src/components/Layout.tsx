import clsx from "clsx";
import {
	Clock,
	Database,
	FileCode,
	MessageSquare,
	Settings,
} from "lucide-react";
import type React from "react";
import { NavLink, Outlet } from "react-router-dom";

const Layout: React.FC = () => {
	return (
		<div className="flex h-screen bg-bg overflow-hidden text-text font-sans">
			{/* Navigation Rail */}
			<nav className="w-16 flex flex-col items-center py-4 bg-surface border-r border-gray-200 z-10">
				<div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center text-white font-bold mb-8 shadow-sm">
					KB
				</div>

				<div className="flex flex-col gap-6 flex-1">
					<NavItem to="/" icon={<MessageSquare size={20} />} title="Sessions" />
					<NavItem
						to="/knowledge"
						icon={<Database size={20} />}
						title="Knowledge"
					/>
					<NavItem
						to="/sources"
						icon={<FileCode size={20} />}
						title="Sources"
					/>
					<NavItem to="/changes" icon={<Clock size={20} />} title="Changes" />
				</div>

				<NavItem
					to="/settings"
					icon={<Settings size={20} />}
					title="Settings"
				/>
			</nav>

			{/* Main Content Area */}
			<main className="flex-1 flex overflow-hidden relative">
				<Outlet />
			</main>

			{/* Global Toolbar (Absolute positioned overlays could go here) */}
		</div>
	);
};

const NavItem = ({
	to,
	icon,
	title,
}: {
	to: string;
	icon: React.ReactNode;
	title: string;
}) => (
	<NavLink
		to={to}
		className={({ isActive }) =>
			clsx(
				"p-3 rounded-xl transition-all duration-200 group relative",
				isActive
					? "bg-accent/10 text-accent"
					: "text-secondary hover:bg-gray-100 hover:text-primary",
			)
		}
		title={title}
	>
		{icon}
	</NavLink>
);

export default Layout;
