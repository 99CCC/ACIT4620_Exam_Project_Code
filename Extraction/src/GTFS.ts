/**
 * @author Carl Christian Roll-Lund
 * 
 * The GTFS.ts script acts as the "main" file for the extraction part.
 * The script downloads the full Norwegian GTFS dataset 
 * (or uses the cached zip, if the program has already been run on the client),
 * it clips it to the regions we specified making 2 datasets, one for Oslo-Only
 * and one with extended regions added (Oslo, Akershus, Østfold & Buskerud).
 * It filters stops by fylke/county geometry, rebuilds every edge by walking through stop_times
 * in sequence, calculates median travel times, counts how many trips actually use each edge,
 * and ssigns mode/authorities. The result is written out as CSV and JSON, we ended up using
 * the edges/nodes+_GTFS_ALL_FYLKER_with_mondayTrips.csv and edges/nodes+_GTFS_OSLO_with_mondayTrips.csv
 * for the majority of our work.
 * The added monday trips were in this case collected from Enturs JourneyPlanner API, which we found out
 * later was a bit redundant, as we found a much easier way to just use the given files from GTFS later on
 * can be seen in the Rail Headway workbook. 
 * 
 */

import fs from "node:fs";
import path from "node:path";
import StreamZip from "node-stream-zip";
import Papa from "papaparse";

import {
    hmsToSec,
    routeTypeToMode,
    median,
    download,
    streamCsv,
} from "./gtfsUtils.js";

import { loadGeometry, pointInGeom } from "./polyMapping.js";
import { journeyPlannerTripCounter } from "./journeyPlannerTripCounter.js";

// config
const GTFS_URL =
    "https://storage.googleapis.com/marduk-production/outbound/gtfs/rb_norway-aggregated-gtfs.zip";

export const OUT_DIR = "out";

// Oslo only
const OSLO_FYLKE = "03";

// Greater Oslo / all fylker you care about
const FYLKER = ["03", "32", "33", "31"]; // Oslo, Akershus, Buskerud, Østfold

/**
 * Function for loading in all counties
 */
async function buildRegion(
    label: "OSLO" | "ALL_FYLKER",
    geoms: any[],
    zip: any,
    routes: Map<string, any>,
    trips: Map<string, any>,
    agencyName: Map<string, string>
) {
    console.log(`\n=== Building region: ${label} ===`);

    // --- stops (clipped by region polygons) ---
    const stops = new Map<string, any>();
    await streamCsv(zip, "stops.txt", r => {
        const id = r["stop_id"];
        if (!id) return;
        const lat = +r["stop_lat"];
        const lon = +r["stop_lon"];
        if (Number.isNaN(lat) || Number.isNaN(lon)) return;

        // Keep only stops inside at least one of the fylke polygons
        const inside = geoms.some(geom => pointInGeom(lon, lat, geom));
        if (!inside) return;

        stops.set(id, { id, name: r["stop_name"], lat, lon });
    });

    console.log(`[${label}] kept stops: ${stops.size.toLocaleString()}`);

    // --- stop_times (filtered by trips + region stops) ---
    const times = new Map<string, any[]>();
    let seen = 0;
    let kept = 0;
    await streamCsv(zip, "stop_times.txt", r => {
        seen++;
        const tid = r["trip_id"];
        if (!trips.has(tid)) return;
        const sid = r["stop_id"];
        if (!stops.has(sid)) return; // outside region
        const seq = +r["stop_sequence"];
        if (Number.isNaN(seq)) return;

        const arr = hmsToSec(r["arrival_time"]);
        const dep = hmsToSec(r["departure_time"]);
        if (!times.has(tid)) times.set(tid, []);
        times.get(tid)!.push({ sid, seq, arr, dep });
        kept++;
    });

    console.log(
        `[${label}] stop_times: seen=${seen.toLocaleString()} kept=${kept.toLocaleString()} trips=${times.size.toLocaleString()}`
    );

    // --- build edges ---
    const edges = new Map<string, any>();
    for (const [tid, list] of times) {
        list.sort((a, b) => a.seq - b.seq);
        const trip = trips.get(tid);
        const route = routes.get(trip.route);
        if (!route) continue;
        const mode = routeTypeToMode(route.route_type);
        const authority = agencyName.get(route.agency_id);

        for (let i = 0; i < list.length - 1; i++) {
            const a = list[i],
                b = list[i + 1];
            const key = `${a.sid}|${b.sid}|${route.route_id}`;
            const tA = a.dep ?? a.arr,
                tB = b.arr ?? b.dep;
            const dur =
                tA != null && tB != null && tB >= tA ? tB - tA : undefined;

            if (!edges.has(key)) {
                edges.set(key, {
                    from: a.sid,
                    to: b.sid,
                    route,
                    mode,
                    authority,
                    durs: [],
                    trips: 0, // 👈 count how many times this edge appears
                });
            }

            const edge = edges.get(key);
            if (dur) edge.durs.push(dur);
            edge.trips += 1; // 👈 increment counter for every observed traversal
        }
    }

    const edgesOut = Array.from(edges.values()).map(e => ({
        from: e.from,
        to: e.to,
        lineId: e.route.route_id,
        lineCode: e.route.short || e.route.long,
        mode: e.mode,
        authority: e.authority,
        travelTimeSec: median(e.durs),
        tripsInFeed: e.trips, // 👈 new column: how many times this edge showed up in stop_times
    }));

    console.log(
        `[${label}] edges: ${edgesOut.length.toLocaleString()}`
    );

    // --- nodes ---
    const usedStops = new Set<string>();
    edgesOut.forEach(e => {
        usedStops.add(e.from);
        usedStops.add(e.to);
    });

    const modeByStop = new Map<string, Set<string>>();
    edgesOut.forEach(e => {
        if (!modeByStop.has(e.from)) modeByStop.set(e.from, new Set());
        if (!modeByStop.has(e.to)) modeByStop.set(e.to, new Set());
        modeByStop.get(e.from)!.add(e.mode);
        modeByStop.get(e.to)!.add(e.mode);
    });

    const nodesOut = Array.from(usedStops).map(id => {
        const s = stops.get(id)!;
        const modes = Array.from(modeByStop.get(id) || []);
        let stopType = "unknown";
        if (modes.length === 1) stopType = modes[0];
        else if (modes.length > 1) stopType = "multimodal";
        return {
            id,
            stopPlaceId: id,
            name: s.name,
            lat: s.lat,
            lon: s.lon,
            modes,
            stopType,
        };
    });

    console.log(
        `[${label}] nodes: ${nodesOut.length.toLocaleString()}`
    );

    const suffix = label === "OSLO" ? "OSLO" : "ALL_FYLKER";

    fs.writeFileSync(
        path.join(OUT_DIR, `nodes_GTFS_${suffix}.csv`),
        Papa.unparse(nodesOut)
    );
    fs.writeFileSync(
        path.join(OUT_DIR, `edges_GTFS_${suffix}.csv`),
        Papa.unparse(edgesOut)
    );
    fs.writeFileSync(
        path.join(OUT_DIR, `graph_GTFS_${suffix}.json`),
        JSON.stringify({ nodes: nodesOut, edges: edgesOut }, null, 2)
    );

    console.log(
        `[${label}] Done. Static network: nodes=${nodesOut.length} edges=${edgesOut.length}`
    );
}

