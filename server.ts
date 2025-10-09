import express, { Request, Response, NextFunction } from 'express';
import axios, { AxiosError } from 'axios';
import {BeemGlobalDeviceStats, BeemStatsResponse} from './types';

const app = express();
const port: number = 3000;

// --- IMPORTANT ---
// Replace with your actual Beem Energy credentials.
// For production, it is STRONGLY recommended to use environment variables
// instead of hardcoding credentials directly in the code.
const BEEM_EMAIL: string = "achautard@gmail.com";
const BEEM_PASSWORD: string = "0Onzzk4M&d%NvOj7ETSr";

const BEEM_API_BASE_URL: string = "https://api-x.beem.energy/beemapp";

let authToken: string | null = null;
let tokenExpiry: number | null = null;

/**
 * Authenticates with the Beem Energy API to get a JWT token.
 * The token is stored in memory for subsequent requests.
 */
async function authenticate(): Promise<boolean> {
    console.log("Attempting to authenticate with Beem Energy...");
    try {
        const response = await axios.post(`${BEEM_API_BASE_URL}/user/login`, {
            email: BEEM_EMAIL,
            password: BEEM_PASSWORD,
        });
        if (response.data && response.data.accessToken) {
            authToken = response.data.accessToken;
            // The token usually has an expiration, but for this simple case,
            // we will re-authenticate if the token becomes invalid.
            // A more robust solution would be to decode the JWT and check its 'exp' claim.
            tokenExpiry = new Date().getTime() + (60 * 60 * 1000); // Assume token is valid for 1 hour
            console.log("Authentication successful.");
            return true;
        }
        return false;
    } catch (error) {
        const axiosError = error as AxiosError;
        console.error("Authentication failed:", axiosError.response ? axiosError.response.data : axiosError.message);
        authToken = null;
        return false;
    }
}

/**
 * A middleware to ensure we have a valid auth token before proceeding.
 */
async function ensureAuthenticated(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
    const now = new Date().getTime();
    if (!authToken || (tokenExpiry && now >= tokenExpiry)) {
        const success = await authenticate();
        if (!success) {
            return res.status(500).json({
                error: "Could not authenticate with Beem Energy."
            });
        }
    }
    next();
}

/**
 * Fetches the energy statistics for the first available site.
 * @param {string} token The authentication token.
 */
async function fetchSolarStats(token: string): Promise<BeemGlobalDeviceStats[]> {
    try {
        const headers = {
            'Authorization': `Bearer ${token}`
        };
        const now = new Date();
        const month = now.getMonth() + 1; // getMonth() is 0-indexed
        const year = now.getFullYear();
        // This endpoint fetches the summary data seen on the energy tab.
        const response = await axios.post(`${BEEM_API_BASE_URL}/box/summary`, { month, year }, { headers});
        return response.data;
    } catch (error) {
        const axiosError = error as AxiosError;
        console.error("Failed to fetch solar stats:", axiosError.response ? axiosError.response.data : axiosError.message);
        // If the token expired, clear it to force re-authentication on the next request
        if (axiosError.response && axiosError.response.status === 401) {
            authToken = null;
            tokenExpiry = null;
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
        const headers = {
            'Authorization': `Bearer ${token}`
        };
        // This endpoint fetches the summary data seen on the energy tab.
        const response = await axios.get(`${BEEM_API_BASE_URL}/production/energy/intraday`, { params, headers});
        return response.data;
    } catch (error) {
        const axiosError = error as AxiosError;
        console.error("Failed to fetch daily solar details:", axiosError.response ? axiosError.response.data : axiosError.message);
        // If the token expired, clear it to force re-authentication on the next request
        if (axiosError.response && axiosError.response.status === 401) {
            authToken = null;
            tokenExpiry = null;
        }
        throw new Error("Could not retrieve solar stats.");
    }
}


// API endpoint to get the solar stats
app.get('/api/solar-stats', ensureAuthenticated, async (req: Request, res: Response) => {

    try {
        const stats = await fetchSolarStats(authToken as string);
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

app.get('/api/solar-daily', ensureAuthenticated, async (req: Request, res: Response) => {

    try {
        const stats = await fetchDailySolarDetails(authToken as string);
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

// Root endpoint for simple health check
app.get('/', (req: Request, res: Response) => {
    res.send('Beem Energy API server is running. Visit /api/solar-stats or /api/solar-daily to get data.');
});


app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
    // Initial authentication when the server starts
    authenticate();
});
