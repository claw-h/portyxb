import './BiomeUI.css';

export interface Project {
    id: string;
    title: string;
    description: string;
    featured?: boolean;
    tags?: string[];
}

export const BIOME_PROJECTS: Record<number, Project[]> = {
    0: [ // Engineer (Forest)
        { id: 'eng1', title: 'System Architecture', description: 'Deep dive into distributed systems.', featured: true, tags: ['SYS', 'DIST'] },
        { id: 'eng2', title: 'Performance Optimization', description: 'Scaling to 60fps.', tags: ['PERF'] },
        { id: 'eng3', title: 'Render Pipeline', description: 'Custom WebGL shaders.', tags: ['GL'] }
    ],
    1: [ // Writer (Canyon)
        { id: 'wri1', title: 'The Silent Epoch', description: 'A sci-fi short story.', featured: true, tags: ['FICTION'] },
        { id: 'wri2', title: 'Essays on Design', description: 'Reflections on modern UI.', tags: ['ESSAY'] }
    ],
    2: [ // Designer (City)
        { id: 'des1', title: 'Glassmorphism UI Kit', description: 'Modern interface assets.', featured: true, tags: ['UI/UX'] },
        { id: 'des2', title: 'Brand Identity', description: 'Logo and style guide.', tags: ['BRAND'] },
        { id: 'des3', title: 'Motion Graphics', description: 'Web animations.', tags: ['MOTION'] },
        { id: 'des4', title: 'Typography', description: 'Custom font pairing.', tags: ['TYPE'] }
    ],
    3: [ // The Fool (Savanna)
        { id: 'fool1', title: 'Experimental Prototypes', description: 'Just playing around.', featured: true, tags: ['EXP'] },
        { id: 'fool2', title: 'Generative Art', description: 'Algorithmic canvas experiments.', tags: ['GEN'] }
    ]
};

export class BiomeUI {
    private container: HTMLElement;
    private modal: HTMLElement;
    private titleEl: HTMLElement;
    private listEl: HTMLElement;
    private splashEl: HTMLElement;

    constructor(private parent: HTMLElement = document.body) {
        this.container = document.createElement('div');
        this.container.className = 'biome-ui-container';

        this.modal = document.createElement('div');
        this.modal.className = 'biome-modal hidden';

        // Add gears
        const gearsHTML = `
          <svg class="telemetry-gear gear--alpha" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="20" fill="none" stroke="#1f2836" stroke-width="3"/>
            <path d="M50 10 L50 20 M50 80 L50 90 M10 50 L20 50 M80 50 L90 50 M22 22 L29 29 M71 71 L78 78 M22 78 L29 71 M71 22 L78 29" stroke="#1f2836" stroke-width="6" stroke-linecap="round"/>
            <circle cx="50" cy="50" r="8" fill="#05070a"/>
          </svg>
          <svg class="telemetry-gear gear--beta" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="25" fill="none" stroke="#17202b" stroke-width="2"/>
            <path d="M50 5 L50 18 M50 82 L50 95 M5 50 L18 50 M82 50 L95 50" stroke="#17202b" stroke-width="8"/>
            <circle cx="50" cy="50" r="12" fill="#05070a"/>
          </svg>
        `;
        this.modal.innerHTML = gearsHTML;

        this.titleEl = document.createElement('h2');
        this.modal.appendChild(this.titleEl);

        this.listEl = document.createElement('div');
        this.listEl.className = 'biome-project-grid';
        this.modal.appendChild(this.listEl);

        this.container.appendChild(this.modal);

        this.splashEl = document.createElement('div');
        this.splashEl.className = 'biome-splash-modal hidden';
        this.splashEl.innerHTML = `
            <button class="biome-splash-close">CLOSE</button>
            <h1 class="splash-title"></h1>
            <p class="splash-desc"></p>
        `;

        this.splashEl.querySelector('.biome-splash-close')?.addEventListener('click', () => {
            this.closeSplash();
        });

        this.parent.appendChild(this.container);
        this.parent.appendChild(this.splashEl);
    }

    public update(biomeIndex: number, biomeName: string) {
        this.titleEl.innerText = biomeName;
        this.listEl.innerHTML = '';

        const themes = ['theme-forest', 'theme-canyon', 'theme-city', 'theme-savanna'];
        
        // Retain the hidden class if it exists, otherwise just swap the theme
        const isHidden = this.modal.classList.contains('hidden');
        this.modal.className = `biome-modal ${themes[biomeIndex]} ${isHidden ? 'hidden' : ''}`;

        const projects = BIOME_PROJECTS[biomeIndex] || [];

        projects.forEach(p => {
            const card = document.createElement('div');
            card.className = `biome-project-card ${p.featured ? 'featured' : ''}`;
            
            let tagsHTML = '';
            if (p.tags) {
                tagsHTML = `<div class="card-tags">${p.tags.map(t => `<span>${t}</span>`).join('')}</div>`;
            }

            card.innerHTML = `
                <h3 class="card-title">${p.title}</h3>
                <p class="card-desc">${p.description}</p>
                ${tagsHTML}
                <div class="card-arrow">>></div>
            `;
            
            card.addEventListener('click', () => this.openSplash(p));
            this.listEl.appendChild(card);
        });
    }

    public show() {
        this.modal.classList.remove('hidden');
    }


    private lastX = 0;
    private lastY = 0;
    private lastIntensity = 0;

    public updateTransform() {
        if (!this.modal) return;
        const rotateX = 1.5 - this.lastY * 0.5;
        const rotateY = this.lastX * 0.5;
        const translateX = this.lastX * 2;

        // Intensity adds a drop and scale
        const scale = 1.0 - this.lastIntensity * 0.2;
        const translateY = this.lastY * 2 + (this.lastIntensity * 20);

        this.modal.style.transform = `perspective(1200px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`;
    }

    public updateParallax(x: number, y: number) {
        this.lastX = x;
        this.lastY = y;
        this.updateTransform();
    }

    public setGlitch(intensity: number) {
        if (!this.modal) return;
        this.lastIntensity = intensity;
        this.updateTransform();

        // Math.max(0, 1 - intensity * 1.5) ensures the opacity hits 0 well before intensity hits 1.0.
        // At intensity=0.66, opacity=0.
        const opacity = Math.max(0, 1 - intensity * 1.5);

        if (intensity > 0) {
            this.modal.style.filter = `blur(${0.85 + intensity * 8}px) contrast(${1.15 + intensity}) saturate(${0.9 - intensity * 0.9}) sepia(${0.15 + intensity * 0.5}) hue-rotate(${intensity * 45}deg)`;
            this.modal.style.opacity = opacity.toString();
        } else {
            this.modal.style.filter = `blur(0.85px) contrast(1.15) saturate(0.9) sepia(0.15)`;
            this.modal.style.opacity = `1`;
        }
    }

    private setupSplash() {
        this.modal.classList.add('hidden');
    }

    public hide() {
        this.modal.classList.add('hidden');
    }

    public openSplash(project: Project) {
        this.hide();
        this.splashEl.querySelector('.splash-title')!.textContent = project.title;
        this.splashEl.querySelector('.splash-desc')!.textContent = project.description;
        this.splashEl.classList.remove('hidden');
    }

    public closeSplash() {
        this.splashEl.classList.add('hidden');
        this.show();
    }

    public destroy() {
        this.container.remove();
        this.splashEl.remove();
    }
}