// main thing
async function run() {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const zipFile = path.join(OUT_DIR, "gtfs.zip");

    if (!fs.existsSync(zipFile)) {
        console.log("downloading GTFS… (this takes forever the first time)");
        await download(GTFS_URL, zipFile);
    } else {
        console.log("using existing gtfs.zip (praise caching)");
    }

    const zip = new StreamZip.async({ file: zipFile });

    // --- agencies ---
    const agencyName = new Map<string, string>();
    const allowedAgencies = new Set<string>();
    await streamCsv(zip, "agency.txt", row => {
        const id = row["agency_id"] || row["agency_name"];
        if (!id) return;
        const name = row["agency_name"] || id;
        agencyName.set(id, name);
        allowedAgencies.add(id);
    });

    // --- routes ---
    const routes = new Map<string, any>();
    await streamCsv(zip, "routes.txt", row => {
        const id = row["route_id"];
        if (!id) return;
        const ag = row["agency_id"] || "";
        if (allowedAgencies.size && !allowedAgencies.has(ag)) return;
        routes.set(id, {
            route_id: id,
            agency_id: ag,
            route_type: Number(row["route_type"]),
            short: row["route_short_name"],
            long: row["route_long_name"],
        });
    });

    // --- trips ---
    const trips = new Map<string, any>();
    await streamCsv(zip, "trips.txt", r => {
        if (!r["trip_id"] || !routes.has(r["route_id"])) return;
        trips.set(r["trip_id"], { id: r["trip_id"], route: r["route_id"] });
    });

    console.log(
        `routes=${routes.size.toLocaleString()} trips=${trips.size.toLocaleString()}`
    );

    // --- load polygons (Oslo only + all fylker) ---
    console.log("Loading fylke geometries…");
    const fylkeGeomMap = new Map<string, any>();
    for (const code of FYLKER) {
        const geom = await loadGeometry(code);
        fylkeGeomMap.set(code, geom);
    }

    const osloGeom = fylkeGeomMap.get(OSLO_FYLKE);
    if (!osloGeom) {
        throw new Error("Could not load Oslo fylke geometry");
    }

    const allGeoms = Array.from(fylkeGeomMap.values());

    // --- build OSLO-only network ---
    await buildRegion("OSLO", [osloGeom], zip, routes, trips, agencyName);

    // --- build ALL_FYLKER network ---
    await buildRegion("ALL_FYLKER", allGeoms, zip, routes, trips, agencyName);

    await zip.close();
    console.log(
        "All regions done. If these numbers look small, something broke upstream."
    );

    //Doing separate extraction from Entur to grab actual tripcounts for a monday
    await journeyPlannerTripCounter()
}

run().catch(err => {
    console.error("the universe is chaos:", err);
    process.exit(1);
});
