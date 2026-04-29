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
    chargeRateMiles: number;
    chargerPowerkW: number;
    timeToFullCharge: number;
}

export interface WallboxStats {
    status: number;
    chargingPower: number;
    addedRange: number;
    addedEnergy: number;
    [key: string]: any;
}
