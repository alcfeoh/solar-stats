import express, { Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import axios, { AxiosError } from 'axios';
import cors from 'cors';
import { RestClient } from '@ecoflow-api/rest-client';
import { BeemGlobalDeviceStats, BeemStatsResponse, EnedisStats, PeugeotStats, TeslaChargeState, TeslaStats, WallboxStats } from './types';

const app = express();
const port: number = 3000;

app.use(cors());

// --- IMPORTANT ---
// Replace with your actual Beem Energy credentials.
const BEEM_EMAIL: string = "achautard@gmail.com";
const BEEM_PASSWORD: string = "0Onzzk4M&d%NvOj7ETSr";
const BEEM_API_BASE_URL: string = "https://api-x.beem.energy/beemapp";

// Replace with your actual Ecoflow credentials.
const ECOFLOW_ACCESS_KEY: string = "T1Ud99rruK90sPULcmlcRLsh4ItSxHlj";
const ECOFLOW_SECRET_KEY: string = "OEsaTZAfDHz66wPIqMzDWdiMyXAUd4KY";

// Replace with your actual Wallbox credentials.
const WALLBOX_EMAIL: string = "achautard@gmail.com";
const WALLBOX_PASSWORD: string = "4gEPqXXV9tn-i7.";
const WALLBOX_CHARGER_ID: string = "01HZRPJ0BWSH8QS0H6MRM6HWKM";
const WALLBOX_API_BASE_URL: string = "https://api.wall-box.com";

// Tesla OAuth Credentials
const TESLA_CLIENT_ID: string = "608deebb4e0f-4e24-99c4-d9f42d7e9027";
const TESLA_CLIENT_SECRET: string = "ta-secret.!QeLKE5I5fdI+x39";
const TESLA_REDIRECT_URI: string = "http://localhost:3000/loggedin";
// Fleet API NA: https://fleet-api.prd.na.vn.cloud.tesla.com
// Fleet API EU: https://fleet-api.prd.eu.vn.cloud.tesla.com
const TESLA_API_BASE_URL: string = "https://fleet-api.prd.na.vn.cloud.tesla.com";
const TOKEN_FILE = path.join(__dirname, 'tesla-tokens.json');

let teslaAccessToken: string | null = null;
let teslaRefreshToken: string | null = null;
let teslaTokenExpiry: number | null = null;

function saveTokens() {
    const data = {
        accessToken: teslaAccessToken,
        refreshToken: teslaRefreshToken,
        expiry: teslaTokenExpiry
    };
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2));
    console.log("Tesla tokens saved to disk.");
}

function loadTokens() {
    // 1. Check environment variable first (useful for Vercel/serverless where filesystem is ephemeral)
    if (process.env.TESLA_TOKENS_JSON) {
        try {
            const data = JSON.parse(process.env.TESLA_TOKENS_JSON);
            teslaAccessToken = data.accessToken;
            teslaRefreshToken = data.refreshToken;
            teslaTokenExpiry = data.expiry;
            console.log("Tesla tokens loaded from environment variable.");
            return;
        } catch (e) {
            console.error("Failed to parse TESLA_TOKENS_JSON env var:", e);
        }
    }

    if (process.env.TESLA_REFRESH_TOKEN) {
        teslaRefreshToken = process.env.TESLA_REFRESH_TOKEN;
        teslaAccessToken = process.env.TESLA_ACCESS_TOKEN || null;
        teslaTokenExpiry = process.env.TESLA_TOKEN_EXPIRY ? parseInt(process.env.TESLA_TOKEN_EXPIRY, 10) : null;
        console.log("Tesla tokens loaded from individual environment variables.");
        return;
    }

    // 2. Fall back to local file
    if (fs.existsSync(TOKEN_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
            teslaAccessToken = data.accessToken;
            teslaRefreshToken = data.refreshToken;
            teslaTokenExpiry = data.expiry;
            console.log("Tesla tokens loaded from disk.");
        } catch (e) {
            console.error("Failed to load Tesla tokens:", e);
        }
    }
}

