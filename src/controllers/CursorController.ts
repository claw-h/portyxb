import { onHoverTargetChange } from '../utils/hoverTargets';

export interface CursorController {
	destroy: () => void;
}

export function setupCursor(): CursorController | null {
	if (!window.matchMedia('(pointer: fine)').matches) return null;

	const lensCursor = document.querySelector<HTMLElement>('.lens-cursor');
	if (!lensCursor) return null;

	let smoothX = 0;
	let smoothY = 0;
	let mouseX = 0;
	let mouseY = 0;
	let frame = 0;
	let running = false;
	let isHovering = false;

	function tick(): void {
		if (!running) return;
		
		// 0.16 interpolation rate gives the spherical glass chassis a weighted physical slide
		smoothX += (mouseX - smoothX) * 0.16;
		smoothY += (mouseY - smoothY) * 0.16;
		
		lensCursor.style.setProperty('--cursor-x', `${mouseX}px`);
		lensCursor.style.setProperty('--cursor-y', `${mouseY}px`);
		lensCursor.style.setProperty('--lens-smooth-x', `${smoothX}px`);
		lensCursor.style.setProperty('--lens-smooth-y', `${smoothY}px`);
		
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
		
		if (!running) {
			lensCursor.style.setProperty('--cursor-x', `${mouseX}px`);
			lensCursor.style.setProperty('--cursor-y', `${mouseY}px`);
		}
	}

	function onVisibilityChange(): void {
		if (document.hidden) stop();
		else start();
	}

	const unsubscribeHover = onHoverTargetChange((target) => {
		isHovering = target !== null;
		lensCursor.classList.toggle('is-reticle', isHovering);
	});

	window.addEventListener('mousemove', onMouseMove);
	document.addEventListener('visibilitychange', onVisibilityChange);
	
	start();

	return {
		destroy: () => {
			stop();
			window.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('visibilitychange', onVisibilityChange);
			unsubscribeHover();
		}
	};
}