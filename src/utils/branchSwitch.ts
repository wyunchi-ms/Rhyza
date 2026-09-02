export const branchSwitchStartEvent = "rhyza:branch-switch-start";
export const branchSwitchEndEvent = "rhyza:branch-switch-end";

export interface BranchSwitchDetail {
	sessionId: string;
}

export function announceBranchSwitchStart(sessionId: string): void {
	window.dispatchEvent(new CustomEvent<BranchSwitchDetail>(branchSwitchStartEvent, { detail: { sessionId } }));
}

export function announceBranchSwitchEnd(): void {
	window.dispatchEvent(new Event(branchSwitchEndEvent));
}