async function refreshTeslaToken() {
    if (!teslaRefreshToken) {
        throw new Error("No refresh token available.");
    }
    console.log("Refreshing Tesla access token...");
    try {
        const response = await axios.post('https://auth.tesla.com/oauth2/v3/token', {
            grant_type: 'refresh_token',
            client_id: TESLA_CLIENT_ID,
            refresh_token: teslaRefreshToken,
            audience: 'https://fleet-api.prd.na.vn.cloud.tesla.com' // Ensure audience matches
        });

        teslaAccessToken = response.data.access_token;
        teslaRefreshToken = response.data.refresh_token;
        teslaTokenExpiry = new Date().getTime() + (response.data.expires_in * 1000);
        saveTokens();
        console.log("Tesla token refreshed successfully.");
    } catch (error) {
        const axiosError = error as AxiosError;
        console.error("Failed to refresh Tesla token:", axiosError.response ? axiosError.response.data : axiosError.message);
        throw error;
    }
}

const ecoflowClient = new RestClient({
    accessKey: ECOFLOW_ACCESS_KEY,
    secretKey: ECOFLOW_SECRET_KEY,
    host: "https://api-e.ecoflow.com"
});

let beemAuthToken: string | null = null;
let beemTokenExpiry: number | null = null;

async function authenticateBeem(): Promise<boolean> {
    console.log("Attempting to authenticate with Beem Energy...");
    try {
        const response = await axios.post(`${BEEM_API_BASE_URL}/user/login`, {
            email: BEEM_EMAIL,
            password: BEEM_PASSWORD,
        });
        if (response.data && response.data.accessToken) {
            beemAuthToken = response.data.accessToken;
            beemTokenExpiry = new Date().getTime() + (60 * 60 * 1000); // Assume token is valid for 1 hour
            console.log("Beem Energy authentication successful.");
            return true;
        }
        return false;
    } catch (error) {
        const axiosError = error as AxiosError;
        console.error("Beem Energy authentication failed:", axiosError.response ? axiosError.response.data : axiosError.message);
        beemAuthToken = null;
        return false;
    }
}

async function ensureBeemAuthenticated(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
    const now = new Date().getTime();
    if (!beemAuthToken || (beemTokenExpiry && now >= beemTokenExpiry)) {
        const success = await authenticateBeem();
        if (!success) {
            return res.status(500).json({ error: "Could not authenticate with Beem Energy." });
        }
    }
    next();
}

async function fetchSolarStats(token: string): Promise<BeemGlobalDeviceStats[]> {
    try {
        const headers = { 'Authorization': `Bearer ${token}` };
        const now = new Date();
        const month = now.getMonth() + 1;
        const year = now.getFullYear();
        const response = await axios.post(`${BEEM_API_BASE_URL}/box/summary`, { month, year }, { headers });
        return response.data;
    } catch (error) {
        const axiosError = error as AxiosError;
        console.error("Failed to fetch solar stats:", axiosError.response ? axiosError.response.data : axiosError.message);
        if (axiosError.response && axiosError.response.status === 401) {
            beemAuthToken = null;
            beemTokenExpiry = null;
        }
        throw new Error("Could not retrieve solar stats.");
    }
}

async function fetchDailySolarDetails(token: string): Promise<BeemStatsResponse> {
    const today = new Date();
    const params = {
        from: `${today.toISOString().split("T")[0]}T00:00:00+02:00`,
        to: `${today.toISOString().split("T")[0]}T23:59:59+02:00`,
        scale: 'PT60M'
    };
    try {
        const headers = { 'Authorization': `Bearer ${token}` };
        const response = await axios.get(`${BEEM_API_BASE_URL}/production/energy/intraday`, { params, headers });
        return response.data;
    } catch (error) {
        const axiosError = error as AxiosError;
        console.error("Failed to fetch daily solar details:", axiosError.response ? axiosError.response.data : axiosError.message);
        if (axiosError.response && axiosError.response.status === 401) {
            beemAuthToken = null;
            beemTokenExpiry = null;
        }
        throw new Error("Could not retrieve daily solar details.");
    }
}

