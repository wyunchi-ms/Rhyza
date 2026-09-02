import { isRecord } from "./value.js";

export const archifyDiagramTypes = ["architecture", "workflow", "sequence", "dataflow", "lifecycle"] as const;

export type ArchifyDiagramType = (typeof archifyDiagramTypes)[number];

export interface ArchifyTopologyNode {
	key: string;
	label: string;
	type?: string;
}

export interface ArchifyTopologyEdge {
	sourceKey: string;
	targetKey: string;
	label?: string;
}

export interface ParsedArchifySource {
	type: ArchifyDiagramType;
	spec: Record<string, unknown>;
	normalized: boolean;
	nodes: ArchifyTopologyNode[];
	edges: ArchifyTopologyEdge[];
	title?: string;
}

const archifyTypeSet = new Set<string>(archifyDiagramTypes);

export function isArchifyCodeBlock(className: string | undefined): boolean {
	return /(?:^|\s)language-archify(?:\s|$)/i.test(className ?? "");
}

export function parseArchifySource(source: string): ParsedArchifySource {
	if (source.length > 1_000_000) throw new Error("Archify source exceeds the 1 MB limit.");
	let parsed: unknown;
	try {
		parsed = JSON.parse(source);
	} catch (error) {
		throw new Error(`Archify source is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isRecord(parsed)) throw new Error("Archify source must be a JSON object.");
	const normalized = normalizeArchifySpec(parsed);
	const type = normalized.diagram_type;
	if (typeof type !== "string" || !archifyTypeSet.has(type)) {
		const received = typeof parsed.diagram_type === "string"
			? ` Received: ${JSON.stringify(parsed.diagram_type)}.`
			: " The field was missing and the topology could not be inferred.";
		throw new Error(`Archify diagram_type must be one of: ${archifyDiagramTypes.join(", ")}.${received}`);
	}
	const topology = extractTopology(type as ArchifyDiagramType, normalized);
	if (topology.nodes.length === 0) throw new Error("Archify source does not contain any supported nodes.");
	const meta = isRecord(normalized.meta) ? normalized.meta : undefined;
	return {
		type: type as ArchifyDiagramType,
		spec: normalized,
		normalized: normalized !== parsed,
		nodes: topology.nodes,
		edges: topology.edges,
		title: typeof meta?.title === "string" ? meta.title.trim().slice(0, 160) : undefined,
	};
}

function normalizeArchifySpec(spec: Record<string, unknown>): Record<string, unknown> {
	const diagramType = normalizeDiagramType(spec.diagram_type) ?? normalizeDiagramType(spec.type) ?? inferDiagramType(spec);
	if ((diagramType === "architecture" || diagramType === undefined) && Array.isArray(spec.nodes)) {
		return convertGenericArchitecture(spec);
	}
	if (diagramType === "sequence" && Array.isArray(spec.lanes) && Array.isArray(spec.events)) {
		return convertGenericSequence(spec);
	}
	if (!diagramType) return spec;
	if (spec.diagram_type === diagramType) return spec;
	const { type: _legacyType, version: _legacyVersion, title: legacyTitle, direction: _direction, theme: _theme, ...rest } = spec;
	return {
		...rest,
		schema_version: 1,
		diagram_type: diagramType,
		meta: normalizeMeta(spec.meta, legacyTitle),
	};
}

function normalizeDiagramType(value: unknown): ArchifyDiagramType | undefined {
	if (typeof value !== "string") return undefined;
	const compact = value.toLowerCase().replace(/[^a-z]/g, "");
	if (compact.includes("architecture") || compact === "component" || compact === "system") return "architecture";
	if (compact.includes("sequence") || compact === "swimlane") return "sequence";
	if (compact.includes("dataflow")) return "dataflow";
	if (compact.includes("lifecycle") || compact.includes("state")) return "lifecycle";
	if (compact.includes("workflow") || compact === "flowchart" || compact === "process") return "workflow";
	return undefined;
}

function inferDiagramType(spec: Record<string, unknown>): ArchifyDiagramType | undefined {
	if (Array.isArray(spec.components) || Array.isArray(spec.connections)) return "architecture";
	if (Array.isArray(spec.participants) || Array.isArray(spec.messages)) return "sequence";
	if (Array.isArray(spec.flows) || Array.isArray(spec.stages)) return "dataflow";
	if (Array.isArray(spec.states) || Array.isArray(spec.transitions)) return "lifecycle";
	if (Array.isArray(spec.lanes) && Array.isArray(spec.events)) return "sequence";
	if (Array.isArray(spec.nodes) && Array.isArray(spec.edges)) return "architecture";
	return undefined;
}

function convertGenericArchitecture(spec: Record<string, unknown>): Record<string, unknown> {
	const genericNodes = readNodes(spec.nodes);
	if (genericNodes.length === 0) return spec;
	const rawNodes = Array.isArray(spec.nodes) ? spec.nodes.filter(isRecord).slice(0, 120) : [];
	const idMap = createCanonicalIdMap(genericNodes.map((node) => node.key));
	const referenced = new Set(readEdges(spec.edges).flatMap((edge) => [edge.sourceKey, edge.targetKey]));
	const boundaryKeys = new Set(rawNodes.flatMap((node) => {
		const key = readString(node.id, node.key);
		return key && String(node.kind ?? node.type).toLowerCase() === "group" && Array.isArray(node.children) && !referenced.has(key) ? [key] : [];
	}));
	const componentKeys = new Set(genericNodes.filter((node) => !boundaryKeys.has(node.key)).map((node) => node.key));
	const components = genericNodes.filter((node) => componentKeys.has(node.key)).map((node, index) => {
		const raw = rawNodes.find((candidate) => readString(candidate.id, candidate.key) === node.key);
		const [label, sublabel] = splitLabel(node.label, readString(raw?.note, raw?.description));
		return {
			id: idMap.get(node.key)!,
			type: componentType(readString(raw?.kind, raw?.type, node.type), node.label),
			label,
			...(sublabel ? { sublabel } : {}),
			pos: [60 + (index % 5) * 210, 80 + Math.floor(index / 5) * 125],
			size: [164, 72],
		};
	});
	const activeIds = new Set(components.map((component) => component.id));
	const connections = readEdges(spec.edges).flatMap((edge, index) => {
		const from = idMap.get(edge.sourceKey);
		const to = idMap.get(edge.targetKey);
		if (!from || !to || !activeIds.has(from) || !activeIds.has(to)) return [];
		return [{ id: `edge_${index + 1}`, from, to, ...(edge.label ? { label: edge.label } : {}) }];
	});
	const boundaries = rawNodes.flatMap((node) => {
		const key = readString(node.id, node.key);
		if (!key || !boundaryKeys.has(key) || !Array.isArray(node.children)) return [];
		const wraps = node.children.flatMap((child) => {
			const id = typeof child === "string" ? idMap.get(child) : undefined;
			return id && activeIds.has(id) ? [id] : [];
		});
		return wraps.length > 0 ? [{ kind: "region", label: readString(node.label, node.title, node.name) ?? key, wraps }] : [];
	});
	return {
		schema_version: 1,
		diagram_type: "architecture",
		meta: normalizeMeta(spec.meta, spec.title, components.length),
		components,
		...(boundaries.length > 0 ? { boundaries } : {}),
		connections,
	};
}

function convertGenericSequence(spec: Record<string, unknown>): Record<string, unknown> {
	const lanes = readNodes(spec.lanes);
	const idMap = createCanonicalIdMap(lanes.map((lane) => lane.key));
	const participants = lanes.map((lane) => ({
		id: idMap.get(lane.key)!,
		type: componentType(lane.type, lane.label),
		label: lane.label,
	}));
	const messages = readEdges(spec.events).flatMap((event, index) => {
		const from = idMap.get(event.sourceKey);
		const to = idMap.get(event.targetKey);
		if (!from || !to) return [];
		return [{ id: `message_${index + 1}`, from, to, y: 180 + index * 86, label: event.label ?? "message" }];
	});
	if (participants.length < 2 || messages.length === 0) return spec;
	return {
		schema_version: 1,
		diagram_type: "sequence",
		meta: normalizeMeta(spec.meta, spec.title, messages.length),
		participants,
		messages,
	};
}

function normalizeMeta(value: unknown, legacyTitle?: unknown, itemCount = 0): Record<string, unknown> {
	const existing = isRecord(value) ? value : {};
	const title = readString(existing.title, legacyTitle) ?? "Interactive diagram";
	const hasChinese = /[\u3400-\u9fff]/.test(title);
	return {
		...existing,
		title: title.slice(0, 160),
		locale: existing.locale === "en" || existing.locale === "zh-CN" ? existing.locale : hasChinese ? "zh-CN" : "en",
		quality_profile: "showcase",
		...(!existing.viewBox && itemCount > 0 ? { viewBox: [Math.max(900, Math.min(1400, itemCount * 150)), Math.max(420, Math.ceil(itemCount / 5) * 125 + 180)] } : {}),
	};
}

function createCanonicalIdMap(keys: string[]): Map<string, string> {
	const used = new Set<string>();
	return new Map(keys.map((key, index) => {
		const base = key.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^[^a-zA-Z]+/, "") || `node_${index + 1}`;
		let id = base;
		let suffix = 2;
		while (used.has(id)) id = `${base}_${suffix++}`;
		used.add(id);
		return [key, id];
	}));
}

function componentType(kind: string | undefined, label: string): "frontend" | "backend" | "database" | "cloud" | "security" | "messagebus" | "external" {
	const value = `${kind ?? ""} ${label}`.toLowerCase();
	if (/(database|sqlite|postgres|mysql|redis|store|数据库)/.test(value)) return "database";
	if (/(frontend|client|ui|tui|web|客户端|入口)/.test(value)) return "frontend";
	if (/(external|provider|model|third.party|外部|供应商)/.test(value)) return "external";
	if (/(queue|event|bus|stream|消息|事件)/.test(value)) return "messagebus";
	if (/(security|auth|oauth|permission|安全|权限)/.test(value)) return "security";
	if (/(cloud|cdn|gateway|load.balance|云)/.test(value)) return "cloud";
	return "backend";
}

function splitLabel(label: string, note?: string): [string, string | undefined] {
	const [first, ...rest] = label.split(/\r?\n/).map((part) => part.trim()).filter(Boolean);
	const details = [...rest, ...(note ? [note] : [])].join(" · ").slice(0, 180);
	return [(first || label).slice(0, 100), details || undefined];
}

export function archifyToMermaid(source: string): string {
	const parsed = parseArchifySource(source);
	if (parsed.type === "sequence") return sequenceMermaid(parsed);
	const lines = ["flowchart TD"];
	for (const node of parsed.nodes) {
		lines.push(`    ${safeId(node.key)}[\"${escapeMermaidLabel(node.label)}\"]`);
	}
	for (const edge of parsed.edges) {
		const from = safeId(edge.sourceKey);
		const to = safeId(edge.targetKey);
		lines.push(edge.label
			? `    ${from} -->|\"${escapeMermaidLabel(edge.label)}\"| ${to}`
			: `    ${from} --> ${to}`);
	}
	return lines.join("\n");
}

function extractTopology(type: ArchifyDiagramType, spec: Record<string, unknown>): { nodes: ArchifyTopologyNode[]; edges: ArchifyTopologyEdge[] } {
	if (type === "architecture") {
		return {
			nodes: readNodes(spec.components),
			edges: readEdges(spec.connections),
		};
	}
	if (type === "sequence") {
		return {
			nodes: readNodes(spec.participants),
			edges: readEdges(spec.messages),
		};
	}
	if (type === "dataflow") {
		return {
			nodes: readNodes(spec.nodes),
			edges: readEdges(spec.flows),
		};
	}
	if (type === "lifecycle") {
		return {
			nodes: readNodes(spec.states),
			edges: readEdges(spec.transitions),
		};
	}
	return {
		nodes: readNodes(spec.nodes),
		edges: readEdges(spec.edges),
	};
}

function readNodes(value: unknown): ArchifyTopologyNode[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	return value.slice(0, 120).flatMap((item): ArchifyTopologyNode[] => {
		if (!isRecord(item)) return [];
		const key = readString(item.id, item.key)?.slice(0, 100) ?? "";
		const label = readString(item.label, item.name, item.title)?.slice(0, 160) ?? "";
		if (!key || !label || seen.has(key)) return [];
		seen.add(key);
		return [{ key, label, type: readString(item.type, item.kind)?.slice(0, 60) }];
	});
}

function readEdges(value: unknown): ArchifyTopologyEdge[] {
	if (!Array.isArray(value)) return [];
	return value.slice(0, 240).flatMap((item): ArchifyTopologyEdge[] => {
		if (!isRecord(item)) return [];
		const sourceKey = readString(item.from, item.source, item.sourceKey)?.slice(0, 100) ?? "";
		const targetKey = readString(item.to, item.target, item.targetKey)?.slice(0, 100) ?? "";
		if (!sourceKey || !targetKey) return [];
		return [{
			sourceKey,
			targetKey,
			label: readString(item.label, item.message, item.title)?.slice(0, 200),
		}];
	});
}

function sequenceMermaid(parsed: ParsedArchifySource): string {
	const lines = ["sequenceDiagram"];
	for (const node of parsed.nodes) lines.push(`    participant ${safeId(node.key)} as ${escapeMermaidLabel(node.label)}`);
	for (const edge of parsed.edges) {
		lines.push(`    ${safeId(edge.sourceKey)}->>${safeId(edge.targetKey)}: ${escapeMermaidLabel(edge.label ?? "message")}`);
	}
	return lines.join("\n");
}

function safeId(value: string): string {
	const normalized = value.replace(/[^a-zA-Z0-9_]/g, "_");
	return /^[a-zA-Z_]/.test(normalized) ? normalized : `n_${normalized}`;
}

function escapeMermaidLabel(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/[\r\n]+/g, " ");
}

function readString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}
