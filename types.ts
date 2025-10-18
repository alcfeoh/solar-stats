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
