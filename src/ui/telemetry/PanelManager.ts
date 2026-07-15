// ui/telemetry/PanelManager.ts

import { InstrumentPanel } from './InstrumentPanel';
import { type PanelConfig, type TelemetryData } from './types';

export interface PanelUpdatePayload {
    x?: number;
    y?: number;
    z?: number;         // Add this
    rotationY?: number; // Add this
    opacity?: number;
    values?: TelemetryData;
}

export class PanelManager {
    private root: HTMLElement;
    private panels: Map<string, InstrumentPanel> = new Map();

    /**
     * @param rootElement The DOM container where all telemetry panels will be mounted.
     * This should ideally be a dedicated UI layer separate from the WebGL canvas.
     */
    constructor(rootElement: HTMLElement) {
        this.root = rootElement;
    }

    /**
     * Creates and registers a new InstrumentPanel based on the provided configuration.
     */
    public registerPanel(config: PanelConfig): InstrumentPanel {
        if (this.panels.has(config.id)) {
            console.warn(`PanelManager: Panel with id '${config.id}' already exists. Skipping registration.`);
            return this.panels.get(config.id)!;
        }

        const panel = new InstrumentPanel(config);
        panel.mount(this.root);
        this.panels.set(config.id, panel);
        
        // Hide by default until HeartScene explicitly updates it
        panel.hide();

        return panel;
    }

    /**
     * Updates an existing panel's position, visibility, and telemetry values.
     * This is designed to be called efficiently on every frame from the render loop.
     */
    public update(id: string, payload: PanelUpdatePayload) {
        const panel = this.panels.get(id);
        if (!panel) return;

        if (payload.x !== undefined && payload.y !== undefined ) {
            panel.setPosition(payload.x, payload.y, payload.z || 0, payload.rotationY || 0);
        }

        if (payload.opacity !== undefined) {
            panel.setOpacity(payload.opacity);
        }

        if (payload.values) {
            panel.update(payload.values);
        }
    }

    /**
     * Unmounts and destroys a specific panel.
     */
    public removePanel(id: string) {
        const panel = this.panels.get(id);
        if (panel) {
            panel.destroy();
            this.panels.delete(id);
        }
    }

    /**
     * Cleans up all panels managed by this instance.
     */
    public destroy() {
        this.panels.forEach(panel => panel.destroy());
        this.panels.clear();
    }
}