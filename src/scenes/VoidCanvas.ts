import { clamp } from '../utils/math';
import { createLoopController, resizeCanvas } from '../utils/canvas';
import type { LoopController } from '../utils/canvas';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DustParticle {
	x: number;
	y: number;
	z: number;
	radius: number;
	speed: number;
	drift: number;
	alpha: number;
}

interface Streak {
	x: number;
	y: number;
	z: number;
	length: number;
	speed: number;
	angle: number;
	alpha: number;
}

interface VectorStream {
	x: number;
	y: number;
	length: number;
	speed: number;
	angle: number;
	alpha: number;
	width: number;
	phase: number;
}

interface Quality {
	maxPixelRatio: number;
	dustCount: number;
	streakCount: number;
	vectorCount: number;
	scanStep: number;
	speedFactor: number;
}

// ---------------------------------------------------------------------------
// Quality tiers
// ---------------------------------------------------------------------------

function getQuality(compact: boolean): Quality {
	return compact
		? { maxPixelRatio: 1.4, dustCount: 120, streakCount: 22, vectorCount: 8, scanStep: 6, speedFactor: 0.82 }
		: { maxPixelRatio: 2, dustCount: 180, streakCount: 30, vectorCount: 14, scanStep: 4, speedFactor: 1 };
}

// ---------------------------------------------------------------------------
// Field seeding
// ---------------------------------------------------------------------------

interface Field {
	dust: DustParticle[];
	streaks: Streak[];
	vectorStreams: VectorStream[];
	width: number;
	height: number;
}

function seedField(width: number, height: number, quality: Quality): Field {
	return {
		width,
		height,
		dust: Array.from({ length: quality.dustCount }, () => ({
			x: Math.random() * width,
			y: Math.random() * height,
			z: Math.random() * 0.9 + 0.1,
			radius: Math.random() * 1.9 + 0.25,
			speed: Math.random() * 0.42 + 0.08,
			drift: (Math.random() - 0.5) * 0.18,
			alpha: Math.random() * 0.5 + 0.08,
		})),
		streaks: Array.from({ length: quality.streakCount }, () => ({
			x: Math.random() * width,
			y: Math.random() * height,
			z: Math.random() * 0.8 + 0.2,
			length: Math.random() * 170 + 60,
			speed: Math.random() * 3.2 + 0.8,
			angle: -Math.PI / 2 + (Math.random() - 0.5) * 0.22,
			alpha: Math.random() * 0.36 + 0.08,
		})),
		vectorStreams: Array.from({ length: quality.vectorCount }, () => ({
			x: Math.random() * width,
			y: Math.random() * height,
			length: Math.random() * 140 + 90,
			speed: Math.random() * 0.8 + 0.4,
			angle: Math.PI / 3 + (Math.random() - 0.5) * 0.36,
			alpha: Math.random() * 0.18 + 0.1,
			width: Math.random() * 1.7 + 0.8,
			phase: Math.random() * Math.PI * 2,
		})),
	};
}

// ---------------------------------------------------------------------------
// Public setup function
// ---------------------------------------------------------------------------

