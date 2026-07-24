// ui/telemetry/types.ts

export type ChannelType = 'meter' | 'knob' | 'digital' | 'toggle' | 'led' | 'text';

export interface BaseChannelConfig {
    id: string;
    type: ChannelType;
    label: string;
}

export interface MeterChannelConfig extends BaseChannelConfig {
    type: 'meter';
    min: number;
    max: number;
    majorStep: number;
    redlineFrom?: number;
}

export interface KnobChannelConfig extends BaseChannelConfig {
    type: 'knob';
    min: number;
    max: number;
    format?: (value: number) => string;
}

export interface DigitalChannelConfig extends BaseChannelConfig {
    type: 'digital';
    format?: (value: number) => string;
}

export interface ToggleChannelConfig extends BaseChannelConfig {
    type: 'toggle';
    onLabel: string;
    offLabel: string;
}

export interface LedChannelConfig extends BaseChannelConfig {
    type: 'led';
}

export interface TextChannelConfig extends BaseChannelConfig {
    type: 'text';
    // Optional fallback shown before any value has been pushed via update() —
    // useful for a slice panel that starts empty before the first hover.
    placeholder?: string;
}

export type ChannelConfig =
    | MeterChannelConfig
    | KnobChannelConfig
    | DigitalChannelConfig
    | ToggleChannelConfig
    | LedChannelConfig
    | TextChannelConfig;

export interface PanelConfig {
    id: string; // Unique identifier for the PanelManager
    eyebrow: string;
    title: string;
    brand: string;
    model: string;
    channels: ChannelConfig[];
    /** Optional label list rendered between the header and channels (e.g. slice names). */
    labels?: string[];
}

export type TelemetryData = Record<string, number | boolean | string>;