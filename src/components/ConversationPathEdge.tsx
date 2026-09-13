import { useEffect, useId, useState } from "react";
import { BaseEdge, getSmoothStepPath, type EdgeProps } from "reactflow";
import { useAppStore } from "../store";

export function ConversationPathEdge(props: EdgeProps<{ active: boolean }>) {
	const gradientId = `conversation-flow-${useId().replace(/:/g, "")}`;
	const reduceMotion = useAppStore((state) => state.settings.reduceMotion);
	const [systemReduceMotion, setSystemReduceMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
	useEffect(() => {
		const query = window.matchMedia("(prefers-reduced-motion: reduce)");
		const update = () => setSystemReduceMotion(query.matches);
		query.addEventListener("change", update);
		return () => query.removeEventListener("change", update);
	}, []);
	const [path] = getSmoothStepPath(props);
	const dx = props.targetX - props.sourceX;
	const dy = props.targetY - props.sourceY;
	return <>
		{props.data?.active && <defs><linearGradient id={gradientId} gradientUnits="userSpaceOnUse"
			x1={props.sourceX} y1={props.sourceY} x2={props.targetX} y2={props.targetY} spreadMethod="repeat">
			<stop offset="0" stopColor="#6366f1" />
			<stop offset="0.3" stopColor="#8b5cf6" />
			<stop offset="0.55" stopColor="#38bdf8" />
			<stop offset="0.65" stopColor="#c4b5fd" />
			<stop offset="1" stopColor="#6366f1" />
			{!reduceMotion && !systemReduceMotion && <animateTransform attributeName="gradientTransform" type="translate"
				from={`${-dx} ${-dy}`} to="0 0" dur="2.8s" repeatCount="indefinite" />}
		</linearGradient></defs>}
		<BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={{ ...props.style,
			...(props.data?.active ? { stroke: `url(#${gradientId})` } : {}) }} />
	</>;
}
