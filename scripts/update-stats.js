const fs = require("node:fs");
const path = require("node:path");

const STATS_PATH = path.join(__dirname, "..", "stats.json");
const PROXY_URL = process.env.PROXY_URL || "https://proxy-sc-kappa.vercel.app/api/dashboard";
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 24 * 60 * 60 * 1000;
const BASELINE_SINCE_YEAR = 2023;
const BASELINE_SNAPSHOTS = [
  { key: "2023-Jan-1", year: "2023", month: "Jan", day: "1", total: 0 },
  { key: "2024-Jan-1", year: "2024", month: "Jan", day: "1", total: 0 },
  { key: "2025-Jan-1", year: "2025", month: "Jan", day: "1", total: 147 },
  { key: "2026-Jan-1", year: "2026", month: "Jan", day: "1", total: 16027 },
  { key: "2026-Apr-24", year: "2026", month: "Apr", day: "24", total: 23423 }
];
const BASELINE_TOTAL = Math.max(...BASELINE_SNAPSHOTS.map((snapshot) => snapshot.total));

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function getUtcParts(date = new Date()) {
  return {
    year: String(date.getUTCFullYear()),
    month: MONTHS[date.getUTCMonth()],
    day: String(date.getUTCDate())
  };
}

function getUtcDateFromSnapshot(snapshot) {
  return new Date(Date.UTC(Number(snapshot.year), MONTHS.indexOf(snapshot.month), Number(snapshot.day)));
}

function getUtcDateParts(date) {
  return {
    year: String(date.getUTCFullYear()),
    month: MONTHS[date.getUTCMonth()],
    day: String(date.getUTCDate())
  };
}

function daysBetween(start, end) {
  return Math.max(Math.round((end.getTime() - start.getTime()) / DAY_MS), 0);
}

function addDays(date, days) {
  return new Date(date.getTime() + (days * DAY_MS));
}

function getDaysInMonth(year, month) {
  const monthIndex = MONTHS.indexOf(month);
  if (monthIndex === -1) {
    return 31;
  }

  return new Date(Date.UTC(Number(year), monthIndex + 1, 0)).getUTCDate();
}

function normalizeSnapshot(snapshot) {
  if (!snapshot) {
    return null;
  }

  const year = String(snapshot.year || "").trim();
  const month = String(snapshot.month || "").trim();
  const day = String(snapshot.day || "").trim();

  if (!year || !month || !day || !MONTHS.includes(month)) {
    return null;
  }

  return {
    key: snapshot.key || `${year}-${month}-${day}`,
    year,
    month,
    day,
    total: toNumber(snapshot.total)
  };
}

function normalizeSnapshots(snapshots) {
  const byKey = new Map();

  for (const snapshot of (Array.isArray(snapshots) ? snapshots : [])) {
    const normalized = normalizeSnapshot(snapshot);
    if (!normalized) continue;

    const existing = byKey.get(normalized.key);
    byKey.set(normalized.key, existing
      ? { ...normalized, total: Math.max(existing.total, normalized.total) }
      : normalized);
  }

  return Array.from(byKey.values())
    .map(normalizeSnapshot)
    .filter(Boolean)
    .sort((a, b) => getUtcDateFromSnapshot(a) - getUtcDateFromSnapshot(b));
}

function upsertSnapshot(snapshots, nextSnapshot) {
  const normalized = normalizeSnapshots([...BASELINE_SNAPSHOTS, ...(Array.isArray(snapshots) ? snapshots : [])]);
  const existingIndex = normalized.findIndex((item) => item.key === nextSnapshot.key);

  if (existingIndex >= 0) {
    normalized[existingIndex] = {
      ...nextSnapshot,
      total: Math.max(normalized[existingIndex].total, nextSnapshot.total)
    };
  } else {
    normalized.push(nextSnapshot);
  }

  return normalizeSnapshots(normalized);
}

function addToMap(map, key, delta) {
  map.set(key, (map.get(key) || 0) + delta);
}