export function setupVoidCanvas(): LoopController | null {
	const section = document.querySelector<HTMLElement>('[data-canvas-zone="void"]');
	const canvas = document.querySelector<HTMLCanvasElement>('[data-void-canvas]');
	if (!section || !canvas) return null;

	const context = canvas.getContext('2d');
	if (!context) return null;

	const hasFinePointer = window.matchMedia('(pointer: fine)').matches;
	const isCompact = () => window.innerWidth < 900 || !hasFinePointer;

	let field: Field = seedField(0, 0, getQuality(isCompact()));
	const pointer = { x: 0.5, y: 0.5 };
	let sectionRect = section.getBoundingClientRect();

	// ---------------------------------------------------------------------------
	// Pointer tracking
	// ---------------------------------------------------------------------------

	function onMouseMove(event: MouseEvent): void {
		pointer.x = (event.clientX - sectionRect.left) / Math.max(sectionRect.width, 1);
		pointer.y = (event.clientY - sectionRect.top) / Math.max(sectionRect.height, 1);
		section.style.setProperty('--mouse-x', `${event.clientX - sectionRect.left}px`);
		section.style.setProperty('--mouse-y', `${event.clientY - sectionRect.top}px`);
		const intensity = clamp(1 - Math.abs(pointer.x - 0.5) * 1.1 - Math.abs(pointer.y - 0.5) * 0.4, 0.18, 1);
		section.style.setProperty('--phosphor-intensity', String(intensity));
		section.style.setProperty('--phosphor-offset-x', `${(pointer.x - 0.5) * 16}%`);
		section.style.setProperty('--phosphor-offset-y', `${(pointer.y - 0.5) * 10}%`);
	}

	function onResize(): void {
		sectionRect = section.getBoundingClientRect();
	}

	if (hasFinePointer) {
		section.addEventListener('mousemove', onMouseMove);
	} else {
		section.style.setProperty('--mouse-x', '50%');
		section.style.setProperty('--mouse-y', '50%');
		section.style.setProperty('--phosphor-intensity', '0.28');
		section.style.setProperty('--phosphor-offset-x', '0%');
		section.style.setProperty('--phosphor-offset-y', '0%');
	}

	window.addEventListener('resize', onResize);

	// ---------------------------------------------------------------------------
	// Render loop
	// ---------------------------------------------------------------------------

	const render = (time: number): void => {
		const compact = isCompact();
		const quality = getQuality(compact);
		const size = resizeCanvas(canvas, context, quality.maxPixelRatio);
		const { width, height } = size;

		if (Math.abs(width - field.width) > 2 || Math.abs(height - field.height) > 2) {
			field = seedField(width, height, quality);
		}

		// background
		context.globalCompositeOperation = 'source-over';
		context.fillStyle = 'rgba(3, 5, 10, 0.18)';
		context.fillRect(0, 0, width, height);

		// bloom
		const bloom = context.createRadialGradient(
			width * (0.45 + (pointer.x - 0.5) * 0.08),
			height * (0.36 + (pointer.y - 0.5) * 0.08),
			12,
			width * 0.5,
			height * 0.42,
			Math.max(width, height) * 0.62,
		);
		bloom.addColorStop(0, 'rgba(97, 167, 255, 0.14)');
		bloom.addColorStop(0.4, 'rgba(18, 32, 58, 0.08)');
		bloom.addColorStop(1, 'rgba(0, 0, 0, 0)');
		context.fillStyle = bloom;
		context.fillRect(0, 0, width, height);

		// scanlines
		context.fillStyle = `rgba(255, 255, 255, ${compact ? 0.03 : 0.055})`;
		for (let y = 0; y < height; y += quality.scanStep) {
			context.fillRect(0, y, width, 1);
		}

		// streaks
		context.globalCompositeOperation = 'lighter';
		field.streaks.forEach((streak) => {
			const parallax = (streak.z - 0.5) * 42;
			streak.y += streak.speed * (0.8 + streak.z) * quality.speedFactor;
			streak.x += Math.cos(streak.angle) * streak.speed * 0.42 * quality.speedFactor + (pointer.x - 0.5) * streak.z * 0.9;

			if (streak.y - streak.length > height + 80) {
				streak.y = -Math.random() * 180;
				streak.x = Math.random() * width;
			}

			const x1 = streak.x + parallax;
			const y1 = streak.y;
			const x2 = x1 + Math.cos(streak.angle) * streak.length;
			const y2 = y1 + Math.sin(streak.angle) * streak.length;
			const gradient = context.createLinearGradient(x2, y2, x1, y1);
			gradient.addColorStop(0, 'rgba(77, 162, 255, 0)');
			gradient.addColorStop(0.72, `rgba(77, 162, 255, ${streak.alpha})`);
			gradient.addColorStop(1, `rgba(225, 242, 255, ${streak.alpha * 0.62})`);
			context.strokeStyle = gradient;
			context.lineWidth = 0.6 + streak.z * 2.6;
			context.beginPath();
			context.moveTo(x2, y2);
			context.lineTo(x1, y1);
			context.stroke();
		});

		// vector streams
		field.vectorStreams.forEach((stream) => {
			stream.y += stream.speed * quality.speedFactor;
			stream.x += Math.cos(stream.angle + stream.phase) * stream.speed * 0.18;
			if (stream.y - stream.length > height + 60) {
				stream.y = -Math.random() * 120;
				stream.x = Math.random() * width;
			}

			const x1 = stream.x;
			const y1 = stream.y;
			const x2 = x1 + Math.cos(stream.angle) * stream.length;
			const y2 = y1 + Math.sin(stream.angle) * stream.length;
			const glow = context.createLinearGradient(x1, y1, x2, y2);
			glow.addColorStop(0, `rgba(133, 207, 255, ${stream.alpha * 0.18})`);
			glow.addColorStop(0.4, `rgba(173, 242, 255, ${stream.alpha * 0.38})`);
			glow.addColorStop(0.8, `rgba(112, 228, 255, ${stream.alpha * 0.18})`);
			glow.addColorStop(1, 'rgba(77, 162, 255, 0)');
			context.strokeStyle = glow;
			context.lineWidth = stream.width;
			context.setLineDash([18, 24]);
			context.lineDashOffset = (time * 0.03 + stream.phase) * 0.5;
			context.beginPath();
			context.moveTo(x1, y1);
			context.lineTo(x2, y2);
			context.stroke();
			context.setLineDash([]);

			context.fillStyle = `rgba(255, 255, 255, ${stream.alpha * 0.22})`;
			context.beginPath();
			context.arc(x1, y1, stream.width * 1.8, 0, Math.PI * 2);
			context.fill();
		});

		// dust
		field.dust.forEach((particle) => {
			particle.y += particle.speed * (0.7 + particle.z) * quality.speedFactor;
			if (particle.y > height + 12) {
				particle.y = -12;
				particle.x = Math.random() * width;
			}
			const focus = 1 - Math.hypot(particle.x / width - pointer.x, particle.y / height - pointer.y);
			const alpha = particle.alpha * clamp(focus, 0.22, 1);
			context.fillStyle = `rgba(225, 242, 255, ${alpha})`;
			context.beginPath();
			context.arc(particle.x, particle.y, particle.radius * (0.7 + particle.z), 0, Math.PI * 2);
			context.fill();
		});

		// static grain
		context.globalCompositeOperation = 'source-over';
		context.fillStyle = `rgba(255, 255, 255, ${0.018 + Math.sin(time * 0.002) * 0.006})`;
		for (let i = 0; i < 80; i++) {
			const x = (Math.sin(i * 97.13 + time * 0.0002) * 0.5 + 0.5) * width;
			const y = (Math.cos(i * 43.71 + time * 0.00017) * 0.5 + 0.5) * height;
			context.fillRect(x, y, 1, 1);
		}
	};

	const controller = createLoopController(section, render);

	return {
		...controller,
		destroy: () => {
			controller.destroy();
			if (hasFinePointer) section.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('resize', onResize);
		},
	};
}
