import { onHoverTargetChange } from '../utils/hoverTargets';
import { isReady } from '../utils/loadState';
import { playHoverTick, playSwoosh } from '../utils/audio';

export interface CursorController {
	destroy: () => void;
}

export function setupCursor(): CursorController | null {
	if (!window.matchMedia('(pointer: fine)').matches) return null;

	const lensCursor = document.querySelector<HTMLElement>('.lens-cursor');
	if (!lensCursor) return null;
	const heroSection = document.querySelector<HTMLElement>('[data-hero]');
	let isHeroVisible = false;

	// Initialize straight to dead center of the screen
	let mouseX = window.innerWidth / 2;
	let mouseY = window.innerHeight / 2;
	let smoothX = mouseX;
	let smoothY = mouseY;
	let frame = 0;
	let running = false;
	let isHovering = false;
	let isHeartTarget = false;

	let lastTickX = mouseX;
	let lastTickY = mouseY;
	let lastTickTime = performance.now();

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

		const now = performance.now();
		const dt = Math.max(1, now - lastTickTime);
		const dx = mouseX - lastTickX;
		const dy = mouseY - lastTickY;
		const velocity = Math.sqrt(dx * dx + dy * dy) / dt; // pixels per ms

		if (velocity > 3.0) {
			const intensity = Math.min(1.5, velocity / 3.0);
			playSwoosh(intensity);
		}

		lastTickX = mouseX;
		lastTickY = mouseY;
		lastTickTime = now;
		
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
		isHeartTarget = target === 'heart' && isHeroVisible;
		if (isHovering) {
			playHoverTick();
		}
		
		lensCursor!.classList.toggle('is-reticle', isHovering && !isHeartTarget);
		lensCursor!.classList.toggle('is-heart-reticle', isHeartTarget);
	});

	const heroVisibilityObserver = heroSection
		? new IntersectionObserver(([entry]) => {
			isHeroVisible = entry.isIntersecting;
			if (!isHeroVisible) {
				isHeartTarget = false;
				lensCursor!.classList.remove('is-heart-reticle');
				if (!isHovering || !isHeartTarget) {
					lensCursor!.classList.remove('is-reticle');
				}
			}
		}, { threshold: 0.01 })
		: null;
	heroVisibilityObserver?.observe(heroSection);

	window.addEventListener('mousemove', onMouseMove);
	document.addEventListener('visibilitychange', onVisibilityChange);
	start();

	return {
		destroy: () => {
			stop();
			window.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('visibilitychange', onVisibilityChange);
			unsubscribeHover();
			heroVisibilityObserver?.disconnect();
		}
	};
}