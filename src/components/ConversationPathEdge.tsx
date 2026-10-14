import { BaseEdge, getBezierPath, type EdgeProps } from "reactflow";

export function ConversationPathEdge(props: EdgeProps<{ active: boolean }>) {
	const [path] = getBezierPath(props);
	return (
		<BaseEdge
			id={props.id}
			path={path}
			markerEnd={props.markerEnd}
			style={{
				...props.style,
				stroke: props.data?.active ? "var(--ui-brand-accent)" : "var(--ui-border)",
			}}
		/>
	);
}
