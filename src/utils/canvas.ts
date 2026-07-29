const prefersReducedMotion = (): boolean =>
	window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface LoopController {
	start: () => void;
	stop: () => void;
	destroy: () => void;
	resize?: () => void; // Add this line
}

export function createLoopController(
	section: Element,
	render: (time: number) => void,
): LoopController {
	let frame = 0;
	let active = false;

	const tick = (time: number): void => {
		if (!active) return;
		render(time);
		frame = requestAnimationFrame(tick);
	};

	const start = (): void => {
		if (active || prefersReducedMotion()) return;
		active = true;
		frame = requestAnimationFrame(tick);
	};

	const stop = (): void => {
		active = false;
		if (frame) cancelAnimationFrame(frame);
		frame = 0;
	};

	const observer = new IntersectionObserver(
		([entry]) => {
			if (entry.isIntersecting) start();
			else stop();
		},
		{ threshold: 0.0 }, // 0.0 means it triggers as soon as 1px is visible, and stops when 0px is visible
	);

	observer.observe(section);

	const destroy = (): void => {
		stop();
		observer.disconnect();
	};

	return { start, stop, destroy };
}

export interface CanvasSize {
	width: number;
	height: number;
	pixelRatio: number;
}

export function resizeCanvas(
	canvas: HTMLCanvasElement,
	context: CanvasRenderingContext2D,
	maxPixelRatio = 2,
): CanvasSize {
	const pixelRatio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
	const width = canvas.clientWidth;
	const height = canvas.clientHeight;
	const nextWidth = Math.floor(width * pixelRatio);
	const nextHeight = Math.floor(height * pixelRatio);

	if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
		canvas.width = nextWidth;
		canvas.height = nextHeight;
		context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
	}

	return { width, height, pixelRatio };
}