async function fetchTeslaStats(): Promise<TeslaStats> {
    if (!teslaAccessToken && !teslaRefreshToken) {
        loadTokens();
    }

    if (!teslaAccessToken && teslaRefreshToken) {
        await refreshTeslaToken();
    }

    if (!teslaAccessToken) {
        throw new Error("Tesla not authenticated. Please visit /auth/tesla/login");
    }

    // Check expiry and refresh if needed
    const now = new Date().getTime();
    if (teslaTokenExpiry && now >= teslaTokenExpiry - (5 * 60 * 1000)) { // Refresh if within 5 minutes of expiring
        try {
            await refreshTeslaToken();
        } catch (e) {
            console.error("Token refresh failed, forcing re-login logic if needed:", e);
        }
    }

    try {
        const headers = { 'Authorization': `Bearer ${teslaAccessToken}` };

        // 1. Get the list of vehicles to find the ID of the first one
        const vehiclesResponse = await axios.get(`${TESLA_API_BASE_URL}/api/1/vehicles`, { headers });

        if (!vehiclesResponse.data.response || vehiclesResponse.data.response.length === 0) {
            throw new Error("No Tesla vehicles found associated with this token.");
        }

        const vehicle = vehiclesResponse.data.response[0];
        const vehicleId = vehicle.id_s || vehicle.id?.toString();

        // If vehicle is asleep or offline, attempt a wake-up
        if (vehicle.state === 'asleep' || vehicle.state === 'offline') {
            console.log(`Tesla vehicle is currently ${vehicle.state}. Sending wake_up command...`);
            try {
                await axios.post(`${TESLA_API_BASE_URL}/api/1/vehicles/${vehicleId}/wake_up`, {}, { headers });
            } catch (wakeErr) {
                console.warn("Tesla wake_up request encountered an issue:", wakeErr);
            }
        }

        // 2. Get charge state data: try vehicle_data first, fallback to data_request/charge_state
        let chargeState: TeslaChargeState | null = null;
        try {
            const dataResponse = await axios.get(
                `${TESLA_API_BASE_URL}/api/1/vehicles/${vehicleId}/vehicle_data?endpoints=charge_state`,
                { headers, timeout: 15000 }
            );
            if (dataResponse.data?.response?.charge_state) {
                chargeState = dataResponse.data.response.charge_state;
            }
        } catch (dataErr) {
            console.warn("Direct vehicle_data request failed, falling back to data_request/charge_state endpoint...", (dataErr as Error).message);
            const legacyChargeResponse = await axios.get(
                `${TESLA_API_BASE_URL}/api/1/vehicles/${vehicleId}/data_request/charge_state`,
                { headers, timeout: 15000 }
            );
            chargeState = legacyChargeResponse.data.response;
        }

        if (!chargeState) {
            throw new Error("Unable to retrieve Tesla charge_state from vehicle data.");
        }

        // Calculate power & wattage
        // charger_power is in kW; if 0 or unavailable but voltage and current exist, calculate: V * A
        let powerKw = chargeState.charger_power ?? 0;
        let wattage = Math.round(powerKw * 1000);
        if (wattage === 0 && chargeState.charger_voltage && chargeState.charger_actual_current) {
            wattage = Math.round(chargeState.charger_voltage * chargeState.charger_actual_current);
            powerKw = Number((wattage / 1000).toFixed(2));
        }

        const isCharging = chargeState.charging_state === 'Charging';

        return {
            batteryLevel: chargeState.battery_level,
            chargingState: chargeState.charging_state,
            isCharging: isCharging,
            chargerPowerkW: powerKw,
            chargerWattage: wattage,
            chargeRateMiles: chargeState.charge_rate ?? 0,
            timeToFullCharge: chargeState.time_to_full_charge ?? 0
        };

    } catch (error) {
        const axiosError = error as AxiosError;
        console.error("Failed to fetch Tesla stats:", axiosError.response ? axiosError.response.data : axiosError.message);
        if (axiosError.response && axiosError.response.status === 401) {
            teslaAccessToken = null; // Invalidate token on 401
        }
        throw new Error("Could not retrieve Tesla stats.");
    }
}

let wallboxAuthToken: string | null = null;
let wallboxTokenExpiry: number | null = null;

