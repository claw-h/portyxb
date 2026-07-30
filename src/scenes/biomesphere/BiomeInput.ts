import { BiomeState } from './BiomeState';

export function setupBiomeInput(state: BiomeState) {
    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'w' || e.key === 'W') {
            state.next();
        } else if (e.key === 's' || e.key === 'S') {
            state.prev();
        }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
        window.removeEventListener('keydown', onKeyDown);
    };
}
