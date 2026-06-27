export const clamp = (value: number, min = 0, max = 1): number =>
	Math.min(Math.max(value, min), max);

export const lerp = (start: number, end: number, progress: number): number =>
	start + (end - start) * progress;

export const smoothstep = (edge0: number, edge1: number, value: number): number => {
	const t = clamp((value - edge0) / (edge1 - edge0));
	return t * t * (3 - 2 * t);
};
