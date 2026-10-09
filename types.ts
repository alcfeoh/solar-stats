export interface BeemEnergyData {
    value: number;
    unit: string;
    quality: string;
}

export interface BeemStats {
    [key: string]: BeemEnergyData;
}

export interface BeemStatsResponse {
    [key: string]: BeemStats;
}

export interface BeemGlobalDeviceStats {
    last_production_value: number;
    today_production_value: number;
    month_production_value: number;
    year_production_value: number;
    total_production_value: number;
    power_unit: string;
    energy_unit: string;
}

export interface BeemDeviceYesterday {
    boxId: number;
    name: string;
    productionWh: number;
    productionKWh: number;
}

export interface BeemYesterdayStats {
    date: string;
    totalProductionWh: number;
    totalProductionKWh: number;
    devices: BeemDeviceYesterday[];
    intraday?: any;
}

export interface TeslaChargeState {
    battery_level: number;
    charging_state: string; // "Disconnected", "Charging", "Stopped", "Complete"
    charge_energy_added: number;
    charge_miles_added_rated: number;
    charge_rate: number; // Miles per hour
    charger_power: number; // kW
    charger_voltage: number;
    charger_actual_current: number;
    time_to_full_charge: number;
}

export interface TeslaStats {
    batteryLevel: number;
    chargingState: string;
    isCharging: boolean;
    chargerPowerkW: number;
    chargerWattage: number;
    chargeRateMiles: number;
    timeToFullCharge: number;
}

export interface PeugeotStats {
    batteryLevel: number;
    chargingState: string;
    isCharging: boolean;
    chargerWattage: number;
    chargingRateKmH?: number;
    remainingTimeMinutes?: number;
    plugged?: boolean;
    batteryAutonomyKm?: number;
}

export interface WallboxStats {
    status: number;
    chargingPower: number;
    addedRange: number;
    addedEnergy: number;
    [key: string]: any;
}

export interface EnedisStats {
    pdl: string;
    validAccess: boolean;
    consentExpirationDate?: string;
    yesterdayDate?: string;
    totalConsumptionWh?: number;
    totalConsumptionKWh?: number;
    totalProductionWh?: number;
    totalProductionKWh?: number;
    heuresCreusesWh?: number;
    heuresPleinesWh?: number;
    lastReading?: {
        date: string;
        valueWh: number;
    };
    error?: string;
}

