import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Users, TrendingUp, Crown, Clock, Server, Wifi, WifiOff,
  Activity, RefreshCw, Copy, Check, Zap, Shield, Globe, BarChart3
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────

interface ServerStatus {
  online: boolean;
  ip: string;
  port: number;
  hostname: string;
  version: string;
  players: {
    online: number;
    max: number;
    list?: { name: string; uuid: string }[];
  };
  motd: {
    clean: string[];
  };
  icon?: string;
}

interface HistoryPoint {
  timestamp: number;
  players: number;
  online: boolean;
}

interface DailyRecord {
  date: string; // "2026-05-17"
  maxPlayers: number;
}

interface StatsData {
  history: HistoryPoint[];
  monthlyHistory: DailyRecord[];
  allTimeRecord: number;
  allTimeRecordDate: string;
  todayMax: number;
  uptimeChecks: number;
  uptimeOnline: number;
  lastUpdate: number;
}

// ─── Constants ───────────────────────────────────────────

const SERVER_ADDRESS = 'mc.asuxgrief.ru';
const API_URL = `https://api.mcsrvstat.us/3/${SERVER_ADDRESS}`;
const REFRESH_INTERVAL = 30000;
const STORAGE_KEY = 'mc_stats_24h_v3';
const STATS_DELAY = 200;
const ROLLING_HOURS = 24;

// ─── Helpers ─────────────────────────────────────────────

function getDayKey(): string {
  return new Date().toISOString().split('T')[0];
}

function loadStats(): StatsData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data: StatsData = JSON.parse(raw);
      // Keep only last 24h of history
      const cutoff = Date.now() - ROLLING_HOURS * 60 * 60 * 1000;
      data.history = data.history.filter(p => p.timestamp >= cutoff);
      // Reset todayMax if day changed
      const today = getDayKey();
      const lastPoint = data.history[data.history.length - 1];
      if (lastPoint) {
        const pointDay = new Date(lastPoint.timestamp).toISOString().split('T')[0];
        if (pointDay !== today) {
          // Recalculate todayMax from only today's points
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const todayPoints = data.history.filter(p => p.timestamp >= todayStart.getTime());
          data.todayMax = todayPoints.length > 0 ? Math.max(...todayPoints.map(p => p.players)) : 0;
        }
      }
      // Keep only last 30 days of monthly history
      if (!data.monthlyHistory) data.monthlyHistory = [];
      const thirtyDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
      data.monthlyHistory = data.monthlyHistory.filter(d => {
        const dayTs = new Date(d.date).getTime();
        return dayTs >= thirtyDaysAgo;
      });
      return data;
    }
  } catch { /* ignore corrupt data */ }
  return {
    history: [],
    monthlyHistory: [],
    allTimeRecord: 0,
    allTimeRecordDate: '',
    todayMax: 0,
    uptimeChecks: 0,
    uptimeOnline: 0,
    lastUpdate: 0,
  };
}

function saveStats(data: StatsData) {
  try {
    // Keep up to 2880 points (24h at 30s)
    data.history = data.history.slice(-2880);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* storage full */ }
}

function formatUptime(upOnline: number, upChecks: number): string {
  if (upChecks === 0) return '—';
  return `${((upOnline / upChecks) * 100).toFixed(1)}%`;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('ru-RU', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
  } catch {
    return dateStr;
  }
}

