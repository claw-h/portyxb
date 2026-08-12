type EasingFunction = (t: number) => number;

export const Easing = {
  easeOutCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  easeOutExpo: (t: number) => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
  easeOutBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  easeOutElastic: (t: number) => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  }
};

export interface TweenOptions {
  from: number;
  to: number;
  duration: number; // ms
  easing?: EasingFunction;
  onUpdate: (val: number) => void;
  onComplete?: () => void;
}

export class TweenManager {
  private tweens: Set<{
    start: number, 
    opts: TweenOptions,
    completed: boolean
  }> = new Set();

  public to(opts: TweenOptions) {
    this.tweens.add({
      start: performance.now(),
      opts,
      completed: false
    });
  }

  public update(timeNow: number) {
    this.tweens.forEach(tween => {
      if (tween.completed) return;
      
      const elapsed = timeNow - tween.start;
      const progress = Math.min(elapsed / tween.opts.duration, 1);
      const easeFn = tween.opts.easing || Easing.easeOutCubic;
      
      const easedProgress = easeFn(progress);
      const currentVal = tween.opts.from + (tween.opts.to - tween.opts.from) * easedProgress;
      
      tween.opts.onUpdate(currentVal);
      
      if (progress >= 1) {
        tween.completed = true;
        if (tween.opts.onComplete) tween.opts.onComplete();
        this.tweens.delete(tween);
      }
    });
  }
}

export const tweenManager = new TweenManager();
