import { GraphQLClient } from "graphql-request";
import "dotenv/config";

const ENDPOINT = "https://api.entur.io/journey-planner/v3/graphql";

export function enturClient() {
    const name = process.env.ET_CLIENT_NAME ?? "ccrl-oslo-net";
    return new GraphQLClient(ENDPOINT, {
        headers: {
            "Content-Type": "application/json",
            "ET-Client-Name": name
        }
    });
}
