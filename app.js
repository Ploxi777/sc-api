const API_URL = "https://proxy-sc-kappa.vercel.app/api/dashboard";
const STATS_URL = "stats.json";
const REFRESH_INTERVAL_MS = 30000;
const REQUEST_TIMEOUT_MS = 12000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const fullFormatter = new Intl.NumberFormat("en-US");
const compactFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1
});
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short"
});

const elements = {
  rangeSelect: document.getElementById("rangeSelect"),
  headlinePlays: document.getElementById("headlinePlays"),
  sinceYear: document.getElementById("sinceYear"),
  growthText: document.getElementById("growthText"),
  playsValue: document.getElementById("playsValue"),
  likesValue: document.getElementById("likesValue"),
  commentsValue: document.getElementById("commentsValue"),
  repostsValue: document.getElementById("repostsValue"),
  downloadsValue: document.getElementById("downloadsValue"),
  trackCountValue: document.getElementById("trackCountValue"),
  playsChipValue: document.getElementById("playsChipValue"),
  likesChipValue: document.getElementById("likesChipValue"),
  commentsChipValue: document.getElementById("commentsChipValue"),
  repostsChipValue: document.getElementById("repostsChipValue"),
  downloadsChipValue: document.getElementById("downloadsChipValue"),
  artistName: document.getElementById("artistName"),
  trackTitle: document.getElementById("trackTitle"),
  lastUpdate: document.getElementById("lastUpdate"),
  periodLabel: document.getElementById("periodLabel"),
  statusNote: document.getElementById("statusNote"),
  chartArea: document.getElementById("chartArea"),
  yAxis: document.getElementById("yAxis"),
  trackList: document.getElementById("trackList")
};

let dashboardData = null;
let previousLiveCount = null;
let isLoading = false;

