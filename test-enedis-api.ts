import axios from 'axios';

// ------------------------------------------------------------------
// CONFIGURATION
// 1. Allez sur https://www.myelectricaldata.fr/ pour créer un compte et lier votre Linky.
// 2. Récupérez votre token sur le tableau de bord.
// 3. Récupérez votre PDL (Point de Livraison) sur votre facture ou compteur (14 chiffres).
// ------------------------------------------------------------------

const TOKEN = '8O4xuOOQNMDgbzCWt_hOmWkuRmZOLO7PMTyvSqxZuOU=';
const PDL = '14837626604809';

// Dates pour le test (format YYYY-MM-DD)
// Attention: les données ne sont pas dispo pour le jour même.
const START_DATE = '2026-01-23';
const END_DATE = '2026-01-23';

// 0) Vérification de l'accès et du consentement
async function checkAccess() {
    console.log(`\n0️⃣  Vérification de l'accès pour le PDL ${PDL}...`);
    const url = `https://www.myelectricaldata.fr/valid_access/${PDL}`;
    try {
        const response = await axios.get(url, { headers: { 'Authorization': TOKEN } });
        console.log("   ✅ Accès Valide !");
        console.log("   Information Contrat:", JSON.stringify(response.data, null, 2));
        return true;
    } catch (error: any) {
        console.error('   ❌ Erreur Accès:', error.message);
        if (error.response) {
            console.error("      Status:", error.response.status);
            console.error("      Data:", JSON.stringify(error.response.data, null, 2));
        }
        return false;
    }
}

// Helper to check if a specific time is "Heures Creuses" (Off-Peak)
// MODIFY THIS based on your contract (e.g., here assumed 22h-06h)
function isHeureCreuse(date: Date): boolean {
    const hour = date.getHours();
    return hour >= 22 || hour < 6;
}

// 1) Consommation Heures Pleines / Heures Creuses
async function getConsumptionHpHc(dateStr: string) {
    console.log(`\n1️⃣  Calcul Conso HP/HC pour le ${dateStr}...`);
    const url = `https://www.myelectricaldata.fr/consumption_load_curve/${PDL}/start/${dateStr}/end/${dateStr}`;

    try {
        const response = await axios.get(url, {
            headers: { 'Authorization': TOKEN, 'Content-Type': 'application/json' }
        });

        const readings = response.data.meter_reading?.interval_reading || [];
        let totalHC = 0;
        let totalHP = 0;

        for (const reading of readings) {
            // interval_reading has "date" (string) and "value" (string or number)
            // format date: "2026-01-01 00:30:00"
            const readingDate = new Date(reading.date);
            const value = Number(reading.value); // Wh

            if (isHeureCreuse(readingDate)) {
                totalHC += value;
            } else {
                totalHP += value;
            }
        }

        console.log(`   - Heures Creuses (HC): ${totalHC} Wh (${(totalHC / 1000).toFixed(2)} kWh)`);
        console.log(`   - Heures Pleines (HP): ${totalHP} Wh (${(totalHP / 1000).toFixed(2)} kWh)`);
        return { hc: totalHC, hp: totalHP };

    } catch (error: any) {
        console.error('   ❌ Erreur HP/HC:', error.message);
        if (error.response) {
            console.error("      Status:", error.response.status);
            console.error("      Data:", JSON.stringify(error.response.data, null, 2));
        }
        return null;
    }
}

// 2) Consommation et Production Totale
async function getDailyTotals(dateStr: string) {
    console.log(`\n2️⃣  Totaux Conso & Production pour le ${dateStr}...`);

    // We try to fetch daily summaries. 
    // Note: Production endpoint support depends on your account/contract setup in MyElectricalData.
    const urlConso = `https://www.myelectricaldata.fr/daily_consumption/${PDL}/start/${dateStr}/end/${dateStr}`;
    const urlProd = `https://www.myelectricaldata.fr/daily_production/${PDL}/start/${dateStr}/end/${dateStr}`;

    let consumption = 0;
    let production = 0;

    // Fetch Consumption
    try {
        const resConso = await axios.get(urlConso, { headers: { 'Authorization': TOKEN } });
        // The API returns an interval_reading array even for daily endpoints
        const readings = resConso.data.meter_reading?.interval_reading || [];
        if (readings.length > 0) {
            consumption = Number(readings[0].value);
        }
        console.log(`   - Consommation Totale: ${consumption} Wh (${(consumption / 1000).toFixed(2)} kWh)`);
    } catch (error: any) {
        console.error('   ⚠️ Erreur Conso Totale:', error.message);
        if (error.response) console.error("      Data:", JSON.stringify(error.response.data, null, 2));
    }

    // Fetch Production
    try {
        const resProd = await axios.get(urlProd, { headers: { 'Authorization': TOKEN } });
        const readings = resProd.data.meter_reading?.interval_reading || [];
        if (readings.length > 0) {
            production = Number(readings[0].value);
        }
        console.log(`   - Production Totale:   ${production} Wh (${(production / 1000).toFixed(2)} kWh)`);
    } catch (error: any) {
        // 404 is common if no production data or not a producer
        if (error.response?.status === 404) {
            console.log('   - Production Totale:   N/A (Non disponible ou pas de production)');
        } else {
            console.error('   ⚠️ Erreur Prod Totale:', error.message);
            if (error.response) console.error("      Data:", JSON.stringify(error.response.data, null, 2));
        }
    }

    return { consumption, production };
}

// 3) Consommation Courante (Dernière connue)
async function getCurrentConsumption() {
    console.log(`\n3️⃣  Consommation Courante (Dernière valeur connue)...`);
    // NOTE: Real-time is NOT available via Enedis/Linky public API. 
    // Data is usually D-1 (yesterday). We will fetch the LOAD CURVE of the "END_DATE" provided.

    const url = `https://www.myelectricaldata.fr/consumption_load_curve/${PDL}/start/${END_DATE}/end/${END_DATE}`;

    try {
        const response = await axios.get(url, { headers: { 'Authorization': TOKEN } });
        const readings = response.data.meter_reading?.interval_reading || [];

        if (readings.length === 0) {
            console.log("   ⚠️ Aucune donnée disponible pour la date de fin.");
            return;
        }

        // Get the last entry
        const lastReading = readings[readings.length - 1];
        console.log(`   - Dernière relève: ${lastReading.date}`);
        console.log(`   - Valeur (30min):  ${lastReading.value} Wh`);
        console.log(`   ℹ️ INFO: C'est une valeur passée, pas du temps réel (Limitations Enedis).`);

        return lastReading;

    } catch (error: any) {
        console.error('   ❌ Erreur Conso Courante:', error.message);
        if (error.response) {
            console.error("      Status:", error.response.status);
            console.error("      Data:", JSON.stringify(error.response.data, null, 2));
        }
    }
}


async function main() {
    console.log('--- DÉBUT DES TESTS SOLAR STATS ---\n');

    // Test 0: Check Access
    const accessOk = await checkAccess();
    if (!accessOk) {
        console.log("\n🛑 ABANDON : L'accès n'est pas valide (vérifiez Token/PDL ou Consentement).");
        return;
    }

    // Test 1: HP/HC for one specific day (e.g. START_DATE)
    await getConsumptionHpHc(START_DATE);

    // Test 2: Totals for that same day
    await getDailyTotals(START_DATE);

    // Test 3: "Current" consumption (last available on END_DATE)
    await getCurrentConsumption();

    console.log('\n--- FIN ---');
}

main();
