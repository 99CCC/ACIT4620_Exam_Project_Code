import fs from "node:fs";

type Edge = {
    from: string; to: string; lineId: string; mode: string;
    travelTimeSec?: number;
};

const graph = JSON.parse(fs.readFileSync("out/graph.json", "utf8"));
const edges: Edge[] = graph.edges;

// crude per-line headway estimate: count service journeys per hour between a pair
// You can group by (from,to,lineId,hour) and compute departuresPerHour, then multiply by a mode capacity guess.