function hasOwn(obj, key) {
  return Boolean(obj) && Object.prototype.hasOwnProperty.call(obj, key);
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function full(num) {
  return fullFormatter.format(toNumber(num));
}

function compact(num) {
  return compactFormatter.format(toNumber(num));
}

function getSafeDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function formatDateTime(value) {
  if (!value) {
    return "Unknown";
  }

  const date = getSafeDate(value);
  return dateTimeFormatter.format(date);
}

function getNiceAxisMax(value) {
  const safeMax = Math.max(toNumber(value), 1);
  const padded = safeMax * 1.1;
  const magnitude = 10 ** Math.floor(Math.log10(padded));
  const normalized = padded / magnitude;

  let niceNormalized = 10;
  if (normalized <= 1) {
    niceNormalized = 1;
  } else if (normalized <= 2) {
    niceNormalized = 2;
  } else if (normalized <= 5) {
    niceNormalized = 5;
  }

  return niceNormalized * magnitude;
}

function buildYAxis(maxValue) {
  elements.yAxis.innerHTML = "";

  const steps = 5;
  const safeMax = Math.max(toNumber(maxValue), 1);

  for (let i = steps; i >= 0; i -= 1) {
    const value = Math.round((safeMax / steps) * i);
    const el = document.createElement("span");
    el.textContent = i === 0 ? "0" : compact(value).toUpperCase();
    elements.yAxis.appendChild(el);
  }
}

function renderEmptyChart(message, rangeKey) {
  buildYAxis(1);
  elements.chartArea.innerHTML = "";
  elements.chartArea.dataset.range = rangeKey;
  elements.chartArea.style.gridTemplateColumns = "1fr";

  const empty = document.createElement("div");
  empty.className = "chart-empty";
  empty.textContent = message;
  elements.chartArea.appendChild(empty);
}

function renderChart(rangeKey, series) {
  elements.chartArea.innerHTML = "";
  elements.chartArea.dataset.range = rangeKey;

  if (!Array.isArray(series) || !series.length) {
    renderEmptyChart("No chart data available.", rangeKey);
    return;
  }

  const values = series.map((item) => toNumber(item.plays));
  const hasAnyValue = values.some((value) => value > 0);

  if (!hasAnyValue) {
    renderEmptyChart("No plays recorded for this period yet.", rangeKey);
    return;
  }

  elements.chartArea.style.gridTemplateColumns = `repeat(${series.length}, minmax(0, 1fr))`;

  const maxSeriesValue = Math.max(...values, 1);
  const visualMax = getNiceAxisMax(maxSeriesValue);

  buildYAxis(visualMax);

  const fragment = document.createDocumentFragment();

  series.forEach((item) => {
    const group = document.createElement("div");
    group.className = "bar-group";

    const col = document.createElement("div");
    col.className = "bar-col";

    const stack = document.createElement("div");
    stack.className = "bar-stack";

    const bg = document.createElement("div");
    bg.className = "bar-bg";

    const fill = document.createElement("div");
    fill.className = "bar-fill";

    const value = toNumber(item.plays);
    const height = value > 0 ? Math.max((value / visualMax) * 100, 2.5) : 0;

    fill.style.height = `${height}%`;
    fill.title = `${item.label}: ${full(value)} plays`;

    if (value === 0) {
      fill.classList.add("zero");
    }

    const label = document.createElement("div");
    label.className = "bar-label";
    label.textContent = item.label;

    stack.appendChild(bg);
    stack.appendChild(fill);
    col.appendChild(stack);
    col.appendChild(label);
    group.appendChild(col);
    fragment.appendChild(group);
  });

  elements.chartArea.appendChild(fragment);
}

function buildTrackStat(symbol, value, suffix = "") {
  const stat = document.createElement("span");
  stat.textContent = `${symbol} ${full(value)}${suffix}`;
  return stat;
}

function renderTracks(tracks) {
  elements.trackList.innerHTML = "";

  if (!Array.isArray(tracks) || !tracks.length) {
    elements.trackList.innerHTML = '<div class="empty-state">No tracks available</div>';
    return;
  }

  const fragment = document.createDocumentFragment();

  tracks.slice(0, 6).forEach((track, index) => {
    const item = document.createElement("div");
    item.className = "track-item";

    const cover = document.createElement("div");
    cover.className = "track-cover";

    if (track.artwork_url) {
      const img = document.createElement("img");
      img.src = track.artwork_url;
      img.alt = track.title || "Track cover";
      img.loading = "lazy";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", () => {
        cover.textContent = String(index + 1);
        img.remove();
      });
      cover.appendChild(img);
    } else {
      cover.textContent = String(index + 1);
    }

    const meta = document.createElement("div");

    const title = document.createElement("div");
    title.className = "track-name";
    title.textContent = track.title || "Untitled";

    const stats = document.createElement("div");
    stats.className = "track-stats";
    stats.appendChild(buildTrackStat("▶", track.playback_count, " plays"));
    stats.appendChild(buildTrackStat("♥", track.likes_count));
    stats.appendChild(buildTrackStat("💬", track.comment_count));

    meta.appendChild(title);
    meta.appendChild(stats);

    item.appendChild(cover);
    item.appendChild(meta);
    fragment.appendChild(item);
  });

  elements.trackList.appendChild(fragment);
}

function getMonthlySeries(series) {
  const source = new Map();

  (Array.isArray(series) ? series : []).forEach((item) => {
    if (!item?.label) {
      return;
    }

    source.set(String(item.label), {
      label: String(item.label),
      plays: toNumber(item.plays)
    });
  });

  return MONTHS.map((label) => source.get(label) || { label, plays: 0 });
}

function getDailySeries(series, referenceDate) {
  const source = new Map();

  (Array.isArray(series) ? series : []).forEach((item) => {
    if (!item?.label) {
      return;
    }

    source.set(String(item.label), {
      label: String(item.label),
      plays: toNumber(item.plays)
    });
  });

  const maxDay = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0).getDate();

  return Array.from({ length: maxDay }, (_, index) => {
    const label = String(index + 1);
    return source.get(label) || { label, plays: 0 };
  });
}

function getYearlySeries(series) {
  return (Array.isArray(series) ? series : [])
    .map((item) => ({
      label: String(item?.label || ""),
      plays: toNumber(item?.plays)
    }))
    .filter((item) => item.label)
    .sort((a, b) => Number(a.label) - Number(b.label));
}