function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  });
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('ru-RU', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

// ─── Sparkline Component (rolling 24h) ───────────────────

function Sparkline({ data, width = 800, height = 220 }: {
  data: HistoryPoint[];
  width?: number;
  height?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverVbX, setHoverVbX] = useState<number | null>(null);

  const nowTs = Date.now();
  const windowStart = nowTs - ROLLING_HOURS * 60 * 60 * 1000;
  const windowEnd = nowTs;
  const windowMs = windowEnd - windowStart;

  // "Nice" max for Y axis
  const dataMax = data.length > 0 ? Math.max(...data.map(d => d.players)) : 0;
  const yMaxNice = Math.ceil(Math.max(dataMax * 1.25, 5) / 5) * 5;

  const pad = { top: 12, right: 16, bottom: 28, left: 44 };
  const cW = width - pad.left - pad.right;
  const cH = height - pad.top - pad.bottom;

  const xForTs = (ts: number) => pad.left + ((ts - windowStart) / windowMs) * cW;
  const yForVal = (v: number) => pad.top + cH - (v / yMaxNice) * cH;

  // Dynamic time labels: every 3 hours within window
  const hourLabels = useMemo(() => {
    const labels: { x: number; label: string; ts: number }[] = [];
    // Find first round 3h mark >= windowStart
    const threeH = 3 * 3600 * 1000;
    const firstTick = Math.ceil(windowStart / threeH) * threeH;
    for (let ts = firstTick; ts <= windowEnd; ts += threeH) {
      const d = new Date(ts);
      const h = d.getHours();
      labels.push({
        x: xForTs(ts),
        label: `${String(h).padStart(2, '0')}:00`,
        ts,
      });
    }
    return labels;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowTs, windowStart]);

  // Y grid lines
  const ySteps = 5;
  const yGridLines = Array.from({ length: ySteps + 1 }, (_, i) => {
    const val = Math.round((i / ySteps) * yMaxNice);
    return { y: yForVal(val), label: val };
  });

  // Build SVG points
  const realPoints = useMemo(() => data
    .filter(d => d.timestamp >= windowStart && d.timestamp <= windowEnd)
    .map(d => ({
      x: xForTs(d.timestamp),
      y: yForVal(d.players),
      players: d.players,
      time: d.timestamp,
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, windowStart, yMaxNice]
  );

  const nowX = xForTs(nowTs);

  // SVG paths
  let linePath = '';
  let areaPath = '';
  if (realPoints.length >= 2) {
    linePath = realPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    areaPath = `${linePath} L ${realPoints[realPoints.length - 1].x} ${yForVal(0)} L ${realPoints[0].x} ${yForVal(0)} Z`;
  }

  // Hover interpolation
  const dataLen = data.length;
  const hovered = useMemo(() => {
    if (hoverVbX === null || realPoints.length === 0) return null;
    if (realPoints.length === 1) return realPoints[0];

    let leftIdx = 0;
    for (let i = 0; i < realPoints.length; i++) {
      if (realPoints[i].x <= hoverVbX) leftIdx = i;
    }
    const rightIdx = Math.min(leftIdx + 1, realPoints.length - 1);
    const left = realPoints[leftIdx];
    const right = realPoints[rightIdx];
    if (leftIdx === rightIdx) return left;

    const t = Math.max(0, Math.min(1, (hoverVbX - left.x) / (right.x - left.x)));
    return {
      x: hoverVbX,
      y: left.y + t * (right.y - left.y),
      players: Math.round(left.players + t * (right.players - left.players)),
      time: Math.round(left.time + t * (right.time - left.time)),
    };
  }, [hoverVbX, realPoints, dataLen]);

  // Mouse handlers
  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width === 0) return;
    setHoverVbX((e.clientX - rect.left) * (width / rect.width));
  }, [width]);

  const handleMouseLeave = useCallback(() => setHoverVbX(null), []);

  // Tooltip
  const tooltipW = 136;
  const tooltipH = 48;
  const tooltipOff = 14;
  const tooltipX = hovered
    ? (hovered.x + tooltipOff + tooltipW > pad.left + cW
      ? hovered.x - tooltipOff - tooltipW
      : hovered.x + tooltipOff)
    : 0;
  const tooltipY = hovered
    ? Math.max(pad.top, Math.min(hovered.y - tooltipH / 2, pad.top + cH - tooltipH))
    : 0;

  // Peaks
  const peaks = realPoints.filter(p => p.players === dataMax && dataMax > 0);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-full cursor-crosshair"
      preserveAspectRatio="xMidYMid meet"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FB923C" stopOpacity="0.4" />
          <stop offset="50%" stopColor="#FB923C" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#FB923C" stopOpacity="0.01" />
        </linearGradient>
        <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#FBBF24" />
          <stop offset="50%" stopColor="#FB923C" />
          <stop offset="100%" stopColor="#FBBF24" />
        </linearGradient>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
        <filter id="tipShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" in="SourceAlpha" result="shadow" />
          <feFlood floodColor="#FB923C" floodOpacity="0.25" result="color" />
          <feComposite in="color" in2="shadow" operator="in" result="cs" />
          <feOffset dy="2" result="os" />
          <feMerge>
            <feMergeNode in="os" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Y grid */}
      {yGridLines.map((gl, i) => (
        <g key={`y${i}`}>
          <line x1={pad.left} y1={gl.y} x2={pad.left + cW} y2={gl.y}
            stroke="rgba(251,146,60,0.07)" strokeDasharray="4,4" />
          <text x={pad.left - 8} y={gl.y + 4} textAnchor="end"
            fill="rgba(251,146,60,0.35)" fontSize="9" fontFamily="'JetBrains Mono', monospace">
            {gl.label}
          </text>
        </g>
      ))}

      {/* Vertical grid at each 3h tick */}
      {hourLabels.map((hl, i) => (
        <line key={`vl${i}`} x1={hl.x} y1={pad.top} x2={hl.x} y2={pad.top + cH}
          stroke="rgba(251,146,60,0.06)" />
      ))}

      {/* Area */}
      {areaPath && <path d={areaPath} fill="url(#areaGrad)" />}

      {/* Line glow layers */}
      {linePath && (
        <path d={linePath} fill="none" stroke="#FB923C" strokeWidth="10"
          strokeLinecap="round" strokeLinejoin="round" opacity="0.15" />
      )}
      {linePath && (
        <path d={linePath} fill="none" stroke="#FB923C" strokeWidth="5"
          strokeLinecap="round" strokeLinejoin="round" opacity="0.3" />
      )}
      {linePath && (
        <path d={linePath} fill="none" stroke="url(#lineGrad)" strokeWidth="3.5"
          strokeLinecap="round" strokeLinejoin="round" filter="url(#glow)" />
      )}

      {/* "Now" marker at right edge */}
      {nowX >= pad.left && nowX <= pad.left + cW && (
        <g>
          <line x1={nowX} y1={pad.top} x2={nowX} y2={pad.top + cH}
            stroke="#FB923C" strokeWidth="1" strokeDasharray="6,3" opacity="0.5" />
          <text x={nowX} y={pad.top - 2} textAnchor="middle"
            fill="#FB923C" fontSize="8" fontWeight="600" opacity="0.7"
            fontFamily="'JetBrains Mono', monospace">
            сейчас
          </text>
        </g>
      )}

      {/* Peak dots */}
      {peaks.map((p, i) => {
        if (i > 0 && Math.abs(p.x - peaks[i - 1].x) < 15) return null;
        if (hovered && Math.abs(hovered.x - p.x) < 12) return null;
        return (
          <g key={`pk${i}`}>
            <circle cx={p.x} cy={p.y} r="4.5" fill="#0f0a07" stroke="#FB923C" strokeWidth="2" />
            <text x={p.x} y={p.y - 10} textAnchor="middle"
              fill="#FBBF24" fontSize="9" fontWeight="700"
              fontFamily="'JetBrains Mono', monospace">
              {p.players}
            </text>
          </g>
        );
      })}

      {/* Single dot */}
      {realPoints.length === 1 && !(hovered && Math.abs(hovered.x - realPoints[0].x) < 12) && (
        <circle cx={realPoints[0].x} cy={realPoints[0].y} r="4.5"
          fill="#0f0a07" stroke="#FB923C" strokeWidth="2" />
      )}

      {/* No data */}
      {realPoints.length === 0 && (
        <text x={pad.left + cW / 2} y={pad.top + cH / 2} textAnchor="middle" dominantBaseline="middle"
          fill="rgba(251,146,60,0.25)" fontSize="13" fontFamily="Inter, sans-serif">
          Ожидание данных...
        </text>
      )}

      {/* Axes */}
      <line x1={pad.left} y1={pad.top + cH} x2={pad.left + cW} y2={pad.top + cH}
        stroke="rgba(251,146,60,0.15)" strokeWidth="1" />
      <line x1={pad.left} y1={pad.top} x2={pad.left} y2={pad.top + cH}
        stroke="rgba(251,146,60,0.15)" strokeWidth="1" />

      {/* Time labels */}
      {hourLabels.map((hl, i) => (
        <text key={`tl${i}`} x={hl.x} y={height - 6} textAnchor="middle"
          fill="rgba(251,146,60,0.45)" fontSize="9" fontFamily="'JetBrains Mono', monospace">
          {hl.label}
        </text>
      ))}

      {/* ── Hover tooltip ── */}
      {hovered && (
        <g>
          <line x1={hovered.x} y1={pad.top} x2={hovered.x} y2={pad.top + cH}
            stroke="rgba(251,146,60,0.35)" strokeWidth="1" strokeDasharray="4,3" />
          <line x1={pad.left} y1={hovered.y} x2={pad.left + cW} y2={hovered.y}
            stroke="rgba(251,146,60,0.15)" strokeWidth="1" strokeDasharray="4,3" />
          <circle cx={hovered.x} cy={hovered.y} r="10" fill="#FB923C" opacity="0.12" />
          <circle cx={hovered.x} cy={hovered.y} r="6" fill="#FB923C" opacity="0.15" />
          <circle cx={hovered.x} cy={hovered.y} r="4" fill="#FB923C" stroke="#fff" strokeWidth="1.5" />

          <g filter="url(#tipShadow)">
            <rect x={tooltipX} y={tooltipY} width={tooltipW} height={tooltipH}
              rx="8" fill="rgba(20,12,6,0.94)" stroke="rgba(251,146,60,0.4)" strokeWidth="1" />
            <text x={tooltipX + 12} y={tooltipY + 20}
              fill="#FB923C" fontSize="13" fontWeight="700"
              fontFamily="'JetBrains Mono', monospace">
              {hovered.players} игроков
            </text>
            <text x={tooltipX + 12} y={tooltipY + 38}
              fill="rgba(251,191,36,0.75)" fontSize="10" fontWeight="500"
              fontFamily="'JetBrains Mono', monospace">
              {fmtTime(hovered.time)}
            </text>
          </g>
        </g>
      )}
    </svg>
  );
}

