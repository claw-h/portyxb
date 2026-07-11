import { onHoverTargetChange } from '../utils/hoverTargets';
import { isReady } from '../utils/loadState';

export interface CursorController {
	destroy: () => void;
}

export function setupCursor(): CursorController | null {
	if (!window.matchMedia('(pointer: fine)').matches) return null;

	const lensCursor = document.querySelector<HTMLElement>('.lens-cursor');
	if (!lensCursor) return null;

	// Initialize straight to dead center of the screen
	let mouseX = window.innerWidth / 2;
	let mouseY = window.innerHeight / 2;
	let smoothX = mouseX;
	let smoothY = mouseY;
	let frame = 0;
	let running = false;
	let isHovering = false;
	let isHeartTarget = false;

	// DOM Elements
	const coordsElement = document.getElementById('cursor-coords');
	const focalCharElement = document.getElementById('focal-char');
	
	// Character Array & Counters
	const chars = ['A', 'α', 'А', 'א', 'ا', 'अ', '가', 'ア', '一', 'ᚠ', '𒀀', '𓀀'];
	let charIndex = 0;
	let frameCount = 0;

	function tick(): void {
		if (!running) return;

		// DEV LOCK: Trap the cursor at dead center until preloader clears
		if (!isReady()) {
			mouseX = window.innerWidth / 2;
			mouseY = window.innerHeight / 2;
		}
		
		smoothX += (mouseX - smoothX) * 0.16;
		smoothY += (mouseY - smoothY) * 0.16;
		
		lensCursor!.style.setProperty('--cursor-x', `${mouseX}px`);
		lensCursor!.style.setProperty('--cursor-y', `${mouseY}px`);
		lensCursor!.style.setProperty('--lens-smooth-x', `${smoothX}px`);
		lensCursor!.style.setProperty('--lens-smooth-y', `${smoothY}px`);
		
		// Live Data Injection
		if (isHeartTarget && coordsElement) {
			coordsElement.textContent = `(${Math.round(mouseX)}, ${Math.round(mouseY)})`;
		}

		// Multilingual Rapid-Fire Focal Point
		if (focalCharElement) {
			frameCount++;
			if (frameCount % 4 === 0) {
				charIndex = (charIndex + 1) % chars.length;
				focalCharElement.textContent = chars[charIndex];
			}
		}
		
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
		// Only accept physical mouse updates if the site is ready
		if (isReady()) {
			mouseX = event.clientX;
			mouseY = event.clientY;
		}
		
		if (!running) {
			lensCursor!.style.setProperty('--cursor-x', `${mouseX}px`);
			lensCursor!.style.setProperty('--cursor-y', `${mouseY}px`);
		}
	}

	function onVisibilityChange(): void {
		if (document.hidden) stop();
		else start();
	}

	const unsubscribeHover = onHoverTargetChange((target) => {
		isHovering = target !== null;
		isHeartTarget = target === 'heart';
		
		lensCursor!.classList.toggle('is-reticle', isHovering && !isHeartTarget);
		lensCursor!.classList.toggle('is-heart-reticle', isHeartTarget);
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