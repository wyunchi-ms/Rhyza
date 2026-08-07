import type React from "react";
import { ChatPane } from "../components/ChatPane";
import { KnowledgePane } from "../components/KnowledgePane";
import { SessionTree } from "../components/SessionTree";

const Workspace: React.FC = () => {
	return (
		<div className="flex w-full h-full">
			<SessionTree />
			<div className="flex-1 flex overflow-hidden">
				<ChatPane />
				<KnowledgePane />
			</div>
		</div>
	);
};

export default Workspace;
