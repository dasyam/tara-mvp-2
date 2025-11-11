// contracts@v1.0
import { z } from "zod";

export const Enums = {
  PlanResult: z.enum(["done","partly","skipped"]),
  RuntimeAction: z.enum(["shield_done","shield_snooze","shield_skip"]),
  Mood: z.enum(["tired","wired","lonely","reward"]),
  TriggerPlace: z.enum(["in_hand","on_bed","bedside_table","another_room"]),
  Goal: z.enum(["sleep_latency","wake_freshness","consistency","mixed"])
};

// Common
export const HHMM = z.string().regex(/^\d{2}:\d{2}$/);
export const ISODate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// /api/parseTimeline
export const ParseTimelineReq = z.object({
  preferred_name: z.string().min(1).max(50).nullable().optional(),
  goal: z.enum(["Fall asleep faster","Fewer night wakeups","Wake sharper","Other"]),
  bedtime_window: z.string().min(5),
  routine_text: z.string().min(1)
});

export const TimelineAnchor = z.object({
  name: z.string(),
  time: HHMM,
  confidence: z.number().min(0).max(1)
});

export const TimelineJson = z.object({
  wake_time: HHMM,
  bedtime_target: HHMM,
  bedtime_window: z.string(),
  anchors: z.array(TimelineAnchor).min(1),
  notes: z.string().nullable().optional()
});

export const ParseTimelineResp = z.object({
  timeline_json: TimelineJson
});

// /api/computeDelta
export const ComputeDeltaReq = z.object({
  user_id: z.string().uuid().optional(),
  timeline_id: z.string().uuid().optional()
}).refine(v => v.user_id || v.timeline_id, { message: "user_id or timeline_id required" });

export const Top3Item = z.object({
  ritual_name: z.string(),
  impact_tag: z.enum(["High","Medium","Low"]),
  effort_tag: z.enum(["Low","Medium","High"]),
  why: z.string(),
  how_to: z.string(),
  system_block: z.enum(["Morning","Day","Evening","Night"])
});

export const ComputeDeltaResp = z.object({
  engine_version: z.string(),
  top3_json: z.array(Top3Item).min(1),
  opportunity_scores: z.array(z.object({ id: z.string(), score: z.number() }))
});

// /api/plan/createTonight
export const CreateTonightReq = z.object({
  date: ISODate.optional(),
  trigger_time_anchor: z.string().min(2).max(30),
  trigger_place: Enums.TriggerPlace,
  trigger_mood: Enums.Mood,
  shield_type: z.string().min(2),
  shield_time: HHMM,
  divert_ritual: z.string().min(2),
  started_now: z.boolean().optional()
});
export const CreateTonightResp = z.object({ plan_id: z.string().uuid(), date: ISODate });

// /api/plan/runtimeEvent
export const RuntimeEventReq = z.object({
  plan_id: z.string().uuid(),
  at: z.string(), // ISO
  action: Enums.RuntimeAction,
  reason: z.string().min(2).optional()
}).refine(v => v.action !== "shield_skip" || !!v.reason, { message: "reason required when action=shield_skip" });

// /api/checkin/morning
export const MorningCheckinReq = z.object({
  date: ISODate,
  sleep_rating_1_5: z.number().int().min(1).max(5),
  completed_evening: Enums.PlanResult
});

// /api/plan/last7
export const PlanLast7Resp = z.object({
  plans: z.array(z.object({
    date: ISODate,
    trigger_mood: Enums.Mood.nullable().optional(),
    shield_type: z.string().nullable().optional(),
    shield_time: HHMM.nullable().optional(),
    divert_ritual: z.string().nullable().optional(),
    completed_evening: Enums.PlanResult.nullable().optional()
  })),
  summaries: z.object({
    armed: z.number().int(),
    completed: z.number().int(),
    streak: z.number().int()
  })
});
