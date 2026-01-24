import express, { Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import axios, { AxiosError } from 'axios';
import cors from 'cors';
import { RestClient } from '@ecoflow-api/rest-client';
import { BeemGlobalDeviceStats, BeemStatsResponse, TeslaChargeState, TeslaStats } from './types';

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

// Tesla OAuth Credentials
const TESLA_CLIENT_ID: string = "608deebb4e0f-4e24-99c4-d9f42d7e9027";
const TESLA_CLIENT_SECRET: string = "ta-secret.!QeLKE5I5fdI+x39";
const TESLA_REDIRECT_URI: string = "http://localhost:3000/loggedin";
// Fleet API NA: https://fleet-api.prd.na.vn.cloud.tesla.com
// Fleet API EU: https://fleet-api.prd.eu.vn.cloud.tesla.com
const TESLA_API_BASE_URL: string = "https://fleet-api.prd.eu.vn.cloud.tesla.com";
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
            audience: 'https://fleet-api.prd.eu.vn.cloud.tesla.com' // Ensure audience matches
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
            // Proceeding might fail, but let's try or just throw
        }
    }

    try {
        const headers = { 'Authorization': `Bearer ${teslaAccessToken}` };

        // 1. Get the list of vehicles to find the ID of the first one
        const vehiclesResponse = await axios.get(`${TESLA_API_BASE_URL}/api/1/vehicles`, { headers });

        if (!vehiclesResponse.data.response || vehiclesResponse.data.response.length === 0) {
            throw new Error("No Tesla vehicles found associated with this token.");
        }

        const vehicleId = vehiclesResponse.data.response[0].id_s; // Use id_s (string) to avoid precision issues

        // 2. Get charge state data
        const chargeDataResponse = await axios.get(`${TESLA_API_BASE_URL}/api/1/vehicles/${vehicleId}/data_request/charge_state`, { headers });
        const chargeState: TeslaChargeState = chargeDataResponse.data.response;

        return {
            batteryLevel: chargeState.battery_level,
            chargingState: chargeState.charging_state,
            chargeRateMiles: chargeState.charge_rate,
            chargerPowerkW: chargeState.charger_power,
            timeToFullCharge: chargeState.time_to_full_charge
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

app.get('/auth/tesla/login', (req: Request, res: Response) => {
    const scopes = "openid offline_access vehicle_device_data vehicle_charging_cmds";
    const randomState = Math.random().toString(36).substring(7); // Simple random state
    const authUrl = `https://auth.tesla.com/oauth2/v3/authorize?client_id=${TESLA_CLIENT_ID}&redirect_uri=${encodeURIComponent(TESLA_REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${randomState}`;
    res.redirect(authUrl);
});

app.get('/loggedin', async (req: Request, res: Response) => {
    const code = req.query.code as string;
    if (!code) {
        return res.status(400).send("No code provided.");
    }

    try {
        const response = await axios.post('https://auth.tesla.com/oauth2/v3/token', {
            grant_type: 'authorization_code',
            client_id: TESLA_CLIENT_ID,
            client_secret: TESLA_CLIENT_SECRET,
            code: code,
            redirect_uri: TESLA_REDIRECT_URI,
            audience: 'https://fleet-api.prd.eu.vn.cloud.tesla.com' // Important: Audience must match the region
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

app.get('/', (req: Request, res: Response) => {
    res.send('API server is running.');
});

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
    loadTokens();
    authenticateBeem();
});
