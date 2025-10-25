import { enturClient } from "./client.js";
import {
    Q_AUTHORITIES,
    Q_NEAREST_STOPPLACES,
    Q_EST_CALLS_BY_STOPPLACE
} from "./queries.js";
import pRetry from "p-retry";
import Papa from "papaparse";
import fs from "node:fs";

// -------------------------------
// Config
// -------------------------------

// Live window: grab enough of the day to see traffic
const TIMERANGE_SEC = 24 * 3600;
const N_DEPS = 120;               // per stop, reasonably high
const PER_STOP_DELAY_MS = 150;    // be nice to the API

// Oslo kommune-ish bounding box (used to KEEP nodes/edges)
const OSLO_BBOX = {
    minLat: 59.80,
    maxLat: 60.10,
    minLon: 10.45,
    maxLon: 10.95
};

// Grid sampling to actually cover the city (used to FIND candidates)
const GRID_STEP_KM = 2;             // smaller = denser coverage
const RADIUS_PER_SEED_M = 2500;     // initial search radius
const FIRST_PER_SEED = 200;         // max items returned per seed

// Fallback strategy for finicky seeds
const NEAREST_FALLBACK_RADII = [2000, 1500, 1000]; // meters

// -------------------------------
// Types
// -------------------------------

type Any = any;

type NodeAcc = {
    id: string;               // quay id
    stopPlaceId: string;
    name: string;
    lat: number;
    lon: number;
    _modes: Set<string>;
};

type NodeOut = {
    id: string;
    stopPlaceId: string;
    name: string;
    lat: number;
    lon: number;
    modes: string[];
    stopType: "bus" | "tram" | "metro" | "rail" | "water" | "coach" | "multimodal" | "unknown";
};

type EdgeOut = {
    from: string;
    to: string;
    lineId: string;
    lineCode?: string;
    mode: string;
    authority?: string;
    travelTimeSec?: number;
};

// -------------------------------
// Helpers
// -------------------------------

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

function inOslo(lat?: number, lon?: number) {
    if (lat == null || lon == null) return false;
    return (
        lat >= OSLO_BBOX.minLat &&
        lat <= OSLO_BBOX.maxLat &&
        lon >= OSLO_BBOX.minLon &&
        lon <= OSLO_BBOX.maxLon
    );
}

function ensureNode(map: Map<string, NodeAcc>, quayId: string, sp: Any, mode?: string) {
    const lat = sp?.latitude ?? 0;
    const lon = sp?.longitude ?? 0;
    if (!inOslo(lat, lon)) return;

    if (!map.has(quayId)) {
        map.set(quayId, {
            id: quayId,
            stopPlaceId: sp?.id ?? "",
            name: sp?.name ?? "",
            lat,
            lon,
            _modes: new Set<string>()
        });
    }
    if (mode) map.get(quayId)!._modes.add(mode);
}

function toTs(s?: string | null) {
    return s ? Date.parse(s) : Number.MAX_SAFE_INTEGER;
}
function toSec(s?: string | null) {
    return s ? Math.floor(Date.parse(s) / 1000) : null;
}

function stopTypeFrom(modes: Set<string>): NodeOut["stopType"] {
    if (!modes || modes.size === 0) return "unknown";
    if (modes.size > 1) return "multimodal";
    const m = Array.from(modes)[0];
    return (["bus", "tram", "metro", "rail", "water", "coach"].includes(m) ? m : "unknown") as NodeOut["stopType"];
}

// grid helpers
function kmToDegLat(km: number) { return km / 111.32; }
function kmToDegLon(km: number, latDeg: number) { return km / (111.32 * Math.cos(latDeg * Math.PI / 180)); }

// Try nearest with fallback radii and swallow the “LOCATION_NOT_FOUND” tantrums
async function safeNearest(client: ReturnType<typeof enturClient>, lat: number, lon: number): Promise<any[]> {
    const radii = [RADIUS_PER_SEED_M, ...NEAREST_FALLBACK_RADII];
    for (const r of radii) {
        try {
            const res: any = await pRetry(
                () => client.request(Q_NEAREST_STOPPLACES, {
                    lat: round6(lat),
                    lon: round6(lon),
                    radius: r * 1.0,
                    first: FIRST_PER_SEED
                }),
                { retries: 2 }
            );
            const edges = res?.nearest?.edges ?? [];
            if (edges.length) return edges;
        } catch (e: any) {
            // If the server returns nearest: null or RoutingError, just try the next radius
            continue;
        }
    }
    return [];
}

function round6(x: number) {
    return Math.round(x * 1e6) / 1e6;
}

// -------------------------------
// Main
// -------------------------------

