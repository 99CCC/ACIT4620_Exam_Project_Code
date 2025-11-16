## Step 1
query FindPatternForLine {
  line(id: "BRA:Line:26_4260") {
    id
    publicCode
    name
    journeyPatterns {
      id
      name
    }
  }
}

RESPONSE:
"journeyPatterns": [
  {
    "id": "BRA:JourneyPattern:4260_Inbound_250828097613458_250828097600133",
    "name": "2-2"
  },
  {
    "id": "BRA:JourneyPattern:4260_Outbound_250828097613454_250828097600133",
    "name": "1-1"
  },
  {
    "id": "BRA:JourneyPattern:4260_Outbound_251111090821735_251111090807941",
    "name": "1-3"
  }
]

## Step 2
query ServiceJourneysForFlybuss {
  line(id: "BRA:Line:26_4260") {
    id
    name
    journeyPatterns {
      id
      name
      serviceJourneysForDate(date: "2025-11-17") {
        id
        estimatedCalls {
          quay {
            id
            name
          }
          aimedDepartureTime
        }
      }
    }
  }
}

RESPONSE:
{
  "data": {
    "line": {
      "id": "BRA:Line:26_4260",
      "name": "Flybuss Ringerike - Gardermoen",
      "journeyPatterns": [
        {
          "id": "BRA:JourneyPattern:4260_Inbound_250828097613458_250828097600133",
          "name": "2-2",
          "serviceJourneysForDate": [
            {
              "id": "BRA:ServiceJourney:4260_250828097690064_1020",
              "estimatedCalls": []
            },
            {
              "id": "BRA:ServiceJourney:4260_250828097690065_1022",
              "estimatedCalls": []
            },
            {
              "id": "BRA:ServiceJourney:4260_250828097690066_1024",
              "estimatedCalls": []
            },
            {
              "id": "BRA:ServiceJourney:4260_250828097690067_1026",
              "estimatedCalls": []
            }
          ]
        },
        {
          "id": "BRA:JourneyPattern:4260_Outbound_250828097613454_250828097600133",
          "name": "1-1",
          "serviceJourneysForDate": [
            {
              "id": "BRA:ServiceJourney:4260_250828097690058_1021",
              "estimatedCalls": []
            }
          ]
        },
        {
          "id": "BRA:JourneyPattern:4260_Outbound_251111090821735_251111090807941",
          "name": "1-3",
          "serviceJourneysForDate": [
            {
              "id": "BRA:ServiceJourney:4260_250828097690059_1023",
              "estimatedCalls": []
            },
            {
              "id": "BRA:ServiceJourney:4260_250828097690060_1025",
              "estimatedCalls": []
            },
            {
              "id": "BRA:ServiceJourney:4260_250828097690061_1027",
              "estimatedCalls": []
            }
          ]
        }
      ]
    }
  }
}