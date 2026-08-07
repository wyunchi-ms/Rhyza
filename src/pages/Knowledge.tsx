import { Database, Filter, Link as LinkIcon, Search, X } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useAppStore } from "../store";
import type { Entity } from "../types";

const Knowledge: React.FC = () => {
	const { entities } = useAppStore();
	const [search, setSearch] = useState("");
	const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);

	const filteredEntities = entities.filter(
		(e) =>
			e.name.toLowerCase().includes(search.toLowerCase()) ||
			e.summary.toLowerCase().includes(search.toLowerCase()) ||
			e.type.toLowerCase().includes(search.toLowerCase()),
	);

	return (
		<div className="flex-1 flex bg-white overflow-hidden relative w-full">
			<div className="flex-1 flex flex-col p-8 max-w-7xl mx-auto w-full h-full overflow-hidden">
				<div className="flex items-center justify-between mb-8 shrink-0">
					<div>
						<h1 className="text-3xl font-black tracking-tight text-primary">
							Knowledge Base
						</h1>
						<p className="text-secondary mt-2 text-lg">
							Entities, Relations, and Diagrams across all sessions.
						</p>
					</div>
					<div className="flex gap-2">
						<div className="relative">
							<Search
								className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
								size={18}
							/>
							<input
								type="text"
								placeholder="Search knowledge..."
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								className="pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent font-medium text-sm w-64"
							/>
						</div>
						<button
							type="button"
							className="p-2 border border-gray-200 rounded-xl hover:bg-gray-50 text-secondary transition-colors"
						>
							<Filter size={18} />
						</button>
					</div>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-3 gap-6 overflow-y-auto pb-8 content-start h-full">
					{filteredEntities.map((entity) => (
						<button
							type="button"
							key={entity.id}
							onClick={() => setSelectedEntity(entity)}
							className="p-6 text-left bg-white border border-gray-200 rounded-2xl shadow-sm hover:shadow-lg transition-all group cursor-pointer h-48 flex flex-col"
						>
							<div className="flex items-start justify-between mb-4">
								<div className="flex items-center gap-2">
									<div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-accent group-hover:bg-accent group-hover:text-white transition-colors">
										<Database size={20} />
									</div>
									<div>
										<h3 className="font-bold text-primary text-lg">
											{entity.name}
										</h3>
										<span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
											{entity.type}
										</span>
									</div>
								</div>
							</div>
							<p className="text-sm text-secondary leading-relaxed flex-1 line-clamp-2">
								{entity.summary}
							</p>
							<div className="flex items-center justify-between border-t border-gray-100 pt-4 shrink-0">
								<div className="flex gap-4 text-xs font-medium text-gray-500">
									<span className="flex items-center gap-1">
										<LinkIcon size={14} className="text-gray-400" /> Relations
									</span>
									<span>v{entity.version}</span>
								</div>
								<span
									className={`px-2.5 py-1 rounded text-xs font-bold ${entity.confidence === "confirmed" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}
								>
									{entity.confidence}
								</span>
							</div>
						</button>
					))}
					{filteredEntities.length === 0 && (
						<div className="col-span-3 py-12 text-center text-secondary">
							No entities found matching "{search}"
						</div>
					)}
				</div>
			</div>

			{selectedEntity && (
				<div className="absolute inset-y-0 right-0 w-96 bg-white shadow-2xl border-l border-gray-200 flex flex-col animate-in slide-in-from-right-8 duration-200 z-20">
					<div className="p-6 border-b border-gray-100 flex justify-between items-start bg-gray-50">
						<div>
							<span className="text-xs font-semibold text-accent uppercase tracking-wider mb-1 block">
								{selectedEntity.type}
							</span>
							<h2 className="text-2xl font-black text-primary">
								{selectedEntity.name}
							</h2>
						</div>
						<button
							type="button"
							onClick={() => setSelectedEntity(null)}
							className="p-1 hover:bg-gray-200 rounded-md text-gray-500"
						>
							<X size={20} />
						</button>
					</div>
					<div className="p-6 flex-1 overflow-y-auto">
						<h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2">
							Summary
						</h4>
						<p className="text-secondary leading-relaxed mb-6">
							{selectedEntity.summary}
						</p>

						<h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2">
							Content
						</h4>
						<p className="text-secondary leading-relaxed mb-6 bg-gray-50 p-4 rounded-xl border border-gray-100 text-sm whitespace-pre-wrap">
							{selectedEntity.content}
						</p>

						<h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2">
							Metadata
						</h4>
						<div className="flex flex-col gap-2 text-sm text-secondary">
							<div className="flex justify-between py-2 border-b border-gray-50">
								<span className="font-medium text-gray-400">Confidence</span>
								<span className="font-bold">{selectedEntity.confidence}</span>
							</div>
							<div className="flex justify-between py-2 border-b border-gray-50">
								<span className="font-medium text-gray-400">Version</span>
								<span className="font-bold">v{selectedEntity.version}</span>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
};

export default Knowledge;
