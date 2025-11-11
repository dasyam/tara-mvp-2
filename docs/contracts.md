# contracts@v1.0

## Conventions
Headers:
- Content-Type: application/json
- X-Contracts-Version: v1.0
- Authorization: Bearer <supabase_jwt> when required

Response envelope:
{ "ok": true, "data": <payload>, "error": null }  OR
{ "ok": false, "data": null, "error": { "code": "<CODE>", "message": "<msg>", "details": any } }

Common errors:
- 400 BAD_REQUEST
- 401 UNAUTHORIZED
- 403 FORBIDDEN
- 404 NOT_FOUND
- 409 CONFLICT
- 422 UNPROCESSABLE_ENTITY
- 429 RATE_LIMITED
- 500 INTERNAL

Enums:
- PlanResult: "done" | "partly" | "skipped"
- RuntimeAction: "shield_done" | "shield_snooze" | "shield_skip"
- Mood: "tired" | "wired" | "lonely" | "reward"
- TriggerPlace: "in_hand" | "on_bed" | "bedside_table" | "another_room"
- Goal: "sleep_latency" | "wake_freshness" | "consistency" | "mixed"

---

## POST /api/parseTimeline
Auth: required
Req:
{
  "preferred_name": string|null,
  "goal": "Fall asleep faster" | "Fewer night wakeups" | "Wake sharper" | "Other",
  "bedtime_window": string,
  "routine_text": string
}
Resp 200:
{
  "timeline_json": {
    "wake_time": "HH:MM",
    "bedtime_target": "HH:MM",
    "bedtime_window": "HH:MM–HH:MM",
    "anchors": [{"name": string, "time": "HH:MM", "confidence": number}],
    "notes": string|null
  }
}
Errors: 422 if invalid JSON from LLM

---

## POST /api/computeDelta
Auth: required
Req: { "user_id"?: string, "timeline_id"?: string }
Resp 200:
{
  "engine_version": "vX.Y",
  "top3_json": [{
    "ritual_name": string,
    "impact_tag": "High"|"Medium"|"Low",
    "effort_tag": "Low"|"Medium"|"High",
    "why": string,
    "how_to": string,
    "system_block": "Morning"|"Day"|"Evening"|"Night"
  }],
  "opportunity_scores": [{"id": string, "score": number}]
}
Errors: 404 if no timeline, 422 if invalid

---

## POST /api/plan/createTonight
Auth: required
Req:
{
  "date"?: "YYYY-MM-DD",
  "trigger_time_anchor": string,        // e.g. "after_getting_into_bed" or free text <= 30 chars
  "trigger_place": TriggerPlace,
  "trigger_mood": Mood,
  "shield_type": string,                // stable id e.g. "charger_living_room"
  "shield_time": "HH:MM",
  "divert_ritual": string,              // stable id e.g. "thought_unload_3_lines"
  "started_now"?: boolean
}
Resp 200: { "plan_id": string, "date": "YYYY-MM-DD" }
Errors: 409 if plan already exists for date

---

## POST /api/plan/runtimeEvent
Auth: required
Req:
{
  "plan_id": string,
  "at": string,                         // ISO timestamp
  "action": RuntimeAction,
  "reason"?: string                     // required when action = "shield_skip"
}
Resp 200: { "ok": true }

---

## POST /api/checkin/morning
Auth: required
Req:
{
  "date": "YYYY-MM-DD",
  "sleep_rating_1_5": 1|2|3|4|5,
  "completed_evening": "done"|"partly"|"skipped"
}
Resp 200: { "ok": true }

---

## GET /api/plan/last7
Auth: required
Resp 200:
{
  "plans": [{
    "date": "YYYY-MM-DD",
    "trigger_mood": Mood,
    "shield_type": string,
    "shield_time": "HH:MM",
    "divert_ritual": string,
    "completed_evening": "done"|"partly"|"skipped"|null
  }],
  "summaries": {
    "armed": number,
    "completed": number,
    "streak": number
  }
}