// ─── Monthly BarChart Component ──────────────────────────

function MonthlyBarChart({ data, width = 800, height = 240 }: {
  data: DailyRecord[];
  width?: number;
  height?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const pad = { top: 14, right: 12, bottom: 42, left: 40 };
  const cW = width - pad.left - pad.right;
  const cH = height - pad.top - pad.bottom;

  const maxVal = data.length > 0 ? Math.max(...data.map(d => d.maxPlayers), 1) : 1;
  const yMaxNice = Math.ceil(maxVal * 1.2 / 5) * 5;

  const barGap = 4;
  const barW = data.length > 0 ? Math.max(8, (cW - barGap * (data.length - 1)) / data.length) : 20;
  const totalBarsW = data.length > 0 ? data.length * barW + (data.length - 1) * barGap : 0;
  const startX = pad.left + (cW - totalBarsW) / 2;

  const yForVal = (v: number) => pad.top + cH - (v / yMaxNice) * cH;

  // Y grid
  const ySteps = 4;
  const yGridLines = Array.from({ length: ySteps + 1 }, (_, i) => {
    const val = Math.round((i / ySteps) * yMaxNice);
    return { y: yForVal(val), label: val };
  });

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || data.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width === 0) return;
    const mx = (e.clientX - rect.left) * (width / rect.width);
    const idx = Math.floor((mx - startX) / (barW + barGap));
    if (idx >= 0 && idx < data.length) {
      setHoverIdx(idx);
    } else {
      setHoverIdx(null);
    }
  }, [width, startX, barW, barGap, data.length]);

  const handleMouseLeave = useCallback(() => setHoverIdx(null), []);

  // Tooltip
  const hoveredBar = hoverIdx !== null ? data[hoverIdx] : null;
  const hoveredX = hoverIdx !== null ? startX + hoverIdx * (barW + barGap) + barW / 2 : 0;
  const tooltipW = 140;
  const tooltipH = 44;
  const ttX = hoveredBar
    ? (hoveredX + tooltipW / 2 + 8 > pad.left + cW
      ? hoveredX - tooltipW / 2 - 8
      : hoveredX - tooltipW / 2 + 8)
    : 0;
  const barTop = hoveredBar ? yForVal(hoveredBar.maxPlayers) : 0;
  const ttY = hoveredBar ? Math.max(pad.top, barTop - tooltipH - 12) : 0;

  const fmtDay = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    } catch { return dateStr; }
  };

  const fmtDayFull = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch { return dateStr; }
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-full cursor-pointer"
      preserveAspectRatio="xMidYMid meet"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <defs>
        <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FB923C" />
          <stop offset="100%" stopColor="#9A3412" />
        </linearGradient>
        <linearGradient id="barGradHover" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FBBF24" />
          <stop offset="100%" stopColor="#FB923C" />
        </linearGradient>
        <filter id="barGlow" x="-20%" y="-10%" width="140%" height="120%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Y grid */}
      {yGridLines.map((gl, i) => (
        <g key={`y${i}`}>
          <line x1={pad.left} y1={gl.y} x2={pad.left + cW} y2={gl.y}
            stroke="rgba(251,146,60,0.07)" strokeDasharray="4,4" />
          <text x={pad.left - 8} y={gl.y + 4} textAnchor="end"
            fill="rgba(251,146,60,0.35)" fontSize="9" fontFamily="'JetBrains Mono', monospace">
            {gl.label}
          </text>
        </g>
      ))}

      {/* Bars */}
      {data.map((d, i) => {
        const x = startX + i * (barW + barGap);
        const barH = Math.max(2, (d.maxPlayers / yMaxNice) * cH);
        const y = pad.top + cH - barH;
        const isHovered = hoverIdx === i;
        return (
          <g key={d.date}>
            {/* Bar shadow */}
            <rect
              x={x - 1} y={y + 2}
              width={barW + 2} height={barH}
              rx={isHovered ? 5 : 4}
              fill="rgba(251,146,60,0.08)"
            />
            {/* Bar */}
            <rect
              x={x} y={y}
              width={barW} height={barH}
              rx={isHovered ? 5 : 4}
              fill={isHovered ? 'url(#barGradHover)' : 'url(#barGrad)'}
              opacity={isHovered ? 1 : 0.85}
              filter={isHovered ? 'url(#barGlow)' : undefined}
              className="transition-all duration-200"
            />
            {/* Value on top of hovered bar */}
            {isHovered && (
              <text
                x={x + barW / 2} y={y - 6} textAnchor="middle"
                fill="#FBBF24" fontSize="11" fontWeight="700"
                fontFamily="'JetBrains Mono', monospace"
              >
                {d.maxPlayers}
              </text>
            )}
          </g>
        );
      })}

      {/* No data */}
      {data.length === 0 && (
        <text x={pad.left + cW / 2} y={pad.top + cH / 2} textAnchor="middle" dominantBaseline="middle"
          fill="rgba(251,146,60,0.25)" fontSize="13" fontFamily="Inter, sans-serif">
          Данных за 30 дней пока нет...
        </text>
      )}

      {/* Axes */}
      <line x1={pad.left} y1={pad.top + cH} x2={pad.left + cW} y2={pad.top + cH}
        stroke="rgba(251,146,60,0.15)" strokeWidth="1" />
      <line x1={pad.left} y1={pad.top} x2={pad.left} y2={pad.top + cH}
        stroke="rgba(251,146,60,0.15)" strokeWidth="1" />

      {/* X labels — show every Nth label to avoid overlap */}
      {data.map((d, i) => {
        // Show label based on available space
        const showEvery = data.length > 20 ? 5 : data.length > 10 ? 3 : data.length > 5 ? 2 : 1;
        const show = i % showEvery === 0 || i === data.length - 1;
        if (!show) return null;
        const x = startX + i * (barW + barGap) + barW / 2;
        return (
          <text key={`xl${i}`} x={x} y={height - 20} textAnchor="middle"
            fill="rgba(251,146,60,0.45)" fontSize="8" fontFamily="'JetBrains Mono', monospace">
            {fmtDay(d.date)}
          </text>
        );
      })}

      {/* Hover tooltip */}
      {hoveredBar && (
        <g>
          {/* Vertical highlight line */}
          <line x1={hoveredX} y1={pad.top} x2={hoveredX} y2={pad.top + cH}
            stroke="rgba(251,146,60,0.2)" strokeWidth="1" strokeDasharray="3,3" />
          {/* Tooltip box */}
          <rect x={ttX} y={ttY} width={tooltipW} height={tooltipH}
            rx="8" fill="rgba(20,12,6,0.94)" stroke="rgba(251,146,60,0.4)" strokeWidth="1" />
          <text x={ttX + 12} y={ttY + 18}
            fill="#FB923C" fontSize="13" fontWeight="700"
            fontFamily="'JetBrains Mono', monospace">
            {hoveredBar.maxPlayers} макс.
          </text>
          <text x={ttX + 12} y={ttY + 35}
            fill="rgba(251,191,36,0.75)" fontSize="10"
            fontFamily="'JetBrains Mono', monospace">
            {fmtDayFull(hoveredBar.date)}
          </text>
        </g>
      )}
    </svg>
  );
}

