import type Lenis from 'lenis';

export class DiscreteScrollController {
    private lenis: Lenis;
    private snapPoints: HTMLElement[] = [];
    private currentIndex = 0;
    
    private wheelAccumulator = 0;
    private lastWheelEventTime = 0;
    private lastSnapTime = 0;

    constructor(lenis: Lenis) {
        this.lenis = lenis;
        this.init();
    }

    private init() {
        this.updateSnapPoints();
        window.addEventListener('resize', this.onResize);
        
        window.addEventListener('wheel', this.onWheel, { passive: false });
        this.lenis.options.smoothWheel = false;
        
        this.currentIndex = this.getClosestIndex(window.scrollY);
    }

    private updateSnapPoints = () => {
        this.snapPoints = Array.from(document.querySelectorAll('[data-snap-point]')) as HTMLElement[];
        this.snapPoints.sort((a, b) => this.getAbsoluteOffset(a) - this.getAbsoluteOffset(b));
    }

    private getAbsoluteOffset(el: HTMLElement): number {
        let top = 0;
        let current: HTMLElement | null = el;
        while (current) {
            top += current.offsetTop;
            current = current.offsetParent as HTMLElement;
        }
        return top;
    }
    
    private getClosestIndex(scrollY: number): number {
        if (this.snapPoints.length === 0) return 0;
        let closestIndex = 0;
        let minDiff = Infinity;
        for (let i = 0; i < this.snapPoints.length; i++) {
            const offset = this.getAbsoluteOffset(this.snapPoints[i]);
            const diff = Math.abs(offset - scrollY);
            if (diff < minDiff) {
                minDiff = diff;
                closestIndex = i;
            }
        }
        return closestIndex;
    }

    private onResize = () => {
        this.updateSnapPoints();
        this.currentIndex = this.getClosestIndex(window.scrollY);
    }

    private onWheel = (e: WheelEvent) => {
        e.preventDefault(); 

        // Ignore resting trackpad micro-events
        if (Math.abs(e.deltaY) < 2) return;

        const now = Date.now();
        
        // Hard lockout to prevent jitter, skipped scenes, and "snaps all at once"
        if (now - this.lastSnapTime < 1000) {
            this.wheelAccumulator = 0;
            return;
        }

        // Reset accumulator if the user paused scrolling
        if (now - this.lastWheelEventTime > 200) {
            this.wheelAccumulator = 0;
        }
        this.lastWheelEventTime = now;

        this.wheelAccumulator += e.deltaY;

        if (Math.abs(this.wheelAccumulator) > 50) {
            const delta = Math.sign(this.wheelAccumulator);
            
            if (delta > 0 && this.currentIndex < this.snapPoints.length - 1) {
                this.currentIndex++;
                this.scrollToCurrent();
            } else if (delta < 0 && this.currentIndex > 0) {
                this.currentIndex--;
                this.scrollToCurrent();
            }
            
            this.wheelAccumulator = 0;
            this.lastSnapTime = now;
        }
    }

    private scrollToCurrent() {
        if (!this.snapPoints[this.currentIndex]) return;
        
        this.lenis.scrollTo(this.snapPoints[this.currentIndex], {
            duration: 1.2,
            easing: (t) => 1 - Math.pow(1 - t, 4), // Smooth quartic out
            lock: true, // Ensure the animation completes smoothly without interruption from manual scroll
            force: true // FORCE interrupt if a new swipe comes in at the tail end of the easing
        });
    }

    public destroy() {
        window.removeEventListener('resize', this.onResize);
        window.removeEventListener('wheel', this.onWheel);
    }
}
