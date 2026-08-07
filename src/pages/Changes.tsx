import clsx from "clsx";
import { CheckCircle2, RotateCcw, RotateCw } from "lucide-react";
import type React from "react";
import { useAppStore } from "../store";

const Changes: React.FC = () => {
	const { changesets, undoChangeSet } = useAppStore();

	return (
		<div className="flex-1 flex flex-col bg-white overflow-hidden p-8 max-w-4xl mx-auto w-full">
			<div className="mb-8">
				<h1 className="text-3xl font-black tracking-tight text-primary">
					Knowledge Changes
				</h1>
				<p className="text-secondary mt-2 text-lg">
					History of modifications to the Knowledge Base.
				</p>
			</div>

			<div className="relative border-l-2 border-gray-100 ml-6 space-y-8 pb-8 overflow-y-auto">
				{changesets.map((cs, idx) => (
					<div
						key={cs.id}
						className={clsx(
							"relative pl-8 transition-opacity",
							cs.reverted && "opacity-50",
						)}
					>
						<div
							className={clsx(
								"absolute w-4 h-4 rounded-full -left-[9px] top-1 border-4 border-white shadow-sm",
								idx === 0 && !cs.reverted ? "bg-green-500" : "bg-gray-300",
							)}
						/>
						<div className="bg-white border border-gray-200 p-5 rounded-2xl shadow-sm">
							<div className="flex justify-between items-start mb-2">
								<h3
									className={clsx(
										"font-bold",
										cs.reverted ? "text-gray-400 line-through" : "text-primary",
									)}
								>
									{cs.title}
								</h3>
								<span className="text-xs font-semibold text-gray-400">
									{new Date(cs.timestamp).toLocaleTimeString()}
								</span>
							</div>
							<p className="text-sm text-secondary mb-4">{cs.summary}</p>

							{!cs.reverted && (
								<>
									<div className="flex flex-wrap gap-2">
										{cs.addedEntities.map((e) => (
											<span
												key={e.id}
												className="px-2 py-1 bg-green-50 text-green-600 rounded text-xs font-bold"
											>
												+ {e.name}
											</span>
										))}
										{cs.addedRelations > 0 && (
											<span className="px-2 py-1 bg-blue-50 text-blue-600 rounded text-xs font-bold">
												+ {cs.addedRelations} Relations
											</span>
										)}
									</div>
									<div className="mt-4 flex gap-4 border-t border-gray-50 pt-3">
										<button
											type="button"
											onClick={() => alert("Diff Viewer Mock: Would show graph changes here")}
											className="text-xs font-bold text-gray-500 flex items-center gap-1 hover:text-primary transition-colors"
										>
											<CheckCircle2 size={14} /> View Diff (Mock)
										</button>
										<button
											type="button"
											onClick={() => undoChangeSet(cs.id)}
											className="text-xs font-bold text-gray-500 flex items-center gap-1 hover:text-red-600 transition-colors"
										>
											<RotateCcw size={14} /> Undo (Local)
										</button>
									</div>
								</>
							)}
							{cs.reverted && (
								<div className="mt-2 text-xs font-bold text-gray-400 flex items-center gap-1">
									<RotateCw size={14} /> Reverted
								</div>
							)}
						</div>
					</div>
				))}
			</div>
		</div>
	);
};

export default Changes;
