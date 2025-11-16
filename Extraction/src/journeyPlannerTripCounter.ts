// journeyPlannerTripCounter.ts

import fs from "node:fs";
import Papa from "papaparse";

// Your two edge CSVs
const edgesPaths = [
    "./out/edges_GTFS_OSLO.csv",
    "./out/edges_GTFS_ALL_FYLKER.csv",
];

// Entur Journey Planner endpoint
const ENTUR_ENDPOINT = "https://api.entur.io/journey-planner/v3/graphql";

// The specific Monday you care about
const TARGET_DATE = "2025-11-17";

// Entur wants a client header. Change this to something sane.
const ENTUR_HEADERS: Record<string, string> = {
    "Content-Type": "application/json",
    "ET-Client-Name": "tess-oslo-network-analysis/1.0", // <- change if you want
};

type EdgeRow = {
    from: string;
    to: string;
    lineId: string;
    lineCode: string;
    mode: string;
    authority: string;
    travelTimeSec: string | number;
    tripsInFeed: string | number;
    // new field we will add:
    tripsOn2025_11_17?: number;
    [key: string]: any;
};

// Fetch how many service journeys a line has on TARGET_DATE
async function fetchTripsForLineOnDate(
    lineId: string,
    date: string
): Promise<number> {
    const query = `
        query LineTrips($lineId: ID!, $date: Date!) {
          line(id: $lineId) {
            id
            journeyPatterns {
              serviceJourneysForDate(date: $date) {
                id
              }
            }
          }
        }
    `;

    const body = JSON.stringify({
        query,
        variables: { lineId, date },
    });

    try {
        const res = await fetch(ENTUR_ENDPOINT, {
            method: "POST",
            headers: ENTUR_HEADERS,
            body,
        });

        if (!res.ok) {
            console.error(`Entur HTTP error for line ${lineId}: ${res.status}`);
            return 0;
        }

        const json: any = await res.json();

        if (json.errors) {
            console.error(
                `GraphQL errors for line ${lineId}:`,
                JSON.stringify(json.errors, null, 2)
            );
            return 0;
        }

        const line = json.data?.line;
        if (!line || !Array.isArray(line.journeyPatterns)) {
            return 0;
        }

        let total = 0;
        for (const jp of line.journeyPatterns) {
            if (Array.isArray(jp.serviceJourneysForDate)) {
                total += jp.serviceJourneysForDate.length;
            }
        }

        console.log(
            `Line ${lineId}: ${total} serviceJourneysForDate on ${date}`
        );
        return total;
    } catch (err) {
        console.error(`Failed to fetch line ${lineId}:`, err);
        return 0;
    }
}

export async function journeyPlannerTripCounter() {
    // 1) Read all CSVs and collect rows
    const fileToRows = new Map<string, EdgeRow[]>();
    const uniqueLineIds = new Set<string>();

    for (const path of edgesPaths) {
        const csvText = fs.readFileSync(path, "utf8");
        const parsed = Papa.parse<EdgeRow>(csvText, {
            header: true,
            skipEmptyLines: true,
        });

        const rows: EdgeRow[] = [];
        for (const raw of parsed.data) {
            if (!raw || !raw.lineId) continue;
            rows.push(raw);
            uniqueLineIds.add(raw.lineId);
        }

        fileToRows.set(path, rows);
        console.log(`Loaded ${rows.length} edges from ${path}`);
    }

    // 2) For each unique lineId, ask Entur how many trips it has on TARGET_DATE
    const lineTrips = new Map<string, number>();
    for (const lineId of uniqueLineIds) {
        const trips = await fetchTripsForLineOnDate(lineId, TARGET_DATE);
        lineTrips.set(lineId, trips);
    }

    // 3) Add tripsOn2025_11_17 column to each row based purely on its lineId
    for (const [path, rows] of fileToRows.entries()) {
        const enriched = rows.map(row => {
            const trips = lineTrips.get(row.lineId) ?? 0;
            return {
                ...row,
                tripsOn2025_11_17: trips,
            };
        });

        const outCsv = Papa.unparse(enriched);
        const outPath = path.replace(/\.csv$/i, "_with_mondayTrips.csv");
        fs.writeFileSync(outPath, outCsv, "utf8");
        console.log(`Wrote ${enriched.length} rows to ${outPath}`);
    }

    console.log("Done enriching edges with tripsOn2025_11_17.");
}

journeyPlannerTripCounter().catch(err => {
    console.error("journeyPlannerTripCounter failed:", err);
    process.exit(1);
});
