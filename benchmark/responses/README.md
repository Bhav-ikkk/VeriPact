# Cached deterministic responses (REPLAY ONLY)

Recorded LLM / Channel3 / TSA responses for deterministic `npm run regression`
replays land here. Rules (AGENTS.md Rule 3):

- Every file MUST contain `"replay": true` and a `recordedAtUtc` timestamp.
- Replays are test data. They MUST NEVER be served on a live sandbox path
  or presented as live evidence in the UI, README, or video.
