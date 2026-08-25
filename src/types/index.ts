export type Confidence = "confirmed" | "inferred" | "disputed";

export type SessionProgressStatus = "todo" | "in_progress" | "complete" | "parked";

export interface SessionNode {
	id: string;
	parentId: string | null;
	forkedFromTurnId?: string;
	title: string;
	titlePending?: boolean;
	refreshTitleOnNextPrompt?: boolean;
	progressStatus?: SessionProgressStatus;
	isRoot: boolean;
	status: "idle" | "running" | "interrupted" | "error";
	worktreePath?: string;
	/** Model usage spent generating this node's title. */
	titleUsage?: TokenUsage;
}

export interface Turn {
	id: string;
	/** Original turn represented by a copied branch-history turn. */
	sourceTurnId?: string;
	sessionId: string;
	role: "user" | "assistant";
	content: string;
	reasoning?: string;
	tools?: ToolExecution[];
	activities?: TurnActivity[];
	status:
		| "idle"
		| "retrieving"
		| "running"
		| "finalizing"
		| "interrupted"
		| "complete"
		| "complete_with_unsynced_knowledge";
	summary?: string;
	entities?: EntityMention[];
	changeSetId?: string;
	images?: TurnImage[];
	quote?: {
		turnId: string;
		text: string;
	};
	usage?: TokenUsage;
	/** Display-only usage copied with shared fork history; excluded from branch totals. */
	inheritedUsage?: TokenUsage;
	createdAt: string;
	completedAt?: string;
}

export interface TurnImage {
	mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/bmp";
	data: string;
}

export interface TokenUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

export interface TurnActivity {
	id: "retrieval" | "agent" | "knowledge";
	label: string;
	status: "running" | "complete" | "error";
	startedAt: string;
	completedAt?: string;
	durationMs?: number;
	detail?: string;
}

export interface ToolExecution {
	id: string;
	name: string;
	target?: string;
	status: "running" | "complete" | "error";
	startedAt: string;
	completedAt?: string;
	durationMs?: number;
}

export interface EntityMention {
	id: string;
	name: string;
	type: string;
}

export interface SourceRef {
	sourceId?: string;
	path?: string;
	revision?: string;
	lineStart?: number;
	lineEnd?: number;
	sessionId?: string;
	turnId?: string;
	stale?: boolean;
}

export interface Entity {
	id: string;
	name: string;
	aliases: string[];
	type: string;
	summary: string;
	content: string;
	confidence: Confidence;
	sourceRefs: SourceRef[];
	version: number;
	updatedAt: string;
	deletedAt?: string;
}

export interface Relation {
	id: string;
	sourceEntityId: string;
	targetEntityId: string;
	type: string;
	description: string;
	confidence: Confidence;
	sourceRefs: SourceRef[];
	version: number;
	deletedAt?: string;
}

export interface DiagramNode {
	id: string;
	entityId?: string;
	label: string;
	type?: string;
}

export interface DiagramEdge {
	id: string;
	source: string;
	target: string;
	relationId?: string;
	label?: string;
}

export interface DiagramVersion {
	version: number;
	timestamp: string;
	addedNodeIds: string[];
	addedEdgeIds: string[];
	removedNodeIds: string[];
	removedEdgeIds: string[];
}

export interface Diagram {
	id: string;
	name: string;
	type: "architecture" | "structure" | "flowchart" | "sequence" | "swimlane" | "dependency";
	nodes: DiagramNode[];
	edges: DiagramEdge[];
	mermaidSource: string;
	sourceRefs?: SourceRef[];
	version: number;
	versions: DiagramVersion[];
	updatedAt: string;
	deletedAt?: string;
}

export interface Source {
	id: string;
	name: string;
	path: string;
	fileCount: number;
	status: "pending" | "scanning" | "indexed" | "stale" | "error" | "archived";
	type: "repo" | "docs";
	revision?: string;
	indexedAt?: string;
	error?: string;
}

export interface ChangeOperation {
	kind: "entity" | "relation" | "diagram";
	action: "create" | "update" | "soft_delete";
	objectId: string;
	label: string;
	before?: unknown;
	after?: unknown;
}

export interface ChangeSet {
	id: string;
	title: string;
	timestamp: string;
	sessionId: string;
	turnId?: string;
	summary: string;
	actor: "agent" | "user";
	status: "proposed" | "committed" | "reverted" | "superseded";
	operations: ChangeOperation[];
	undoOf?: string;
}

export interface Settings {
	provider: string;
	defaultModel: string;
	autoExtract: boolean;
	strictConflict: boolean;
	knowledgeMode: "automatic" | "suggest" | "read_only" | "hybrid";
	confidenceThreshold: number;
	thinkingLevel: "off" | "low" | "medium" | "high";
	reduceMotion: boolean;
	highContrast: boolean;
	fontScale: number;
	maxConcurrentRequests: number;
}
