import clsx from "clsx";
import { FileCode, FolderGit2, RefreshCw } from "lucide-react";
import type React from "react";
import { useAppStore } from "../store";

const Sources: React.FC = () => {
	const { sources, addSource, refreshSource } = useAppStore();

	return (
		<div className="flex-1 flex flex-col bg-white overflow-hidden p-8 max-w-5xl mx-auto w-full">
			<div className="mb-8">
				<h1 className="text-3xl font-black tracking-tight text-primary">
					Sources
				</h1>
				<p className="text-secondary mt-2 text-lg">
					Code repositories and documentation directories indexed in this
					workspace.
				</p>
			</div>

			<div className="flex flex-col gap-4 overflow-y-auto">
				{sources.map((src) => (
					<div
						key={src.id}
						className="p-5 border border-gray-200 rounded-2xl flex items-center justify-between bg-white shadow-sm hover:border-gray-300 transition-colors"
					>
						<div className="flex items-center gap-4">
							<div
								className={clsx(
									"w-12 h-12 rounded-xl flex items-center justify-center",
									src.type === "repo"
										? "bg-accent/10 text-accent"
										: "bg-orange-100 text-orange-600",
								)}
							>
								{src.type === "repo" ? (
									<FolderGit2 size={24} />
								) : (
									<FileCode size={24} />
								)}
							</div>
							<div>
								<h3 className="font-bold text-primary text-lg">{src.name}</h3>
								<p className="text-sm text-secondary font-medium">
									{src.path} • {src.fileCount} files
								</p>
							</div>
						</div>
						<div className="flex items-center gap-4">
							<span
								className={clsx(
									"px-3 py-1 rounded text-xs font-bold uppercase tracking-wider",
									src.status === "indexed"
										? "bg-green-100 text-green-700"
										: src.status === "scanning"
											? "bg-blue-100 text-blue-700 animate-pulse"
											: "bg-gray-100 text-gray-700",
								)}
							>
								{src.status}
							</span>
							<button
								type="button"
								onClick={() => refreshSource(src.id)}
								className={clsx(
									"p-2 text-gray-400 hover:text-accent bg-gray-50 rounded-lg transition-colors",
									src.status === "scanning" && "opacity-50 pointer-events-none",
								)}
							>
								<RefreshCw
									size={18}
									className={clsx(src.status === "scanning" && "animate-spin")}
								/>
							</button>
						</div>
					</div>
				))}

				<button
					type="button"
					onClick={addSource}
					className="w-full py-4 mt-2 border-2 border-dashed border-gray-300 rounded-2xl text-secondary font-bold hover:border-accent hover:text-accent hover:bg-accent/5 transition-colors"
				>
					+ Add New Source
				</button>
			</div>
		</div>
	);
};

export default Sources;
