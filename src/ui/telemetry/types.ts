// ui/telemetry/types.ts

export type ChannelType = 'meter' | 'knob' | 'digital' | 'toggle' | 'led';

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

export type ChannelConfig =
    | MeterChannelConfig
    | KnobChannelConfig
    | DigitalChannelConfig
    | ToggleChannelConfig
    | LedChannelConfig;

export interface PanelConfig {
    id: string; // Unique identifier for the PanelManager
    eyebrow: string;
    title: string;
    brand: string;
    model: string;
    channels: ChannelConfig[];
}

export type TelemetryData = Record<string, number | boolean>;