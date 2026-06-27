import { createLoopController, resizeCanvas } from '../utils/canvas';
import type { LoopController } from '../utils/canvas';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Beam {
	x: number;
	y: number;
	speed: number;
	length: number;
	alpha: number;
	w: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCRAMBLE_CHARS = 'A1B2C3D4E5F60789XYZ:/[]<>_';
const PHRASES = [
	'Language becomes image',
	'Data becomes structure',
	'Form becomes atmosphere',
	'Code becomes cinema',
] as const;

const BEAM_COUNT = 26;
const PHRASE_DURATION_FRAMES = 200;

// ---------------------------------------------------------------------------
// Public setup function
// ---------------------------------------------------------------------------

export function setupSignalCanvas(): LoopController | null {
	const section = document.querySelector<HTMLElement>('[data-canvas-zone="signal"]');
	const canvas = document.querySelector<HTMLCanvasElement>('[data-signal-canvas]');
	const heading = document.querySelector<HTMLElement>('[data-scramble]');

	if (!section || !canvas) return null;

	const context = canvas.getContext('2d');
	if (!context) return null;

	// Beams are reseeded on first render with real canvas dimensions
	let beams: Beam[] = [];
	let lastWidth = 0;
	let lastHeight = 0;

	let currentPhrase = 0;
	let scrambleFrame = 0;

	function seedBeams(width: number, height: number): void {
		beams = Array.from({ length: BEAM_COUNT }, () => ({
			x: Math.random() * width,
			y: Math.random() * height,
			speed: Math.random() * 8 + 4,
			length: Math.random() * 220 + 90,
			alpha: Math.random() * 0.6 + 0.2,
			w: Math.random() * 1.5 + 0.4,
		}));
	}

	const render = (): void => {
		const { width, height } = resizeCanvas(canvas, context);

		// reseed on first call or viewport change
		if (Math.abs(width - lastWidth) > 2 || Math.abs(height - lastHeight) > 2) {
			seedBeams(width, height);
			lastWidth = width;
			lastHeight = height;
		}

		context.fillStyle = 'rgba(10, 10, 12, 0.22)';
		context.fillRect(0, 0, width, height);

		beams.forEach((beam) => {
			beam.x += beam.speed;
			if (beam.x - beam.length > width) {
				beam.x = -beam.length;
				beam.y = Math.random() * height;
			}

			const gradient = context.createLinearGradient(beam.x - beam.length, beam.y, beam.x, beam.y);
			gradient.addColorStop(0, 'rgba(77, 162, 255, 0)');
			gradient.addColorStop(1, `rgba(77, 162, 255, ${beam.alpha})`);

			context.strokeStyle = gradient;
			context.lineWidth = beam.w * 2;
			context.beginPath();
			context.moveTo(beam.x - beam.length, beam.y);
			context.lineTo(beam.x, beam.y);
			context.stroke();

			// leading node glow
			context.beginPath();
			context.arc(beam.x, beam.y, beam.w * 3, 0, Math.PI * 2);
			context.fillStyle = `rgba(120, 190, 255, ${beam.alpha * 1.5})`;
			context.fill();

			// leading node core
			context.beginPath();
			context.arc(beam.x, beam.y, beam.w * 1.2, 0, Math.PI * 2);
			context.fillStyle = '#ffffff';
			context.fill();
		});

		// scramble heading
		if (heading) {
			scrambleFrame++;
			if (scrambleFrame > PHRASE_DURATION_FRAMES) {
				currentPhrase = (currentPhrase + 1) % PHRASES.length;
				heading.dataset.scramble = PHRASES[currentPhrase];
				scrambleFrame = 0;
			}

			const target = heading.dataset.scramble ?? PHRASES[0];
			const resolved = Math.floor((Math.sin(scrambleFrame * 0.02) * 0.5 + 0.5) * target.length);
			heading.textContent = target
				.split('')
				.map((letter, i) => {
					if (letter === ' ') return ' ';
					return i < resolved ? letter : SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
				})
				.join('');
		}
	};

	return createLoopController(section, render);
}
