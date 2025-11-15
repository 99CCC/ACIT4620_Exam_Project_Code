import fs from "node:fs";
import path from "node:path";
import StreamZip from "node-stream-zip";
import Papa from "papaparse";

import {
    //AGENCY_ALLOW,
    inOslo,
    hmsToSec,
    routeTypeToMode,
    median,
    download,
    streamCsv,
} from "./gtfsUtils.js";

// config
const GTFS_URL = "https://storage.googleapis.com/marduk-production/outbound/gtfs/rb_norway-aggregated-gtfs.zip";
const OUT_DIR = "out";

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
        /*if (!AGENCY_ALLOW || AGENCY_ALLOW.test(name))*/ allowedAgencies.add(id);
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

    // --- stops ---
    const stops = new Map<string, any>();
    await streamCsv(zip, "stops.txt", r => {
        const id = r["stop_id"]; if (!id) return;
        const lat = +r["stop_lat"], lon = +r["stop_lon"];
        if (Number.isNaN(lat) || Number.isNaN(lon)) return;
        if (!inOslo(lat, lon)) return;
        stops.set(id, { id, name: r["stop_name"], lat, lon });
    });

    // --- trips ---
    const trips = new Map<string, any>();
    await streamCsv(zip, "trips.txt", r => {
        if (!r["trip_id"] || !routes.has(r["route_id"])) return;
        trips.set(r["trip_id"], { id: r["trip_id"], route: r["route_id"] });
    });

    // --- stop_times ---
    const times = new Map<string, any[]>();
    let seen = 0, kept = 0;
    await streamCsv(zip, "stop_times.txt", r => {
        seen++;
        const tid = r["trip_id"];
        if (!trips.has(tid)) return;
        const sid = r["stop_id"];
        if (!stops.has(sid)) return;
        const seq = +r["stop_sequence"];
        if (Number.isNaN(seq)) return;

        const arr = hmsToSec(r["arrival_time"]);
        const dep = hmsToSec(r["departure_time"]);
        if (!times.has(tid)) times.set(tid, []);
        times.get(tid)!.push({ sid, seq, arr, dep });
        kept++;
    });

    await zip.close();
    console.log(`stop_times: seen=${seen.toLocaleString()} kept=${kept.toLocaleString()} trips=${times.size.toLocaleString()}`);

    // --- build edges ---
    const edges = new Map<string, any>();
    for (const [tid, list] of times) {
        list.sort((a, b) => a.seq - b.seq);
        const trip = trips.get(tid);
        const route = routes.get(trip.route);
        const mode = routeTypeToMode(route.route_type);
        const authority = agencyName.get(route.agency_id);

        for (let i = 0; i < list.length - 1; i++) {
            const a = list[i], b = list[i + 1];
            const key = `${a.sid}|${b.sid}|${route.route_id}`;
            const tA = a.dep ?? a.arr, tB = b.arr ?? b.dep;
            const dur = tA != null && tB != null && tB >= tA ? (tB - tA) : undefined;
            if (!edges.has(key)) edges.set(key, { from: a.sid, to: b.sid, route, mode, authority, durs: [] });
            if (dur) edges.get(key).durs.push(dur);
        }
    }

    const edgesOut = Array.from(edges.values()).map(e => ({
        from: e.from,
        to: e.to,
        lineId: e.route.route_id,
        lineCode: e.route.short || e.route.long,
        mode: e.mode,
        authority: e.authority,
        travelTimeSec: median(e.durs)
    }));

    // --- nodes ---
    const usedStops = new Set<string>();
    edgesOut.forEach(e => { usedStops.add(e.from); usedStops.add(e.to); });

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
        return { id, stopPlaceId: id, name: s.name, lat: s.lat, lon: s.lon, modes, stopType };
    });

    fs.writeFileSync(path.join(OUT_DIR, "nodes_GTFS.csv"), Papa.unparse(nodesOut));
    fs.writeFileSync(path.join(OUT_DIR, "edges_GTFS.csv"), Papa.unparse(edgesOut));
    fs.writeFileSync(path.join(OUT_DIR, "graph_GTFS.json"), JSON.stringify({ nodes: nodesOut, edges: edgesOut }, null, 2));

    console.log(`Done. Static Oslo network: nodes=${nodesOut.length} edges=${edgesOut.length}`);
    console.log("if these numbers look small, something broke upstream");
}

run().catch(err => {
    console.error("the universe is chaos:", err);
    process.exit(1);
});
