import express, { Request, Response, NextFunction } from 'express';
import axios, { AxiosError } from 'axios';
import cors from 'cors';
import { RestClient } from '@ecoflow-api/rest-client';
import {BeemGlobalDeviceStats, BeemStatsResponse} from './types';

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

app.get('/api/ecoflow-devices', async (req: Request, res: Response) => {
    try {
        const devices = await ecoflowClient.getDevicesPlain();
        console.log(devices);
        const proms = devices.data.map(device => ecoflowClient.getDevicePropertiesPlain(device.sn));
        let result = await Promise.all(proms);
        // @ts-ignore
        result = result.map((data, i) => ({...data, deviceName: devices.data[i].deviceName}));
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
    authenticateBeem();
});
