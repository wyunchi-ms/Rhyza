declare module "dagre" {
	interface GraphOptions { rankdir?: string; nodesep?: number; ranksep?: number }
	class Graph {
		setDefaultEdgeLabel(factory: () => object): Graph;
		setGraph(options: GraphOptions): Graph;
		setNode(id: string, value: { width: number; height: number }): void;
		setEdge(source: string, target: string): void;
		node(id: string): { x: number; y: number };
	}
	const dagre: { graphlib: { Graph: typeof Graph }; layout(graph: Graph): void };
	export default dagre;
}
