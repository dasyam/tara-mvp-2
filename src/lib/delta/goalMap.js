// src/lib/delta/goalMap.js
export function mapUserGoalToCanonical(goal) {
  if (!goal) return 'mixed';
  const g = String(goal).toLowerCase().trim();
  const map = {
    'fall asleep faster': 'sleep_latency',
    'sleep latency': 'sleep_latency',
    'fewer night wakeups': 'consistency',
    'wake sharper': 'wake_freshness',
    'wake freshness': 'wake_freshness'
  };
  return map[g] || 'mixed';
}

export function canonicalOrMixed(key) {
  const allowed = new Set(['sleep_latency', 'wake_freshness', 'consistency', 'mixed']);
  return allowed.has(key) ? key : 'mixed';
}
