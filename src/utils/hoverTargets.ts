// ---------------------------------------------------------------------------
// Hover-target registry
// ---------------------------------------------------------------------------
// A tiny pub/sub so the 3D scenes and the cursor controller don't need to
// know about each other. HeartScene and DreamCanvas each raycast against
// their own meshes once per frame and report in/out here; CursorController
// just listens for a target id and flips a CSS class. Neither side needs a
// reference to the other's camera, canvas, or mesh list.
// ---------------------------------------------------------------------------

export type HoverTargetId = 'heart' | 'staircase';

const ALL_IDS: HoverTargetId[] = ['heart', 'staircase'];
const active: Record<HoverTargetId, boolean> = { heart: false, staircase: false };

type Listener = (target: HoverTargetId | null) => void;
const listeners = new Set<Listener>();

function currentTarget(): HoverTargetId | null {
	for (const id of ALL_IDS) {
		if (active[id]) return id;
	}
	return null;
}

/** Scenes call this every frame with their own raycast hit-test result. */
export function setHoverTarget(id: HoverTargetId, isOver: boolean): void {
	if (active[id] === isOver) return;
	active[id] = isOver;
	const target = currentTarget();
	listeners.forEach((fn) => fn(target));
}

export function onHoverTargetChange(fn: Listener): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}