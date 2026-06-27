// ---------------------------------------------------------------------------
// Cursor controller
// Runs only on fine-pointer (mouse) devices.
// The ring animation is gated on document visibility to avoid burning
// rAF budget in background tabs.
// ---------------------------------------------------------------------------

export interface CursorController {
	destroy: () => void;
}

export function setupCursor(): CursorController | null {
	if (!window.matchMedia('(pointer: fine)').matches) return null;

	const dot = document.querySelector<HTMLElement>('.cursor-dot');
	const ring = document.querySelector<HTMLElement>('.cursor-ring');
	if (!dot || !ring) return null;

	let ringX = 0;
	let ringY = 0;
	let mouseX = 0;
	let mouseY = 0;
	let frame = 0;
	let running = false;

	function tick(): void {
		if (!running) return;
		ringX += (mouseX - ringX) * 0.18;
		ringY += (mouseY - ringY) * 0.18;
		ring.style.transform = `translate(${ringX}px, ${ringY}px)`;
		frame = requestAnimationFrame(tick);
	}

	function start(): void {
		if (running) return;
		running = true;
		frame = requestAnimationFrame(tick);
	}

	function stop(): void {
		running = false;
		if (frame) cancelAnimationFrame(frame);
		frame = 0;
	}

	function onMouseMove(event: MouseEvent): void {
		mouseX = event.clientX;
		mouseY = event.clientY;
		dot.style.transform = `translate(${mouseX}px, ${mouseY}px)`;
	}

	function onVisibilityChange(): void {
		if (document.hidden) stop();
		else start();
	}

	window.addEventListener('mousemove', onMouseMove);
	document.addEventListener('visibilitychange', onVisibilityChange);
	document.documentElement.classList.add('has-custom-cursor');
	start();

	return {
		destroy: () => {
			stop();
			window.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('visibilitychange', onVisibilityChange);
			document.documentElement.classList.remove('has-custom-cursor');
		},
	};
}