function buildHistory(snapshots, nowParts) {
  const yearlyTotals = new Map();
  const monthlyTotals = new Map(MONTHS.map((month) => [month, 0]));
  const dailyTotals = new Map();

  for (let index = 1; index < snapshots.length; index += 1) {
    const previous = snapshots[index - 1];
    const current = snapshots[index];
    const delta = Math.max(current.total - previous.total, 0);

    if (delta === 0) {
      continue;
    }

    const previousDate = getUtcDateFromSnapshot(previous);
    const currentDate = getUtcDateFromSnapshot(current);
    const gapDays = Math.max(daysBetween(previousDate, currentDate), 1);
    const baseShare = Math.floor(delta / gapDays);
    let remainder = delta % gapDays;

    for (let offset = 0; offset < gapDays; offset += 1) {
      const targetDate = addDays(previousDate, offset);
      const targetParts = getUtcDateParts(targetDate);
      const share = baseShare + (remainder > 0 ? 1 : 0);

      if (remainder > 0) {
        remainder -= 1;
      }

      addToMap(yearlyTotals, targetParts.year, share);

      if (targetParts.year === nowParts.year) {
        addToMap(monthlyTotals, targetParts.month, share);

        if (targetParts.month === nowParts.month) {
          addToMap(dailyTotals, targetParts.day, share);
        }
      }
    }
  }

  const startYear = Math.min(
    BASELINE_SINCE_YEAR,
    ...Array.from(yearlyTotals.keys()).map((year) => Number(year)),
    Number(nowParts.year)
  );
  const endYear = Math.max(
    ...Array.from(yearlyTotals.keys()).map((year) => Number(year)),
    Number(nowParts.year)
  );
  const yearly = Array.from({ length: endYear - startYear + 1 }, (_, index) => {
    const label = String(startYear + index);
    return { label, plays: yearlyTotals.get(label) || 0 };
  });

  const monthly = MONTHS.map((label) => ({
    label,
    plays: monthlyTotals.get(label) || 0
  }));

  const daysInCurrentMonth = getDaysInMonth(nowParts.year, nowParts.month);
  const daily = Array.from({ length: daysInCurrentMonth }, (_, index) => {
    const label = String(index + 1);
    return {
      label,
      plays: dailyTotals.get(label) || 0
    };
  });

  return {
    yearly,
    monthly,
    daily,
    meta: {
      yearlyStart: yearly.length ? yearly[0].label : nowParts.year,
      yearlyEnd: yearly.length ? yearly[yearly.length - 1].label : nowParts.year,
      monthlyYear: nowParts.year,
      dailyYear: nowParts.year,
      dailyMonth: nowParts.month
    }
  };
}

async function fetchDashboard() {
  const res = await fetch(PROXY_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (!res.ok) {
    throw new Error(`Proxy request failed: HTTP ${res.status}`);
  }

  const apiData = await res.json();

  if (!Number.isFinite(Number(apiData.playback_count))) {
    throw new Error("playback_count not found in proxy response");
  }

  return apiData;
}

function readStats() {
  if (!fs.existsSync(STATS_PATH)) {
    return {};
  }

  const raw = fs.readFileSync(STATS_PATH, "utf8");
  return raw.trim() ? JSON.parse(raw) : {};
}

function mainTrackTitle(apiData, stats) {
  return apiData.trackTitle || apiData.title || stats.trackTitle || stats.lastTrackTitle || "All Tracks";
}

function mainArtist(apiData, stats) {
  return apiData.artist || stats.artist || "Ploxi";
}

function pickTracks(tracks) {
  return Array.isArray(tracks) ? tracks.slice(0, 6) : [];
}

function getCompatibleSnapshots(stats) {
  const snapshots = normalizeSnapshots(stats.snapshots);
  const maxTotal = snapshots.reduce((max, snapshot) => Math.max(max, snapshot.total), 0);
  const artist = String(stats.artist || "").toLowerCase();

  if (artist && artist !== "ploxi") {
    return [];
  }

  if (maxTotal > BASELINE_TOTAL * 10) {
    return [];
  }

  return snapshots;
}

async function main() {
  const apiData = await fetchDashboard();
  const currentTotal = Math.max(toNumber(apiData.playback_count), BASELINE_TOTAL);
  const stats = readStats();
  const nowParts = getUtcParts();
  const todayKey = `${nowParts.year}-${nowParts.month}-${nowParts.day}`;

  const nextSnapshot = {
    key: todayKey,
    year: nowParts.year,
    month: nowParts.month,
    day: nowParts.day,
    total: currentTotal
  };

  const snapshots = upsertSnapshot(getCompatibleSnapshots(stats), nextSnapshot);
  const history = buildHistory(snapshots, nowParts);

  stats.sinceYear = BASELINE_SINCE_YEAR;
  stats.snapshots = snapshots;
  stats.history = {
    yearly: history.yearly,
    monthly: history.monthly,
    daily: history.daily
  };
  stats.historyMeta = history.meta;
  stats.lastTotal = currentTotal;
  stats.playback_count = currentTotal;
  stats.likes = toNumber(apiData.likes);
  stats.comments = toNumber(apiData.comments);
  stats.reposts = toNumber(apiData.reposts);
  stats.downloads = toNumber(apiData.downloads);
  stats.trackCount = toNumber(apiData.trackCount);
  stats.artist = mainArtist(apiData, stats);
  stats.trackTitle = mainTrackTitle(apiData, stats);
  stats.lastTrackTitle = stats.trackTitle;
  stats.updatedAt = apiData.updatedAt || new Date().toISOString();
  stats.tracks = pickTracks(apiData.tracks);

  fs.writeFileSync(STATS_PATH, `${JSON.stringify(stats, null, 2)}\n`, "utf8");

  console.log("Updated stats.json");
  console.log("Current total:", currentTotal);
  console.log("Snapshots stored:", snapshots.length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
