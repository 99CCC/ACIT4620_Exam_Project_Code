import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import fetch from "node-fetch";
import { parse } from "csv-parse";

// ------------------------------
// shared config (don’t argue)
// ------------------------------

// bounding box for oslo area
export const OSLO_BBOX = { minLat: 59.75, maxLat: 60.25, minLon: 10.20, maxLon: 11.10 };

// i only want ruter/sporveien/vy. no random ferries from tromsø please.
export const AGENCY_ALLOW = /ruter|sporveien|vy/i;

// ------------------------------
// utility graveyard
// ------------------------------

export function inOslo(lat: number, lon: number) {
    return lat >= OSLO_BBOX.minLat && lat <= OSLO_BBOX.maxLat &&
        lon >= OSLO_BBOX.minLon && lon <= OSLO_BBOX.maxLon;
}

export function hmsToSec(s?: string) {
    if (!s) return;
    const m = /^(\d+):(\d{2}):(\d{2})$/.exec(s);
    if (!m) return;
    return +m[1] * 3600 + +m[2] * 60 + +m[3];
}

// whoever made GTFS route_type constants deserves mild pain
export function routeTypeToMode(rt: number | string): string {
    const n = Number(rt);
    if (n === 0) return "tram";
    if (n === 1) return "metro";
    if (n === 2) return "rail";
    if (n === 3) return "bus";
    if (n === 4) return "water";
    if (n === 5) return "cablecar";
    if (n === 6) return "gondola";
    if (n === 7) return "funicular";
    if (n === 11) return "bus";
    if (n === 12) return "rail";
    if (n >= 700 && n < 800) return "bus";
    if (n >= 900 && n < 1000) return "tram";
    if (n >= 300 && n < 400) return "metro";
    if ((n >= 100 && n < 300) || (n >= 400 && n < 500)) return "rail";
    if (n >= 1000 && n < 1100) return "water";
    return "unknown";
}

export function median(arr: number[]) {
    if (!arr.length) return;
    const a = arr.slice().sort((x, y) => x - y);
    const mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
}

export async function download(url: string, dest: string) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed ${res.status}`);
    await pipeline(res.body as any, fs.createWriteStream(dest));
}

// CSV streaming helper because RAM is apparently not infinite :')
export async function streamCsv(zip: any, entry: string, fn: (r: any) => void | Promise<void>) {
    const entries = await zip.entries();
    const key = Object.keys(entries).find(k => path.basename(k).toLowerCase() === entry.toLowerCase());
    if (!key) throw new Error(`missing ${entry} in zip (Entur why)`);
    const stream = await zip.stream(key);
    await pipeline(
        stream,
        parse({ columns: true, skip_empty_lines: true }),
        async function* (src: any) { for await (const row of src) await fn(row); }
    );
}
