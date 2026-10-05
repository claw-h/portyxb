const fs = require('fs');
let content = fs.readFileSync('src/layouts/Layout.astro', 'utf8');
const replacement = `
		// FAILSAFE MOBILE OVERRIDE
		// Injected synchronously to bypass dev-server HMR caching issues and module script crashes.
		if (window.matchMedia('(max-width: 768px), (pointer: coarse)').matches) {
			document.documentElement.classList.add('is-mobile-gate');
			const style = document.createElement('style');
			style.innerHTML = \`
				.hero-sequence, .dream-zone, .hero-progress, .hero-border-svg, .lens-cursor, .scroll-prompt, .phase-nav, #heart-ui-layer { display: none !important; }
				.dossier-zone { height: 100vh !important; height: 100dvh !important; position: fixed !important; inset: 0 !important; margin: 0 !important; z-index: 99999 !important; background: #020508 !important; overflow: hidden !important; display: block !important; transform: none !important; }
				.canvas-placeholder, #dossier-canvas { display: none !important; }
				.dossier-sticky { height: 100vh !important; height: 100dvh !important; position: absolute !important; inset: 0 !important; transform: none !important; }
				.dossier-wrapper { height: 100vh !important; height: 100dvh !important; position: absolute !important; inset: 0 !important; transform: none !important; }
				#mobile-gate { display: flex !important; position: absolute !important; inset: 0 !important; transform: none !important; }
			\`;
			document.head.appendChild(style);
			
			// Double failsafe: aggressively remove inline heights that might interfere
			window.addEventListener('DOMContentLoaded', () => {
				const dz = document.querySelector('.dossier-zone');
				if (dz) dz.style.height = '100dvh';
			});
		}
`;
content = content.replace(/\/\/ FAILSAFE MOBILE OVERRIDE[\s\S]*?document\.head\.appendChild\(style\);\n\t\t}/, replacement.trim());
fs.writeFileSync('src/layouts/Layout.astro', content);
