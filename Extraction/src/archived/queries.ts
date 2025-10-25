// Authorities is unchanged
export const Q_AUTHORITIES = /* GraphQL */ `
query Authorities {
  authorities {
    id
    name
  }
}
`;

// IMPORTANT: this arg is Strings, not IDs.
export const Q_LINES_BY_AUTH = /* GraphQL */ `
query LinesByAuthority($authorityIds: [String!]!) {
  lines(authorities: $authorityIds) {
    id
    name
    publicCode
    transportMode
    authority { id name }
  }
}
`;

// 1) Find StopPlaces in a bbox using the generic nearest() query.
// We ask only for STOP_PLACE results to avoid noise.
export const Q_NEAREST_STOPPLACES = /* GraphQL */ `
query NearestStopPlaces(
  $lat: Float!, $lon: Float!,
  $radius: Float!, $first: Int!
) {
  nearest(
    latitude: $lat,
    longitude: $lon,
    maximumDistance: $radius,
    filterByPlaceTypes: [stopPlace],
    first: $first
  ) {
    edges {
      node {
        distance
        place {
          ... on StopPlace {
            id
            name
            latitude
            longitude
          }
        }
      }
    }
  }
}
`;


// 2) Pull departures per StopPlace. This exists, and it’s stable.
export const Q_EST_CALLS_BY_STOPPLACE = /* GraphQL */ `
query StopEstimatedCalls(
  $stopPlaceId: String!,
  $startTime: DateTime!,
  $timeRange: Int!,
  $numberOfDepartures: Int!
) {
  stopPlace(id: $stopPlaceId) {
    id
    name
    estimatedCalls(
      startTime: $startTime,
      timeRange: $timeRange,
      numberOfDepartures: $numberOfDepartures
    ) {
      realtime
      aimedDepartureTime
      aimedArrivalTime
      expectedDepartureTime
      expectedArrivalTime
      stopPositionInPattern
      quay { id stopPlace { id name latitude longitude } }
      serviceJourney {
        id
        journeyPattern {
          line {
            id
            publicCode
            transportMode
            authority { id name }
          }
        }
      }
    }
  }
}
`;
