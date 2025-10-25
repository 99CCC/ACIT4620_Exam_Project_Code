export type Node = {
    id: string;             // Quay id: e.g. "NSR:Quay:12345"
    stopPlaceId: string;
    name: string;
    lat: number;
    lon: number;
    modes: string[];        // unique modes seen here: ["bus"], ["tram","metro"], etc.
    stopType: "bus" | "tram" | "metro" | "rail" | "water" | "coach" | "multimodal" | "unknown";
};

export type Edge = {
    from: string;
    to: string;
    lineId: string;
    lineCode?: string;
    mode: string;           // transportMode from Entur
    authority?: string;
    travelTimeSec?: number;
    distanceMeters?: number;
    departuresPerHour?: number;
    capacityPerHour?: number;
};