function addDeltaToSeries(series, label, delta) {
  const nextSeries = Array.isArray(series) ? series.map((item) => ({ ...item })) : [];
  const index = nextSeries.findIndex((item) => item.label === label);

  if (index === -1) {
    nextSeries.push({ label, plays: delta });
  } else {
    nextSeries[index] = {
      ...nextSeries[index],
      plays: toNumber(nextSeries[index].plays) + delta
    };
  }

  return nextSeries;
}

function enhanceHistoryWithLiveDelta(history, lastSnapshotTotal, currentTotal, referenceDate) {
  const liveDelta = Math.max(toNumber(currentTotal) - toNumber(lastSnapshotTotal), 0);

  if (liveDelta === 0) {
    return {
      history,
      liveDelta
    };
  }

  const yearLabel = String(referenceDate.getFullYear());
  const monthLabel = MONTHS[referenceDate.getMonth()];
  const dayLabel = String(referenceDate.getDate());

  return {
    liveDelta,
    history: {
      yearly: getYearlySeries(addDeltaToSeries(history.yearly, yearLabel, liveDelta)),
      monthly: getMonthlySeries(addDeltaToSeries(history.monthly, monthLabel, liveDelta)),
      daily: getDailySeries(addDeltaToSeries(history.daily, dayLabel, liveDelta), referenceDate)
    }
  };
}

function buildYearRange(series, sinceYear, referenceDate) {
  const normalized = getYearlySeries(series);
  const currentYear = referenceDate.getFullYear();
  const startYear = Math.min(toNumber(sinceYear) || currentYear, currentYear);
  const map = new Map(normalized.map((item) => [item.label, item]));

  return Array.from({ length: currentYear - startYear + 1 }, (_, index) => {
    const label = String(startYear + index);
    return map.get(label) || { label, plays: 0 };
  });
}

function normalizeHistory(history, referenceDate, sinceYear = referenceDate.getFullYear(), historyMeta = {}) {
  const hasMonthlyMeta = hasOwn(historyMeta, "monthlyYear");
  const hasDailyMeta = hasOwn(historyMeta, "dailyYear") || hasOwn(historyMeta, "dailyMonth");

  const isSameMonthlyYear =
    !hasMonthlyMeta ||
    String(historyMeta.monthlyYear) === String(referenceDate.getFullYear());

  const isSameDailyPeriod =
    !hasDailyMeta ||
    (
      String(historyMeta.dailyYear) === String(referenceDate.getFullYear()) &&
      (
        String(historyMeta.dailyMonth) === String(referenceDate.getMonth() + 1) ||
        String(historyMeta.dailyMonth) === MONTHS[referenceDate.getMonth()] ||
        String(historyMeta.dailyMonth).padStart(2, "0") === String(referenceDate.getMonth() + 1).padStart(2, "0")
      )
    );

  return {
    yearly: buildYearRange(history?.yearly, sinceYear, referenceDate),
    monthly: getMonthlySeries(isSameMonthlyYear ? history?.monthly : []),
    daily: getDailySeries(isSameDailyPeriod ? history?.daily : [], referenceDate)
  };
}

function countNonZeroSeriesItems(series) {
  return (Array.isArray(series) ? series : []).filter((item) => toNumber(item?.plays) > 0).length;
}

function getHistoryScore(history) {
  if (!history) {
    return -1;
  }

  const yearly = Array.isArray(history.yearly) ? history.yearly : [];
  const monthly = Array.isArray(history.monthly) ? history.monthly : [];
  const daily = Array.isArray(history.daily) ? history.daily : [];

  return (
    yearly.length +
    monthly.length +
    daily.length +
    countNonZeroSeriesItems(yearly) * 10 +
    countNonZeroSeriesItems(monthly) * 10 +
    countNonZeroSeriesItems(daily) * 10
  );
}

function pickBestHistory(liveHistory, statsHistory) {
  const liveScore = getHistoryScore(liveHistory);
  const statsScore = getHistoryScore(statsHistory);

  return liveScore >= statsScore ? liveHistory : statsHistory;
}