// ─── Stat Card Component ─────────────────────────────────

function StatCard({ icon: Icon, label, value, subValue, color, delay, pulse }: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  subValue?: string;
  color: string;
  delay: number;
  pulse?: boolean;
}) {
  return (
    <div
      className="glass-card rounded-2xl p-5 md:p-6 transition-all duration-300 animate-fade-in-up group"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 md:w-12 md:h-12 rounded-xl flex items-center justify-center ${color} transition-transform duration-300 group-hover:scale-110`}>
          <Icon size={20} className="text-white md:w-6 md:h-6" />
        </div>
        {pulse && (
          <div className="w-3 h-3 rounded-full bg-orange-400 animate-pulse-glow" />
        )}
      </div>
      <div className="stat-number text-2xl md:text-3xl font-bold text-white mb-1">
        {value}
      </div>
      <div className="text-orange-400/60 text-sm font-medium">{label}</div>
      {subValue && (
        <div className="text-orange-500/40 text-xs mt-1">{subValue}</div>
      )}
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────

export default function App() {
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<StatsData>(loadStats);
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL / 1000);

  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchServer = useCallback(async (manual = false) => {
    if (manual) setLoading(true);
    setRefreshing(true);
    setError(null);

    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    try {
      const res = await fetch(API_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ServerStatus = await res.json();
      setServerStatus(data);

      setStats(prev => {
        const updated = { ...prev };
        const now = Date.now();

        updated.history = [...updated.history, {
          timestamp: now,
          players: data.online ? data.players.online : 0,
          online: data.online,
        }];

        // Trim to last 24h
        const cutoff = now - ROLLING_HOURS * 60 * 60 * 1000;
        updated.history = updated.history.filter(p => p.timestamp >= cutoff);

        updated.uptimeChecks += 1;
        if (data.online) updated.uptimeOnline += 1;

        // Today max (from midnight today)
        if (data.online) {
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const todayPoints = updated.history.filter(p => p.timestamp >= todayStart.getTime());
          updated.todayMax = todayPoints.length > 0
            ? Math.max(...todayPoints.map(p => p.players))
            : data.players.online;

          if (data.players.online > updated.allTimeRecord) {
            updated.allTimeRecord = data.players.online;
            updated.allTimeRecordDate = getDayKey();
          }

          // Update monthly history — save today's peak
          const todayKey = getDayKey();
          const existing = updated.monthlyHistory.find(d => d.date === todayKey);
          if (existing) {
            existing.maxPlayers = Math.max(existing.maxPlayers, updated.todayMax);
          } else {
            updated.monthlyHistory.push({ date: todayKey, maxPlayers: updated.todayMax });
          }
          // Keep last 30 days
          const cutoff30 = Date.now() - 31 * 24 * 60 * 60 * 1000;
          updated.monthlyHistory = updated.monthlyHistory.filter(d =>
            new Date(d.date).getTime() >= cutoff30
          );
          updated.monthlyHistory.sort((a, b) => a.date.localeCompare(b.date));
        }

        updated.lastUpdate = now;
        saveStats(updated);
        return updated;
      });
    } catch (err) {
      const msg = err instanceof TypeError
        ? 'Ошибка подключения к API'
        : err instanceof Error ? err.message : 'Неизвестная ошибка';
      setError(msg);
      retryTimerRef.current = setTimeout(() => fetchServer(), 5000);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLastRefresh(Date.now());
    }
  }, []);

  useEffect(() => {
    fetchServer();
    const interval = setInterval(fetchServer, REFRESH_INTERVAL);
    return () => {
      clearInterval(interval);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [fetchServer]);

  const uptimePercent = useMemo(() =>
    formatUptime(stats.uptimeOnline, stats.uptimeChecks),
    [stats.uptimeOnline, stats.uptimeChecks]
  );

  // Chart stats from history
  const chartStats = useMemo(() => {
    if (stats.history.length === 0) return { min: 0, max: 0, avg: 0 };
    const players = stats.history.map(p => p.players);
    return {
      min: Math.min(...players),
      max: Math.max(...players),
      avg: Math.round(players.reduce((a, b) => a + b, 0) / players.length),
    };
  }, [stats.history]);

  // Time range for display
  const timeRange = useMemo(() => {
    if (stats.history.length === 0) return null;
    const first = stats.history[0].timestamp;
    const last = stats.history[stats.history.length - 1].timestamp;
    return { from: first, to: last };
  }, [stats.history]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(SERVER_ADDRESS).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  // Countdown tick
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setTick(t => t + 1);
      setCountdown(prev => (prev <= 1 ? REFRESH_INTERVAL / 1000 : prev - 1));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setCountdown(REFRESH_INTERVAL / 1000);
  }, [lastRefresh]);

  // ─── Render ──────────────────────────────────────────

  if (loading && !serverStatus) {
    return (
      <div className="min-h-screen bg-mc-dark flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-orange-500/20 flex items-center justify-center animate-float">
            <Server size={32} className="text-orange-400" />
          </div>
          <div className="text-orange-400 text-lg font-medium mb-2">Загрузка статистики...</div>
          <div className="text-orange-600/50 text-sm">Подключение к {SERVER_ADDRESS}</div>
          <div className="mt-4 flex justify-center gap-1">
            {[0, 1, 2].map(i => (
              <div key={i}
                className="w-2 h-2 rounded-full bg-orange-400 animate-pulse-glow"
                style={{ animationDelay: `${i * 200}ms` }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-mc-dark bg-grid relative overflow-hidden">
      {/* Refresh progress bar */}
      <div className="fixed top-0 left-0 right-0 z-50 h-1 bg-orange-500/10">
        <div
          className="h-full bg-gradient-to-r from-orange-500 to-amber-400 transition-all duration-1000 ease-linear"
          style={{ width: `${((REFRESH_INTERVAL / 1000 - countdown) / (REFRESH_INTERVAL / 1000)) * 100}%` }}
        />
      </div>

      {/* Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-orange-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-orange-500/3 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-6 md:py-10">

        {/* Header */}
        <header className="mb-8 md:mb-10 animate-fade-in-up">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            {serverStatus?.icon ? (
              <img src={serverStatus.icon} alt="Server Icon"
                className="w-14 h-14 md:w-16 md:h-16 rounded-xl shadow-lg shadow-orange-500/20 border border-orange-500/20" />
            ) : (
              <div className="w-14 h-14 md:w-16 md:h-16 rounded-xl bg-orange-500/20 border border-orange-500/20 flex items-center justify-center">
                <Server size={28} className="text-orange-400" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl md:text-3xl font-bold text-white mb-1 truncate">
                {serverStatus?.motd?.clean?.[0] || SERVER_ADDRESS}
              </h1>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={handleCopy}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-400 text-sm font-mono hover:bg-orange-500/20 transition-all duration-200 cursor-pointer">
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? 'Скопировано!' : SERVER_ADDRESS}
                </button>
                {serverStatus && (
                  <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${
                    serverStatus.online
                      ? 'bg-orange-500/15 text-orange-400 border border-orange-500/20'
                      : 'bg-red-500/15 text-red-400 border border-red-500/20'
                  }`}>
                    {serverStatus.online ? <Wifi size={14} /> : <WifiOff size={14} />}
                    {serverStatus.online ? 'Онлайн' : 'Оффлайн'}
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <button onClick={() => fetchServer(true)}
                className="flex items-center gap-2 text-orange-500/60 hover:text-orange-400 text-xs shrink-0 cursor-pointer px-2 py-1 rounded-lg hover:bg-orange-500/10 transition-all"
                title="Обновить сейчас">
                <RefreshCw size={14}
                  className={`transition-transform duration-500 ${refreshing ? 'animate-spin' : ''}`} />
                <span>{refreshing ? 'Обновление...' : 'Обновить'}</span>
              </button>
              <div className="text-orange-500/30 text-[10px] font-mono">
                авто-обновление через {countdown} сек
              </div>
            </div>
          </div>
        </header>

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm animate-fade-in-up">
            <strong>Ошибка:</strong> {error}. Автоматический повтор через 5 сек.
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6 md:mb-8">
          <StatCard icon={Users} label="Текущий онлайн"
            value={serverStatus?.online ? serverStatus.players.online : '—'}
            subValue={serverStatus ? `из ${serverStatus.players.max} слотов` : undefined}
            color="bg-orange-500/20" delay={100}
            pulse={serverStatus?.online && serverStatus.players.online > 0} />
          <StatCard icon={TrendingUp} label="Максимум за сегодня"
            value={stats.todayMax || '—'} subValue={getDayKey()}
            color="bg-amber-500/20" delay={200} />
          <StatCard icon={Crown} label="Рекорд за всё время"
            value={stats.allTimeRecord || '—'}
            subValue={stats.allTimeRecordDate ? formatDate(stats.allTimeRecordDate) : undefined}
            color="bg-yellow-500/20" delay={300} />
          <StatCard icon={Shield} label="Аптайм"
            value={uptimePercent}
            subValue={`из ${stats.uptimeChecks} проверок`}
            color="bg-rose-500/20" delay={400} />
        </div>

        {/* Chart */}
        <div className="glass-card rounded-2xl p-5 md:p-6 mb-6 md:mb-8 animate-fade-in-up"
          style={{ animationDelay: `${STATS_DELAY * 5}ms` }}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <BarChart3 size={18} className="text-orange-400" />
              <h2 className="text-lg font-semibold text-white">Онлайн за 24 часа</h2>
            </div>
            {timeRange && (
              <div className="text-orange-500/40 text-xs font-mono">
                {fmtDateTime(timeRange.from)} — {fmtDateTime(timeRange.to)}
              </div>
            )}
          </div>

          {/* Min / Max / Avg badges */}
          {stats.history.length > 0 && (
            <div className="flex items-center gap-4 mb-3 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-400/60" />
                <span className="text-orange-400/50">Мин:</span>
                <span className="text-white font-mono font-semibold">{chartStats.min}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400/60" />
                <span className="text-orange-400/50">Макс:</span>
                <span className="text-white font-mono font-semibold">{chartStats.max}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400/60" />
                <span className="text-orange-400/50">Среднее:</span>
                <span className="text-white font-mono font-semibold">{chartStats.avg}</span>
              </div>
              <div className="text-orange-500/30 ml-auto font-mono">
                {stats.history.length} точек
              </div>
            </div>
          )}

          <div className="h-48 md:h-56">
            <Sparkline data={stats.history} width={800} height={220} />
          </div>
        </div>

        {/* Monthly Chart */}
        <div className="glass-card rounded-2xl p-5 md:p-6 mb-6 md:mb-8 animate-fade-in-up"
          style={{ animationDelay: `${STATS_DELAY * 5}ms` }}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <BarChart3 size={18} className="text-orange-400" />
              <h2 className="text-lg font-semibold text-white">Максимальный онлайн за 30 дней</h2>
            </div>
            {stats.monthlyHistory.length > 0 && (
              <div className="text-orange-500/40 text-xs font-mono">
                {stats.monthlyHistory[0].date} — {stats.monthlyHistory[stats.monthlyHistory.length - 1].date}
              </div>
            )}
          </div>
          {stats.monthlyHistory.length > 0 && (
            <div className="flex items-center gap-4 mb-3 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-orange-400/60" />
                <span className="text-orange-400/50">Лучший день:</span>
                <span className="text-white font-mono font-semibold">
                  {stats.monthlyHistory.reduce((best, d) => d.maxPlayers > best.maxPlayers ? d : best, stats.monthlyHistory[0]).maxPlayers}
                </span>
                <span className="text-orange-400/40 font-mono text-[10px]">
                  ({new Date(stats.monthlyHistory.reduce((best, d) => d.maxPlayers > best.maxPlayers ? d : best, stats.monthlyHistory[0]).date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })})
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400/60" />
                <span className="text-orange-400/50">Средний пик:</span>
                <span className="text-white font-mono font-semibold">
                  {Math.round(stats.monthlyHistory.reduce((s, d) => s + d.maxPlayers, 0) / stats.monthlyHistory.length)}
                </span>
              </div>
              <div className="text-orange-500/30 ml-auto font-mono">
                {stats.monthlyHistory.length} дней
              </div>
            </div>
          )}
          <div className="h-52 md:h-60">
            <MonthlyBarChart data={stats.monthlyHistory} width={800} height={240} />
          </div>
        </div>

        {/* Bottom Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 mb-6 md:mb-8">
          {/* Server Info */}
          <div className="glass-card rounded-2xl p-5 md:p-6 animate-fade-in-up"
            style={{ animationDelay: `${STATS_DELAY * 6}ms` }}>
            <div className="flex items-center gap-2 mb-4">
              <Server size={18} className="text-orange-400" />
              <h2 className="text-lg font-semibold text-white">Информация о сервере</h2>
            </div>
            <div className="space-y-3">
              {[
                { label: 'IP адрес', value: serverStatus?.ip || '—', icon: Globe },
                { label: 'Порт', value: serverStatus?.port?.toString() || '—', icon: Zap },
                { label: 'Версия', value: serverStatus?.version || '—', icon: Activity },
                { label: 'Хостнейм', value: serverStatus?.hostname || SERVER_ADDRESS, icon: Wifi },
              ].map((item, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-orange-500/8 last:border-0">
                  <div className="flex items-center gap-2 text-orange-400/60 text-sm">
                    <item.icon size={14} />
                    {item.label}
                  </div>
                  <div className="text-white text-sm font-mono">{item.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Players / MOTD */}
          <div className="glass-card rounded-2xl p-5 md:p-6 animate-fade-in-up"
            style={{ animationDelay: `${STATS_DELAY * 7}ms` }}>
            <div className="flex items-center gap-2 mb-4">
              <Users size={18} className="text-orange-400" />
              <h2 className="text-lg font-semibold text-white">
                {serverStatus?.players?.list?.length ? 'Игроки онлайн' : 'Сообщение сервера'}
              </h2>
            </div>
            {serverStatus?.players?.list && serverStatus.players.list.length > 0 ? (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {serverStatus.players.list.map((player, i) => (
                  <div key={player.uuid || i}
                    className="flex items-center gap-3 p-2 rounded-lg bg-orange-500/5 hover:bg-orange-500/10 transition-colors">
                    <img src={`https://mc-heads.net/avatar/${player.uuid}/24`}
                      alt={player.name} className="w-6 h-6 rounded" />
                    <span className="text-white text-sm font-medium">{player.name}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {serverStatus?.motd?.clean?.map((line, i) => (
                  <div key={i} className="text-orange-300/80 text-sm leading-relaxed">
                    {line || '—'}
                  </div>
                )) || (
                  <div className="text-orange-400/40 text-sm">Нет данных</div>
                )}
                {serverStatus?.online && (
                  <div className="mt-4 pt-3 border-t border-orange-500/10">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-orange-400/50">Игроков на сервере</span>
                      <span className="text-white font-mono font-bold">
                        {serverStatus.players.online} / {serverStatus.players.max}
                      </span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-orange-500/10 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400 transition-all duration-1000"
                        style={{ width: `${Math.min(100, (serverStatus.players.online / serverStatus.players.max) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Quick Stats */}
        <div className="glass-card rounded-2xl p-4 md:p-5 animate-fade-in-up"
          style={{ animationDelay: `${STATS_DELAY * 8}ms` }}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Обновление каждые', value: `${REFRESH_INTERVAL / 1000} сек`, icon: Clock },
              { label: 'Средний онлайн', value: stats.history.length > 0 ? chartStats.avg : '—', icon: Activity },
              { label: 'Записей за 24ч', value: stats.history.length, icon: BarChart3 },
              { label: 'Сервер', value: serverStatus?.online ? 'Работает' : 'Недоступен',
                icon: serverStatus?.online ? Wifi : WifiOff },
            ].map((item, i) => (
              <div key={i} className="text-center">
                <item.icon size={16} className="mx-auto mb-1.5 text-orange-400/60" />
                <div className="text-white font-mono text-sm font-semibold">{item.value}</div>
                <div className="text-orange-500/40 text-xs mt-0.5">{item.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-8 md:mt-10 text-center text-orange-500/30 text-xs pb-6">
          <div className="flex items-center justify-center gap-1.5">
            <Server size={12} />
            <span>Мониторинг сервера {SERVER_ADDRESS}</span>
          </div>
          <div className="mt-1">
            Данные обновляются автоматически каждые {REFRESH_INTERVAL / 1000} секунд
          </div>
        </footer>
      </div>
    </div>
  );
}
