import type React from "react";
import { ChatPane } from "../components/ChatPane";
import { KnowledgePane } from "../components/KnowledgePane";
import { KnowledgePreviewHost } from "../hooks/useKnowledgePreview";

const Workspace: React.FC = () => {
	return (
		<div className="workspace-shell flex w-full h-full">
			<div className="flex-1 flex overflow-hidden">
				<ChatPane />
				<KnowledgePane />
			</div>
			<KnowledgePreviewHost />
		</div>
	);
};

export default Workspace;