async function authenticateWallbox(): Promise<boolean> {
    console.log("Attempting to authenticate with Wallbox...");
    try {
        const authString = Buffer.from(`${WALLBOX_EMAIL}:${WALLBOX_PASSWORD}`).toString('base64');
        const response = await axios.get(`${WALLBOX_API_BASE_URL}/auth/token/user`, {
            headers: {
                'Authorization': `Basic ${authString}`
            }
        });
        if (response.data && response.data.jwt) {
            wallboxAuthToken = response.data.jwt;
            wallboxTokenExpiry = new Date().getTime() + (14 * 24 * 60 * 60 * 1000); // 14 days
            console.log("Wallbox authentication successful.");
            return true;
        }
        return false;
    } catch (error) {
        const axiosError = error as AxiosError;
        console.error("Wallbox authentication failed:", axiosError.response ? axiosError.response.data : axiosError.message);
        wallboxAuthToken = null;
        return false;
    }
}

async function ensureWallboxAuthenticated(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
    const now = new Date().getTime();
    if (!wallboxAuthToken || (wallboxTokenExpiry && now >= wallboxTokenExpiry)) {
        const success = await authenticateWallbox();
        if (!success) {
            return res.status(500).json({ error: "Could not authenticate with Wallbox." });
        }
    }
    next();
}

async function fetchWallboxStats(token: string): Promise<WallboxStats> {
    try {
        const headers = { 'Authorization': `Bearer ${token}` };
        // The groups endpoint natively supports ULID and returns rich telemetry like chargingPower and addedEnergy
        const response = await axios.get(`${WALLBOX_API_BASE_URL}/v3/chargers/groups`, { headers });
        
        let targetCharger = null;
        if (response.data && response.data.result && response.data.result.groups) {
            for (const group of response.data.result.groups) {
                if (group.chargers) {
                    const found = group.chargers.find((c: any) => c.uid === WALLBOX_CHARGER_ID || c.id.toString() === WALLBOX_CHARGER_ID.toString());
                    if (found) {
                        targetCharger = found;
                        break;
                    }
                }
            }
        }

        if (!targetCharger) {
            throw new Error(`Charger ${WALLBOX_CHARGER_ID} not found in Wallbox account.`);
        }
        
        return {
            status: targetCharger.status,
            chargingPower: targetCharger.chargingPower || targetCharger.charging_power || 0,
            addedRange: targetCharger.addedRange || targetCharger.added_range || 0,
            addedEnergy: targetCharger.addedEnergy || targetCharger.added_energy || 0,
            ...targetCharger
        };
    } catch (error) {
        const axiosError = error as AxiosError;
        console.error("Failed to fetch Wallbox stats:", axiosError.response ? axiosError.response.data : axiosError.message);
        if (axiosError.response && axiosError.response.status === 401) {
            wallboxAuthToken = null;
            wallboxTokenExpiry = null;
        }
        throw new Error("Could not retrieve Wallbox stats.");
    }
}

function getRedirectUri(req: Request): string {
    const host = req.get('host') || 'localhost:3000';
    const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
    // If running on vercel or custom domain, build URL dynamically
    if (host.includes('localhost')) {
        return 'http://localhost:3000/loggedin';
    }
    return `${proto}://${host}/loggedin`;
}

app.get('/auth/tesla/login', (req: Request, res: Response) => {
    const scopes = "openid offline_access vehicle_device_data vehicle_charging_cmds";
    const randomState = Math.random().toString(36).substring(7); // Simple random state
    const redirectUri = getRedirectUri(req);
    const authUrl = `https://auth.tesla.com/oauth2/v3/authorize?client_id=${TESLA_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${randomState}`;
    res.redirect(authUrl);
});

