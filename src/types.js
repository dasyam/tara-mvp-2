/**
 * @typedef {"sleep_latency" | "wake_freshness" | "consistency" | "mixed"} Goal
 * @typedef {"done" | "partly" | "skipped"} PlanResult
 * @typedef {"shield_done" | "shield_snooze" | "shield_skip"} RuntimeAction
 * @typedef {"tired" | "wired" | "lonely" | "reward"} Mood
 * @typedef {"in_hand" | "on_bed" | "bedside_table" | "another_room"} TriggerPlace
 */

/**
 * @typedef {Object} UserProfile
 * @property {string} user_id
 * @property {Goal=} goal
 * @property {boolean=} has_kids
 * @property {boolean=} shift_worker
 * @property {string=} preferred_name
 * @property {string=} bedtime_window
 */

/**
 * @typedef {Object} DailySleepCheckin
 * @property {string} id
 * @property {string} user_id
 * @property {string} date  // YYYY-MM-DD
 * @property {1|2|3|4|5} sleep_rating_1_5
 * @property {string=} bedtime  // HH:MM
 * @property {string=} wake_time
 * @property {number=} device_usage_indicator
 */

/**
 * @typedef {Object} WinddownPlan
 * @property {string} id
 * @property {string} user_id
 * @property {string} date
 * @property {string=} trigger_time_anchor
 * @property {TriggerPlace=} trigger_place
 * @property {Mood=} trigger_mood
 * @property {string=} shield_type
 * @property {string=} shield_time  // HH:MM
 * @property {string=} divert_ritual
 * @property {boolean=} started_now
 * @property {PlanResult=} completed_evening
 * @property {string=} skip_reason
 */
