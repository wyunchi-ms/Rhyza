export interface SessionNode {
	id: string;
	parentId: string | null;
	title: string;
	isRoot: boolean;
	status: "idle" | "running" | "error";
}

export interface Turn {
	id: string;
	sessionId: string;
	role: "user" | "assistant";
	content: string;
	status: "idle" | "retrieving" | "running" | "finalizing" | "complete";
	summary?: string;
	entities?: EntityMention[];
	changeSetId?: string;
}

export interface EntityMention {
	id: string;
	name: string;
	type: string;
}

export interface Entity {
	id: string;
	name: string;
	type: string;
	summary: string;
	content: string;
	confidence: "confirmed" | "inferred" | "disputed";
	version: number;
}

export interface Source {
	id: string;
	name: string;
	path: string;
	fileCount: number;
	status: "indexed" | "scanning" | "stale";
	type: "repo" | "docs";
}

export interface ChangeSet {
	id: string;
	title: string;
	timestamp: string;
	sessionId: string;
	turnId?: string;
	summary: string;
	addedEntities: { id: string; name: string }[];
	addedRelations: number;
	reverted: boolean;
}

export interface Settings {
	provider: string;
	defaultModel: string;
	autoExtract: boolean;
	strictConflict: boolean;
}
