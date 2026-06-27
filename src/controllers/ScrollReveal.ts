import { clamp, lerp, smoothstep } from '../utils/math';

// ---------------------------------------------------------------------------
// Hero copy scroll-driven animation
// ---------------------------------------------------------------------------

function updateHeroCopy(): void {
	const section = document.querySelector<HTMLElement>('[data-hero-copy]');
	const lineOne = document.querySelector<HTMLElement>('.hero-copy-line--one');
	const lineTwo = document.querySelector<HTMLElement>('.hero-copy-line--two');
	if (!section || !lineOne || !lineTwo) return;

	const rect = section.getBoundingClientRect();
	const viewHeight = window.innerHeight;
	const start = viewHeight * 0.30;
	const end = -viewHeight * 0.35;
	const progress = clamp((start - rect.top) / (start - end));

	const firstFadeIn = smoothstep(0.08, 0.24, progress);
	const firstFadeOut = 1 - smoothstep(0.72, 1.0, progress);
	const secondFadeIn = smoothstep(0.52, 0.84, progress);

	lineOne.style.opacity = String(firstFadeIn * firstFadeOut);
	lineOne.style.transform = `translateY(${lerp(0, -28, smoothstep(0.24, 0.58, progress))}px) scale(${lerp(0.985, 1.007, firstFadeIn)})`;
	lineTwo.style.opacity = String(secondFadeIn);
	lineTwo.style.transform = `translateY(${lerp(24, 0, secondFadeIn)}px) scale(${lerp(0.99, 1, secondFadeIn)})`;
}

export function setupHeroCopyReveal(): (() => void) | null {
	const section = document.querySelector<HTMLElement>('[data-hero-copy]');
	if (!section) return null;

	const observer = new IntersectionObserver(
		(entries, obs) => {
			entries.forEach((entry) => {
				if (entry.isIntersecting) {
					section.classList.add('is-visible');
					obs.unobserve(entry.target);
				}
			});
		},
		{ threshold: 0.24 },
	);

	observer.observe(section);
	window.addEventListener('scroll', updateHeroCopy, { passive: true });
	window.addEventListener('resize', updateHeroCopy);
	updateHeroCopy();

	return () => {
		observer.disconnect();
		window.removeEventListener('scroll', updateHeroCopy);
		window.removeEventListener('resize', updateHeroCopy);
	};
}

// ---------------------------------------------------------------------------
// Work row staggered reveal
// ---------------------------------------------------------------------------

export function setupWorkReveal(): (() => void) | null {
	const rows = document.querySelectorAll<HTMLElement>('[data-reveal]');
	if (!rows.length) return null;

	const observer = new IntersectionObserver(
		(entries) => {
			entries.forEach((entry) => {
				if (entry.isIntersecting) {
					entry.target.classList.add('is-visible');
					observer.unobserve(entry.target);
				}
			});
		},
		{ threshold: 0.24 },
	);

	rows.forEach((row, index) => {
		row.style.setProperty('--delay', `${index * 90}ms`);
		observer.observe(row);
	});

	return () => observer.disconnect();
}
