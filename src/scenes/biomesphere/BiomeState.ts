export const NUM_BIOMES = 4;
export const BIOME_NAMES = ['Engineer', 'Writer', 'Designer', 'The Fool'];

export class BiomeState {
    public currentIndex = 0;
    public targetIndex = 0;
    
    public isTransitioning = false;
    public transitionPhase: 'IDLE' | 'EXIT' | 'ENTRY' | 'FINAL_EXIT' | 'INITIAL_ENTRY' = 'IDLE';
    public transitionProgress = 0;
    public direction: 1 | -1 = 1;
    
    private listeners: (() => void)[] = [];

    public subscribe(cb: () => void) {
        this.listeners.push(cb);
    }

    private notify() {
        this.listeners.forEach(cb => cb());
    }

    public next() {
        if (this.isTransitioning) return;
        this.direction = 1;
        if (this.currentIndex === NUM_BIOMES - 1) {
            this.startFinalExit();
        } else {
            this.targetIndex = this.currentIndex + 1;
            this.startTransition();
        }
    }

    public prev() {
        if (this.isTransitioning) return;
        if (this.currentIndex === 0) return;
        this.direction = -1;
        this.targetIndex = this.currentIndex - 1;
        this.startTransition();
    }

    private startTransition() {
        this.isTransitioning = true;
        this.transitionPhase = 'EXIT';
        this.transitionProgress = 0;
        this.notify();
    }

    private startFinalExit() {
        this.isTransitioning = true;
        this.transitionPhase = 'FINAL_EXIT';
        this.transitionProgress = 0;
        this.notify();
    }

    public startInitialEntry() {
        this.isTransitioning = true;
        this.transitionPhase = 'INITIAL_ENTRY';
        this.transitionProgress = 0;
        this.notify();
    }

    public update(deltaSeconds: number) {
        if (!this.isTransitioning) return;

        if (this.transitionPhase === 'EXIT') {
            this.transitionProgress += deltaSeconds * 0.4; 
            if (this.transitionProgress >= 1.0) {
                this.transitionPhase = 'ENTRY';
                this.transitionProgress = 0;
                this.currentIndex = this.targetIndex;
                this.notify(); 
            }
        } else if (this.transitionPhase === 'ENTRY') {
            this.transitionProgress += deltaSeconds * 0.4; 
            if (this.transitionProgress >= 1.0) {
                this.transitionPhase = 'IDLE';
                this.transitionProgress = 0;
                this.isTransitioning = false;
                this.notify();
            }
        } else if (this.transitionPhase === 'FINAL_EXIT') {
            this.transitionProgress += deltaSeconds * 0.4;
            if (this.transitionProgress >= 1.0) {
                this.transitionProgress = 1.0;
                this.isTransitioning = false;
                
                // Push over to the next scene
                const voidZone = document.querySelector('.void-zone');
                if (voidZone) {
                    voidZone.scrollIntoView({ behavior: 'smooth' });
                }
                
                this.notify();
            }
        } else if (this.transitionPhase === 'INITIAL_ENTRY') {
            this.transitionProgress += deltaSeconds * 0.4;
            if (this.transitionProgress >= 1.0) {
                this.transitionPhase = 'IDLE';
                this.transitionProgress = 0;
                this.isTransitioning = false;
                this.notify();
            }
        }
    }
}
