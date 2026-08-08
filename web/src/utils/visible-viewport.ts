export interface VisibleViewportMeasurement {
    innerHeight: number;
    visualHeight?: number;
    offsetTop?: number;
}

export interface VisibleViewportFrame {
    height: number;
    offsetTop: number;
}

export function resolveVisibleViewportFrame(measurement: VisibleViewportMeasurement): VisibleViewportFrame {
    const heights = [measurement.innerHeight, measurement.visualHeight].filter((value): value is number => Number.isFinite(value) && Number(value) > 0);
    const height = heights.length > 0 ? Math.max(1, Math.floor(Math.min(...heights))) : 1;
    const offsetTop = Number.isFinite(measurement.offsetTop) ? Math.max(0, Math.round(measurement.offsetTop || 0)) : 0;

    return { height, offsetTop };
}