async function run() {
    const client = enturClient();
    fs.mkdirSync("out", { recursive: true });

    // Log authorities (helps sanity-check the feed)
    const authRes: Any = await client.request(Q_AUTHORITIES);
    const authorities = authRes.authorities as { id: string; name: string }[];
    const wanted = authorities.filter(a => /ruter|sporveien|vy/i.test(a.name));
    console.log("Authorities:", wanted.map(a => a.name).join(", "));

    // 1) Build a grid of seeds across the Oslo bbox and union StopPlaces
    const latStep = kmToDegLat(GRID_STEP_KM);
    const midLat = (OSLO_BBOX.minLat + OSLO_BBOX.maxLat) / 2;
    const lonStep = kmToDegLon(GRID_STEP_KM, midLat);

    const seeds: { lat: number; lon: number }[] = [];
    for (let lat = OSLO_BBOX.minLat; lat <= OSLO_BBOX.maxLat + 1e-9; lat += latStep) {
        for (let lon = OSLO_BBOX.minLon; lon <= OSLO_BBOX.maxLon + 1e-9; lon += lonStep) {
            seeds.push({ lat, lon });
        }
    }

    const stopPlaceMap = new Map<string, { id: string; name: string; latitude: number; longitude: number }>();
    let badSeeds = 0;

    for (const s of seeds) {
        await sleep(80); // polite probing
        const edges = await safeNearest(client, s.lat, s.lon);
        if (!edges.length) { badSeeds++; continue; }

        const places = edges
            .map((e: Any) => e?.node?.place)
            .filter(Boolean);

        for (const p of places) {
            if (inOslo(p.latitude, p.longitude) && !stopPlaceMap.has(p.id)) {
                stopPlaceMap.set(p.id, p);
            }
        }
    }

    const stopPlaces = Array.from(stopPlaceMap.values());
    console.log(`Grid seeds: ${seeds.length}, bad seeds: ${badSeeds}, StopPlaces in bbox: ${stopPlaces.length}`);

    const nodesMap = new Map<string, NodeAcc>();
    const edges: EdgeOut[] = [];

    // Accumulate ALL calls across all stop places keyed by ServiceJourney
    const callsBySJ = new Map<string, Any[]>();
    const startTime = new Date().toISOString();

    for (const sp of stopPlaces) {
        await sleep(PER_STOP_DELAY_MS);

        const callsRes: Any = await pRetry(() => client.request(Q_EST_CALLS_BY_STOPPLACE, {
            stopPlaceId: sp.id,
            startTime,
            timeRange: TIMERANGE_SEC,
            numberOfDepartures: N_DEPS
        }), { retries: 2 });

        const calls = callsRes?.stopPlace?.estimatedCalls ?? [];
        for (const c of calls) {
            const sjId = c?.serviceJourney?.id;
            if (!sjId) continue;
            if (!callsBySJ.has(sjId)) callsBySJ.set(sjId, []);
            callsBySJ.get(sjId)!.push(c);
        }
    }

    // 2) For each ServiceJourney, order stops and build edges across QUAYS
    for (const [, arr] of callsBySJ.entries()) {
        // Prefer structural order; fallback to time
        arr.sort((a, b) => {
            const ap = a.stopPositionInPattern ?? Number.MAX_SAFE_INTEGER;
            const bp = b.stopPositionInPattern ?? Number.MAX_SAFE_INTEGER;
            if (ap !== bp) return ap - bp;
            return toTs(a.expectedDepartureTime ?? a.aimedDepartureTime) -
                toTs(b.expectedDepartureTime ?? b.aimedDepartureTime);
        });

        // Deduplicate consecutive identical quays
        const seq: Any[] = [];
        for (const c of arr) {
            if (!c?.quay?.id) continue;
            if (seq.length === 0 || seq[seq.length - 1].quay.id !== c.quay.id) seq.push(c);
        }
        if (seq.length < 2) continue;

        for (let i = 0; i < seq.length - 1; i++) {
            const A = seq[i], B = seq[i + 1];
            const qa = A.quay, qb = B.quay;
            const spA = qa.stopPlace, spB = qb.stopPlace;
            const line = A.serviceJourney?.journeyPattern?.line ?? {};
            const mode: string = line.transportMode;
            const authority: string | undefined = line.authority?.name;

            // Tag nodes with mode and filter outside-Oslo quays
            ensureNode(nodesMap, qa.id, spA, mode);
            ensureNode(nodesMap, qb.id, spB, mode);
            if (!nodesMap.has(qa.id) || !nodesMap.has(qb.id)) continue;

            const tA = toSec(A.expectedDepartureTime ?? A.aimedDepartureTime);
            const tB = toSec(B.expectedDepartureTime ?? B.aimedDepartureTime);
            const travel = tA != null && tB != null && tB >= tA ? (tB - tA) : undefined;

            edges.push({
                from: qa.id,
                to: qb.id,
                lineId: line.id,
                lineCode: line.publicCode,
                mode,
                authority,
                travelTimeSec: travel
            });
        }
    }

    // finalize nodes (convert Set -> array, compute stopType)
    const nodes: NodeOut[] = Array.from(nodesMap.values()).map(n => ({
        id: n.id,
        stopPlaceId: n.stopPlaceId,
        name: n.name,
        lat: n.lat,
        lon: n.lon,
        modes: Array.from(n._modes).sort(),
        stopType: stopTypeFrom(n._modes)
    }));

    // keep only edges whose endpoints survived
    const nodeIds = new Set(nodes.map(n => n.id));
    const edgesInOslo = edges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to));

    fs.writeFileSync("out/nodes_entur.csv", Papa.unparse(nodes));
    fs.writeFileSync("out/edges_entur.csv", Papa.unparse(edgesInOslo));
    fs.writeFileSync("out/graph_entur.json", JSON.stringify({ nodes, edges: edgesInOslo }, null, 2));

    console.log(`Done. Oslo-only. Nodes=${nodes.length} Edges=${edgesInOslo.length}`);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
