import clsx from "clsx";
import { Database, Link as LinkIcon, Network } from "lucide-react";
import type React from "react";
import { useAppStore } from "../store";

export const KnowledgePane: React.FC = () => {
	const { entities, rightPaneOpen } = useAppStore();

	if (!rightPaneOpen) return null;

	return (
		<div className="w-80 bg-surface border-l border-gray-200 flex flex-col h-full overflow-hidden shadow-[-4px_0_24px_rgba(0,0,0,0.02)]">
			<div className="p-4 border-b border-gray-100 flex items-center justify-between">
				<h2 className="font-bold text-sm text-primary flex items-center gap-2">
					<Database size={16} className="text-accent" />
					Contextual Knowledge
				</h2>
			</div>

			<div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
				<div>
					<h3 className="text-xs font-bold uppercase text-secondary tracking-wider mb-3">
						Entities in Context
					</h3>
					<div className="flex flex-col gap-2">
						{entities.map((entity) => (
							<div
								key={entity.id}
								className="p-3 bg-white border border-gray-100 rounded-xl shadow-sm hover:shadow-md transition-shadow cursor-pointer group"
							>
								<div className="flex items-center justify-between mb-1">
									<span className="font-semibold text-primary group-hover:text-accent transition-colors">
										{entity.name}
									</span>
									<span className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full font-medium">
										{entity.type}
									</span>
								</div>
								<p className="text-xs text-secondary line-clamp-2 leading-relaxed">
									{entity.summary}
								</p>
								<div className="mt-2 flex items-center gap-3 text-[10px] text-gray-400 font-medium">
									<span className="flex items-center gap-1">
										<LinkIcon size={10} /> 3 relations
									</span>
									<span
										className={clsx(
											"px-1.5 py-0.5 rounded text-white",
											entity.confidence === "confirmed"
												? "bg-green-500"
												: "bg-yellow-500",
										)}
									>
										{entity.confidence}
									</span>
								</div>
							</div>
						))}
					</div>
				</div>

				<div>
					<h3 className="text-xs font-bold uppercase text-secondary tracking-wider mb-3">
						Related Diagrams
					</h3>
					<div className="aspect-video bg-gray-50 rounded-xl border border-gray-100 flex items-center justify-center text-secondary cursor-pointer hover:bg-gray-100 transition-colors">
						<Network size={24} className="opacity-50" />
						<span className="ml-2 text-sm font-medium">Architecture Map</span>
					</div>
				</div>
			</div>
		</div>
	);
};
