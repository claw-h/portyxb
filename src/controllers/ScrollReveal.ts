import { clamp } from '../utils/math';

// ---------------------------------------------------------------------------
// Work row staggered reveal
// ---------------------------------------------------------------------------

export function setupHeroCopyReveal(): (() => void) | null {
    return null;
}

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