app.get('/loggedin', async (req: Request, res: Response) => {
    const code = req.query.code as string;
    if (!code) {
        return res.status(400).send("No code provided.");
    }

    const redirectUri = getRedirectUri(req);

    try {
        const response = await axios.post('https://auth.tesla.com/oauth2/v3/token', {
            grant_type: 'authorization_code',
            client_id: TESLA_CLIENT_ID,
            client_secret: TESLA_CLIENT_SECRET,
            code: code,
            redirect_uri: redirectUri,
            audience: 'https://fleet-api.prd.na.vn.cloud.tesla.com' // Important: Audience must match the region
        });

        teslaAccessToken = response.data.access_token;
        teslaRefreshToken = response.data.refresh_token;
        teslaTokenExpiry = new Date().getTime() + (response.data.expires_in * 1000);
        saveTokens();

        res.send("Tesla authentication successful! Tokens saved. You can now access /api/tesla-stats.");
    } catch (error) {
        const axiosError = error as AxiosError;
        console.error("Tesla token exchange failed:", axiosError.response ? axiosError.response.data : axiosError.message);
        res.status(500).json({ error: "Authentication failed. Check console for details." });
    }
});

app.get('/api/solar-stats', ensureBeemAuthenticated, async (req: Request, res: Response) => {
    try {
        const stats = await fetchSolarStats(beemAuthToken as string);
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

app.get('/api/solar-daily', ensureBeemAuthenticated, async (req: Request, res: Response) => {
    try {
        const stats = await fetchDailySolarDetails(beemAuthToken as string);
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

app.get('/api/tesla-stats', async (req: Request, res: Response) => {
    try {
        const stats = await fetchTeslaStats();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

// Peugeot / Stellantis Configuration
// Supports either:
// 1. PSA Car Controller bridge (e.g., http://localhost:5000), which directly serves get_vehicleinfo
// 2. Stellantis Connected Car API directly (with client ID / secret / access token)
const PEUGEOT_CONTROLLER_URL: string = process.env.PEUGEOT_CONTROLLER_URL || "http://localhost:5000";
const PEUGEOT_VIN: string = process.env.PEUGEOT_VIN || "";
const STELLANTIS_CLIENT_ID: string = process.env.STELLANTIS_CLIENT_ID || "";
const STELLANTIS_CLIENT_SECRET: string = process.env.STELLANTIS_CLIENT_SECRET || "";
const STELLANTIS_API_BASE_URL: string = "https://api.groupe-psa.com/applications/core/v4";
let stellantisAccessToken: string | null = process.env.STELLANTIS_ACCESS_TOKEN || null;

async function fetchPeugeotStats(): Promise<PeugeotStats> {
    // Strategy 1: Try PSA Car Controller bridge (standard for home automation & e-208 users)
    try {
        const url = PEUGEOT_VIN 
            ? `${PEUGEOT_CONTROLLER_URL}/get_vehicleinfo/${PEUGEOT_VIN}?from_cache=1`
            : `${PEUGEOT_CONTROLLER_URL}/get_vehicleinfo?from_cache=1`;
        const response = await axios.get(url, { timeout: 5000 });
        const data = response.data;

        // Data from psa_car_controller usually has energy array
        const energy = Array.isArray(data.energy) ? data.energy[0] : (data.energy || {});
        const batteryLevel = energy?.level ?? data.battery?.level ?? 0;
        const charging = energy?.charging || {};
        const chargingStatus = charging.status || (charging.plugged ? 'Plugged' : 'Disconnected');
        const isCharging = chargingStatus.toLowerCase().includes('charge') || chargingStatus.toLowerCase().includes('inprogress');
        
        // charging_rate is typically in km/h. On Peugeot e-208, ~1 km/h corresponds to ~163 Watts (approx. 6.1 km/kWh)
        const chargingRateKmH = charging.charging_rate ?? 0;
        let wattage = charging.charging_power_w ?? 0;
        if (wattage === 0 && isCharging && chargingRateKmH > 0) {
            wattage = Math.round(chargingRateKmH * 163);
        }

        return {
            batteryLevel,
            chargingState: chargingStatus,
            isCharging,
            chargerWattage: wattage,
            chargingRateKmH,
            remainingTimeMinutes: charging.remaining_time,
            plugged: charging.plugged,
            batteryAutonomyKm: energy?.autonomy
        };
    } catch (controllerErr) {
        console.warn("PSA Car Controller not reachable or returned an error:", (controllerErr as Error).message);
    }

    // Strategy 2: Try direct Stellantis Connected Car API if access token or credentials configured
    if (stellantisAccessToken && PEUGEOT_VIN) {
        try {
            const response = await axios.get(`${STELLANTIS_API_BASE_URL}/vehicles/${PEUGEOT_VIN}/status`, {
                headers: {
                    'Authorization': `Bearer ${stellantisAccessToken}`,
                    'x-client-id': STELLANTIS_CLIENT_ID
                },
                timeout: 10000
            });
            const data = response.data;
            const energy = data.energy?.[0] || {};
            const batteryLevel = energy.level ?? 0;
            const charging = energy.charging || {};
            const chargingStatus = charging.status ?? 'Unknown';
            const isCharging = chargingStatus === 'InProgress' || chargingStatus === 'Charging';
            const chargingRateKmH = charging.charging_rate ?? 0;
            const wattage = charging.charging_power ? Math.round(charging.charging_power * 1000) : (isCharging && chargingRateKmH ? Math.round(chargingRateKmH * 163) : 0);

            return {
                batteryLevel,
                chargingState: chargingStatus,
                isCharging,
                chargerWattage: wattage,
                chargingRateKmH,
                remainingTimeMinutes: charging.remaining_time,
                plugged: charging.plugged,
                batteryAutonomyKm: energy.autonomy
            };
        } catch (apiErr) {
            console.error("Direct Stellantis API call failed:", (apiErr as AxiosError).response?.data || (apiErr as Error).message);
        }
    }

    throw new Error(
        "Could not retrieve Peugeot e-208 stats. Either run psa_car_controller (default at " +
        PEUGEOT_CONTROLLER_URL + ") or configure STELLANTIS_ACCESS_TOKEN and PEUGEOT_VIN."
    );
}

app.get('/api/peugeot-stats', async (req: Request, res: Response) => {
    try {
        const stats = await fetchPeugeotStats();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

app.get('/api/wallbox-stats', ensureWallboxAuthenticated, async (req: Request, res: Response) => {
    try {
        const stats = await fetchWallboxStats(wallboxAuthToken as string);
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

app.get('/api/ecoflow-devices', async (req: Request, res: Response) => {
    try {
        const devices = await ecoflowClient.getDevicesPlain();
        console.log(devices);
        const proms = devices.data.map(device => ecoflowClient.getDevicePropertiesPlain(device.sn));
        let result = await Promise.all(proms);
        // @ts-ignore
        result = result.map((data, i) => ({ ...data, deviceName: devices.data[i].deviceName }));
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

// Enedis / MyElectricalData Configuration
const ENEDIS_TOKEN: string = process.env.ENEDIS_TOKEN || '8O4xuOOQNMDgbzCWt_hOmWkuRmZOLO7PMTyvSqxZuOU=';
const ENEDIS_PDL: string = process.env.ENEDIS_PDL || '14837626604809';
const ENEDIS_API_BASE_URL: string = 'https://www.myelectricaldata.fr';

// Cached Enedis stats to respect rate limits and Enedis API throttling (D-1 data)
let enedisCachedStats: { timestamp: number; data: EnedisStats } | null = null;

function isHeureCreuse(date: Date): boolean {
    const hour = date.getHours();
    return hour >= 22 || hour < 6;
}

function formatDate(d: Date): string {
    return d.toISOString().split('T')[0];
}

async function fetchEnedisStats(): Promise<EnedisStats> {
    const now = Date.now();
    // Cache for 30 minutes since Enedis data is historical (D-1) and API quotas are strictly limited
    if (enedisCachedStats && (now - enedisCachedStats.timestamp < 30 * 60 * 1000)) {
        return enedisCachedStats.data;
    }

    const headers = {
        'Authorization': ENEDIS_TOKEN,
        'Content-Type': 'application/json'
    };

    // 1. Verify consent and access
    let validAccess = false;
    let consentExpirationDate: string | undefined;
    try {
        const accessRes = await axios.get(`${ENEDIS_API_BASE_URL}/valid_access/${ENEDIS_PDL}`, { headers, timeout: 8000 });
        validAccess = accessRes.data?.valid === true;
        consentExpirationDate = accessRes.data?.consent_expiration_date;
    } catch (err) {
        console.warn("Enedis valid_access check failed:", (err as Error).message);
    }

    // 2. Query yesterday's date (Enedis does not provide live real-time intraday)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = formatDate(yesterday);

    let totalConsumptionWh = 0;
    let totalProductionWh = 0;
    let totalHC = 0;
    let totalHP = 0;
    let lastReading: { date: string; valueWh: number } | undefined;
    let apiError: string | undefined;

    // Daily consumption
    try {
        const consoRes = await axios.get(`${ENEDIS_API_BASE_URL}/daily_consumption/${ENEDIS_PDL}/start/${dateStr}/end/${dateStr}`, { headers, timeout: 10000 });
        const readings = consoRes.data?.meter_reading?.interval_reading || [];
        if (readings.length > 0) {
            totalConsumptionWh = Number(readings[0].value) || 0;
        }
    } catch (err: any) {
        const msg = err.response?.data?.detail || err.message;
        console.warn("Enedis daily_consumption error:", msg);
        apiError = typeof msg === 'string' ? msg : JSON.stringify(msg);
    }

    // Daily production (if applicable)
    try {
        const prodRes = await axios.get(`${ENEDIS_API_BASE_URL}/daily_production/${ENEDIS_PDL}/start/${dateStr}/end/${dateStr}`, { headers, timeout: 10000 });
        const readings = prodRes.data?.meter_reading?.interval_reading || [];
        if (readings.length > 0) {
            totalProductionWh = Number(readings[0].value) || 0;
        }
    } catch (err) {
        // 404 or technical error common if production not configured for PDL
    }

    // HP / HC curve breakdown
    try {
        const curveRes = await axios.get(`${ENEDIS_API_BASE_URL}/consumption_load_curve/${ENEDIS_PDL}/start/${dateStr}/end/${dateStr}`, { headers, timeout: 10000 });
        const readings = curveRes.data?.meter_reading?.interval_reading || [];
        for (const r of readings) {
            const val = Number(r.value) || 0;
            const rDate = new Date(r.date);
            if (isHeureCreuse(rDate)) {
                totalHC += val;
            } else {
                totalHP += val;
            }
        }
        if (readings.length > 0) {
            const last = readings[readings.length - 1];
            lastReading = {
                date: last.date,
                valueWh: Number(last.value) || 0
            };
        }
    } catch (err: any) {
        const msg = err.response?.data?.detail || err.message;
        console.warn("Enedis load curve error:", msg);
        if (!apiError) {
            apiError = typeof msg === 'string' ? msg : JSON.stringify(msg);
        }
    }

    const result: EnedisStats = {
        pdl: ENEDIS_PDL,
        validAccess,
        consentExpirationDate,
        yesterdayDate: dateStr,
        totalConsumptionWh,
        totalConsumptionKWh: Number((totalConsumptionWh / 1000).toFixed(2)),
        totalProductionWh,
        totalProductionKWh: Number((totalProductionWh / 1000).toFixed(2)),
        heuresCreusesWh: totalHC,
        heuresPleinesWh: totalHP,
        lastReading,
        ...(apiError && totalConsumptionWh === 0 ? { error: apiError } : {})
    };

    enedisCachedStats = {
        timestamp: now,
        data: result
    };

    return result;
}

app.get('/api/enedis-stats', async (req: Request, res: Response) => {
    try {
        const stats = await fetchEnedisStats();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

app.get('/.well-known/appspecific/com.tesla.3p.public-key.pem', (req: Request, res: Response) => {
    const keyPath = path.join(__dirname, '.well-known', 'appspecific', 'com.tesla.3p.public-key.pem');
    if (fs.existsSync(keyPath)) {
        res.setHeader('Content-Type', 'text/plain');
        res.sendFile(keyPath);
    } else {
        res.status(404).send('Not found');
    }
});

app.get('/', (req: Request, res: Response) => {
    res.send('API server is running.');
});

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
    loadTokens();
    authenticateBeem();
    authenticateWallbox();
});