function mergeDashboardData(liveData, statsData) {
  const referenceDate = getSafeDate(liveData?.updatedAt || statsData?.updatedAt);
  const sourceSinceYear = toNumber(liveData?.sinceYear || statsData?.sinceYear) || 2023;

  const bestHistory = pickBestHistory(liveData?.history, statsData?.history);
  const bestHistoryMeta =
    bestHistory === liveData?.history
      ? (liveData?.historyMeta || {})
      : (statsData?.historyMeta || {});

  const historySource =
    bestHistory === liveData?.history
      ? "remote"
      : bestHistory === statsData?.history
        ? "local"
        : "none";

  const history = normalizeHistory(
    bestHistory,
    referenceDate,
    sourceSinceYear,
    bestHistoryMeta
  );

  const merged = {
    history,
    historySource,
    referenceDate,
    sinceYear: sourceSinceYear,
    playback_count: toNumber(
      liveData?.playback_count ??
      statsData?.playback_count ??
      statsData?.lastTotal
    ),
    likes: toNumber(liveData?.likes ?? statsData?.likes),
    comments: toNumber(liveData?.comments ?? statsData?.comments),
    reposts: toNumber(liveData?.reposts ?? statsData?.reposts),
    downloads: toNumber(liveData?.downloads ?? statsData?.downloads),
    trackCount: toNumber(liveData?.trackCount ?? statsData?.trackCount),
    artist: liveData?.artist || statsData?.artist || "Ploxi",
    trackTitle:
      liveData?.trackTitle ||
      liveData?.title ||
      statsData?.trackTitle ||
      statsData?.lastTrackTitle ||
      "All Tracks",
    tracks: Array.isArray(liveData?.tracks)
      ? liveData.tracks
      : Array.isArray(statsData?.tracks)
        ? statsData.tracks
        : [],
    updatedAt: liveData?.updatedAt || statsData?.updatedAt || null,
    lastTotal: toNumber(
      statsData?.lastTotal ??
      statsData?.playback_count ??
      liveData?.lastTotal ??
      liveData?.playback_count
    )
  };

  const hasSnapshotBaseline =
    hasOwn(statsData, "lastTotal") ||
    hasOwn(statsData, "playback_count") ||
    hasOwn(liveData, "lastTotal");

  merged.hasSnapshotBaseline = hasSnapshotBaseline;
  merged.liveDelta = 0;

  if (hasSnapshotBaseline) {
    const enhanced = enhanceHistoryWithLiveDelta(
      merged.history,
      merged.lastTotal,
      merged.playback_count,
      referenceDate
    );

    merged.history = enhanced.history;
    merged.liveDelta = enhanced.liveDelta;
  }

  return merged;
}

function getRangeSummary(rangeKey, data) {
  const referenceDate = data?.referenceDate || new Date();

  if (rangeKey === "monthly") {
    return `${referenceDate.getFullYear()} by month`;
  }

  if (rangeKey === "daily") {
    return `${MONTHS[referenceDate.getMonth()]} ${referenceDate.getFullYear()} by day`;
  }

  const yearlySeries = Array.isArray(data?.history?.yearly) ? data.history.yearly : [];
  const latestYear = yearlySeries.length ? yearlySeries[yearlySeries.length - 1].label : referenceDate.getFullYear();
  return `${data?.sinceYear || referenceDate.getFullYear()} - ${latestYear}`;
}

function setGrowthText(text, change = "neutral") {
  elements.growthText.textContent = text;
  elements.growthText.dataset.change = change;
}

function updateGrowth(data) {
  if (data?.hasSnapshotBaseline) {
    if (data.liveDelta > 0) {
      setGrowthText(`(+${full(data.liveDelta)} today)`, "positive");
      return;
    }

    setGrowthText("(+0 today)", "neutral");
    return;
  }

  const currentTotal = toNumber(data?.playback_count);

  if (previousLiveCount !== null) {
    const diff = currentTotal - previousLiveCount;

    if (diff > 0) {
      setGrowthText(`(+${full(diff)} live)`, "positive");
    } else if (diff < 0) {
      setGrowthText(`(${full(diff)} live)`, "negative");
    } else {
      setGrowthText("(live)", "neutral");
    }
  } else {
    setGrowthText("(live)", "neutral");
  }

  previousLiveCount = currentTotal;
}

