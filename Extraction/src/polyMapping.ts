/**
 * @author Carl Christian Roll-Lund
 */
import fs from "node:fs";
import path from "node:path";
const OUT_DIR = "out";
import { download } from "./gtfsUtils.js";

type Coordinate = [number, number]; // [lon, lat]
type Geom = GeoJSONPolygon | GeoJSONMultiPolygon;

interface GeoJSONPolygon {
    type: "Polygon";
    coordinates: Coordinate[][];
}

interface GeoJSONMultiPolygon {
    type: "MultiPolygon";
    coordinates: Coordinate[][][];
}

export function pointInRing(lon: number, lat: number, ring: Coordinate[]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [x_i, y_i] = ring[i];
        const [x_j, y_j] = ring[j];

        const intersect =
            y_i > lat !== y_j > lat &&
            lon <
            ((x_j - x_i) * (lat - y_i)) / (y_j - y_i + 0.0) + x_i;

        if (intersect) inside = !inside;
    }
    return inside;
}

export function pointInGeom(lon: number, lat: number, geom: Geom) {
    if (geom.type === "Polygon") {
        // geom.coordinates = [ outerRing, hole1, hole2, ... ]
        const [outerRing, ...holes] = geom.coordinates;
        if (!outerRing) return false;
        if (!pointInRing(lon, lat, outerRing)) return false;
        // if inside a hole, treat as outside
        for (const hole of holes) {
            if (pointInRing(lon, lat, hole)) return false;
        }
        return true;
    }

    if (geom.type === "MultiPolygon") {
        // geom.coordinates = [ polygon1, polygon2, ... ]
        for (const poly of geom.coordinates) {
            const [outerRing, ...holes] = poly;
            if (!outerRing) continue;
            if (!pointInRing(lon, lat, outerRing)) continue;
            let inHole = false;
            for (const hole of holes) {
                if (pointInRing(lon, lat, hole)) {
                    inHole = true;
                    break;
                }
            }
            if (!inHole) return true;
        }
    }
    return false;
}

export async function loadGeometry(fylke: string): Promise<Geom> {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const osloFile = path.join(OUT_DIR, `${fylke}.json`);

    if (!fs.existsSync(osloFile)) {
        console.log("downloading " + fylke + " fylke geometry…");
        await download(fylkeUrl(fylke), osloFile);
    } else {
        console.log("using existing " + fylke + "file");
    }

    const raw = fs.readFileSync(osloFile, "utf8");
    const json = JSON.parse(raw);

    const geom = json.omrade;
    if (!geom) {
        throw new Error("No 'omrade' field in " + fylke + " fylke response");
    }

    if (geom.type !== "Polygon" && geom.type !== "MultiPolygon") {
        throw new Error(fylke + " 'omrade' is not Polygon/MultiPolygon: " + geom.type);
    }

    return geom as Geom;
}

function fylkeUrl(code: string) {
    return `https://api.kartverket.no/kommuneinfo/v1/fylker/${code}/omrade`;
}


