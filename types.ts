export interface BeemGlobalDeviceStats {
    boxId: number;
    name: string;
    lastAlive: string; // Or Date if you plan to parse it immediately
    lastProduction: string; // Or Date
    serialNumber: string;
    totalMonth: number;
    wattHour: number;
    totalDay: number;
    year: number;
    month: number;
    lastDbm: number;
    power: number;
    weather: any; // Type as 'any' or 'unknown' since it's null in the example,
                  // but could contain weather data object.
}


/**
 * Represents a single time-series measurement for a device.
 */
export interface Measure {
    startDate: string; // Or Date
    endDate: string;   // Or Date
    scale: string;
    unit: string;
    value: number;
}

/**
 * Represents a single device and contains an array of its measurements.
 */
export interface BeemDeviceMeasurement {
    deviceType: string;
    deviceId: number;
    deviceSubId: number | string | null; // Null in example, but could be number or string
    measures: Measure[];
}

/**
 * Represents the top-level API response object.
 */
export interface BeemStatsResponse {
    devices: BeemDeviceMeasurement[];
}