function setStatus(message, tone = "info") {
  elements.statusNote.textContent = message;
  elements.statusNote.dataset.tone = tone;
}

function renderSelectedRange(rangeKey) {
  const series = dashboardData?.history?.[rangeKey] || [];
  elements.periodLabel.textContent = getRangeSummary(rangeKey, dashboardData);
  elements.chartArea.setAttribute("aria-label", `${elements.rangeSelect.selectedOptions[0].textContent} plays chart`);
  renderChart(rangeKey, series);
}

function applyDashboardData(data) {
  const totalPlays = toNumber(data.playback_count);
  const likes = toNumber(data.likes);
  const comments = toNumber(data.comments);
  const reposts = toNumber(data.reposts);
  const downloads = toNumber(data.downloads);
  const trackCount = toNumber(data.trackCount);

  elements.headlinePlays.textContent = full(totalPlays);
  elements.sinceYear.textContent = String(data.sinceYear || 2023);

  elements.playsValue.textContent = full(totalPlays);
  elements.likesValue.textContent = full(likes);
  elements.commentsValue.textContent = full(comments);
  elements.repostsValue.textContent = full(reposts);
  elements.downloadsValue.textContent = full(downloads);
  elements.trackCountValue.textContent = full(trackCount);

  elements.playsChipValue.textContent = `${full(totalPlays)} plays`;
  elements.likesChipValue.textContent = `${full(likes)} likes`;
  elements.commentsChipValue.textContent = `${full(comments)} comments`;
  elements.repostsChipValue.textContent = `${full(reposts)} reposts`;
  elements.downloadsChipValue.textContent = `${full(downloads)} download${downloads === 1 ? "" : "s"}`;

  elements.artistName.textContent = data.artist || "Ploxi";
  elements.trackTitle.textContent = data.trackTitle || "All Tracks";
  elements.lastUpdate.textContent = formatDateTime(data.updatedAt);

  updateGrowth(data);
  renderTracks(data.tracks || []);
  renderSelectedRange(elements.rangeSelect.value);
}

async function fetchJson(url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: controller.signal
    });

    if (!res.ok) {
      throw new Error(`${url} returned HTTP ${res.status}`);
    }

    return await res.json();
  } finally {
    window.clearTimeout(timer);
  }
}

async function loadDashboard() {
  if (isLoading) {
    return;
  }

  isLoading = true;

  try {
    const [liveResult, statsResult] = await Promise.allSettled([
      fetchJson(API_URL),
      fetchJson(STATS_URL, 8000)
    ]);

    const liveData = liveResult.status === "fulfilled" ? liveResult.value : null;
    const statsData = statsResult.status === "fulfilled" ? statsResult.value : null;

    if (!liveData && !statsData) {
      throw new Error("Live API and cached stats are both unavailable.");
    }

    dashboardData = mergeDashboardData(liveData, statsData);
    applyDashboardData(dashboardData);

    if (liveData && statsData) {
      setStatus("Live stats connected", "live");
    } else if (liveData) {
      setStatus("Live stats loaded — cached history unavailable", "info");
    } else {
      setStatus("Live API unavailable — showing cached stats", "warning");
    }
  } catch (err) {
    console.error("Dashboard error:", err);
    elements.headlinePlays.textContent = "Error";
    elements.trackTitle.textContent = err.message;
    elements.lastUpdate.textContent = "Unavailable";
    renderTracks([]);
    renderEmptyChart("Could not load chart data.", elements.rangeSelect.value);
    setGrowthText("(offline)", "neutral");
    setStatus("Unable to load dashboard", "error");
  } finally {
    isLoading = false;
  }
}

elements.rangeSelect.addEventListener("change", (event) => {
  renderSelectedRange(event.target.value);
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    void loadDashboard();
  }
});

void loadDashboard();
window.setInterval(() => {
  if (document.hidden) {
    return;
  }

  void loadDashboard();
}, REFRESH_INTERVAL_MS);
