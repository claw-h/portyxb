export interface Project {
  title: string;
  blurb: string;
  link?: string;
  thumbnail?: string;
}

export interface Category {
  id: 'engineer' | 'writer' | 'designer' | 'fool';
  label: string;
  axis: 'NE' | 'NW' | 'SE' | 'SW';
  accent: string;
  projects: Project[];
}

export const categories: Category[] = [
  {
    id: 'engineer',
    label: 'The Engineer',
    axis: 'NE',
    accent: '#4da2ff', // blue
    projects: [
      { title: 'Animus Engine', blurb: 'A bespoke WebGL renderer optimized for narrative pacing.' },
      { title: 'Void Shell', blurb: 'Data serialization layer for multi-dimensional state.' },
      { title: 'Core Protocol', blurb: 'High-frequency telemetry system for synchronization.' },
      { title: 'Memory Allocator', blurb: 'Custom GC tuning for prolonged fluid simulations.' },
      { title: 'Signal Processor', blurb: 'Real-time noise filtering for incoming artifacts.' }
    ]
  },
  {
    id: 'writer',
    label: 'The Writer',
    axis: 'NW',
    accent: '#ff4d4d', // red
    projects: [
      { title: 'The Manifesto', blurb: 'Declarations etched into the dream canvas.' },
      { title: 'Echoes of the Fall', blurb: 'A non-linear short story about the post-sync era.' },
      { title: 'Monologue 04', blurb: 'Internal dialogue scripts for the Animus AI.' },
      { title: 'Lexicon', blurb: 'Dictionary of terms used within the Biome.' }
    ]
  },
  {
    id: 'designer',
    label: 'The Designer',
    axis: 'SE',
    accent: '#4dff4d', // green
    projects: [
      { title: 'Vitruvian UI', blurb: 'Glassmorphism and CRT overlays for modern web.' },
      { title: 'Aesthetics of Void', blurb: 'Color theory and typography for deep space environments.' },
      { title: 'Vignette Systems', blurb: 'Dynamic shading techniques for edge blending.' },
      { title: 'Holographic Layouts', blurb: 'Spatial UI positioning experiments in 3D space.' }
    ]
  },
  {
    id: 'fool',
    label: 'The ƒool',
    axis: 'SW',
    accent: '#ffb84d', // yellow
    projects: [
      { title: 'Infinite Scroll', blurb: 'A journey into madness with no bottom.' },
      { title: 'Glitch Art Generator', blurb: 'Purposeful memory corruption for aesthetic output.' },
      { title: 'Paradox Engine', blurb: 'A logical loop designed to break validation systems.' },
      { title: 'Random Walk', blurb: 'Algorithmic wanderings in procedural generation.' },
      { title: 'Chaos Theory', blurb: 'Interactive pendulum simulations.' },
      { title: 'The Null Pointer', blurb: 'An ode to the void. Everything returns to nothing.' }
    ]
  }
];
