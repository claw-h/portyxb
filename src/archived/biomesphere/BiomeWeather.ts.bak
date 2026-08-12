import { Color, MathUtils } from 'three';

export type WeatherState = 'CLEAR' | 'OVERCAST' | 'STORM';

export const weatherTints: Record<WeatherState, { color: Color, fogMult: number }> = {
    'CLEAR': { color: new Color(0xffffff), fogMult: 1.0 },
    'OVERCAST': { color: new Color(0x9ab8d4), fogMult: 1.5 },
    'STORM': { color: new Color(0x5a6b7c), fogMult: 2.0 }
};

export class WeatherSystem {
    public currentWeather: WeatherState = 'CLEAR';
    public targetWeather: WeatherState = 'CLEAR';
    public currentWeatherTint = new Color(0xffffff);
    public targetWeatherTint = new Color(0xffffff);
    public currentFogMult = 1.0;
    public targetFogMult = 1.0;
    public lightningFlash = 0.0;
    public targetWetness = 0.0;
    public currentWetness = 0.0;
    private lastWeatherChange = 0;

    public update(time: number) {
        if (this.lastWeatherChange === 0) this.lastWeatherChange = time;
        if (time - this.lastWeatherChange > 20000) {
            this.lastWeatherChange = time;
            const states: WeatherState[] = ['CLEAR', 'OVERCAST', 'STORM'];
            this.targetWeather = states[Math.floor(Math.random() * states.length)];
            this.targetWeatherTint = weatherTints[this.targetWeather].color;
            this.targetFogMult = weatherTints[this.targetWeather].fogMult;
            this.targetWetness = this.targetWeather === 'STORM' ? 1.0 : (this.targetWeather === 'OVERCAST' ? 0.3 : 0.0);
        }
        
        this.currentWeatherTint.lerp(this.targetWeatherTint, 0.005);
        this.currentFogMult = MathUtils.lerp(this.currentFogMult, this.targetFogMult, 0.005);
        this.currentWetness = MathUtils.lerp(this.currentWetness, this.targetWetness, 0.002);

        if (this.targetWeather === 'STORM' && Math.random() < 0.005) {
            this.lightningFlash = 1.0;
        }
        this.lightningFlash = MathUtils.lerp(this.lightningFlash, 0, 0.1);
    }
}
