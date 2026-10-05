const fs = require('fs');
let content = fs.readFileSync('src/layouts/Layout.astro', 'utf8');
const replacement = `
		// FAILSAFE MOBILE OVERRIDE
		if (window.matchMedia('(max-width: 768px), (pointer: coarse)').matches) {
			document.documentElement.classList.add('is-mobile-gate');
			const style = document.createElement('style');
			style.innerHTML = \`
				.hero-sequence, .dream-zone, .hero-progress, .hero-border-svg, .lens-cursor, .scroll-prompt, .phase-nav, #heart-ui-layer { display: none !important; }
				.dossier-zone { height: 100vh !important; height: 100dvh !important; position: fixed !important; inset: 0 !important; margin: 0 !important; padding: 0 !important; z-index: 99999 !important; background: #020508 !important; overflow: hidden !important; display: block !important; transform: none !important; }
				.canvas-placeholder, #dossier-canvas { display: none !important; }
				.dossier-sticky { height: 100vh !important; height: 100dvh !important; position: absolute !important; inset: 0 !important; margin: 0 !important; padding: 0 !important; transform: none !important; display: block !important; }
				.dossier-wrapper { height: 100vh !important; height: 100dvh !important; position: absolute !important; inset: 0 !important; margin: 0 !important; padding: 0 !important; transform: none !important; display: block !important; }
				#mobile-gate { display: flex !important; flex-direction: column !important; justify-content: center !important; align-items: center !important; position: absolute !important; inset: 0 !important; margin: 0 !important; padding: 0 1.5rem !important; padding-bottom: 6rem !important; transform: none !important; }
				#mobile-gate .gate-content { margin: 0 !important; transform: translateY(-1rem) !important; }
				.dom-overlay { position: absolute !important; inset: 0 !important; z-index: 10 !important; pointer-events: none !important; }
				.dom-overlay button { pointer-events: auto !important; position: absolute !important; bottom: 2rem !important; }
			\`;
			document.head.appendChild(style);
		}
`;
content = content.replace(/\/\/ FAILSAFE MOBILE OVERRIDE[\s\S]*?document\.head\.appendChild\(style\);\n\t\t}/, replacement.trim());
fs.writeFileSync('src/layouts/Layout.astro', content);
