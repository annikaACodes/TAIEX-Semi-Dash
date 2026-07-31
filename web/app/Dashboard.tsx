"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  Building2,
  CalendarClock,
  Check,
  ChevronDown,
  Clock3,
  Download,
  FileSpreadsheet,
  Gauge,
  LineChart,
  RefreshCw,
  Search,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useEffect, useMemo, useRef, useState } from "react";

type ViewName = "company" | "subsectors" | "momentum" | "freshness";
type RangeName = 12 | 24 | 60 | "all";
type ExportRow = Record<string, string | number | boolean | null>;

interface CompanySummary {
  id: number;
  ticker: string;
  name: string;
  classifications: string[];
  latestMonth: string | null;
  latestRevenueNt: number | null;
  latestMomPercent: number | null;
  latestYoyPercent: number | null;
  latestYtdRevenueNt: number | null;
  latestYtdYoyPercent: number | null;
  latestPublicationTimestamp: string | null;
  restatementFlag: boolean;
}

interface Manifest {
  generatedDateTaipei: string;
  latestRevenueMonth: string;
  targetReportingMonth: string;
  companyCount: number;
  classificationCount: number;
  revenueObservationCount: number;
  companies: CompanySummary[];
}

interface HistoryRow {
  month: string;
  revenueNt: number | null;
  momPercent: number | null;
  yoyPercent: number | null;
  cumulativeYtdRevenueNt: number | null;
  ytdYoyPercent: number | null;
  publicationTimestamp: string | null;
  restatementFlag: boolean;
  publicationTimestampBasis: string | null;
  sourceMarket: string | null;
  sourceUrl: string | null;
  sourceReportDate: string | null;
  sourceNoteTranslationStatus: string | null;
}

interface CompanyData {
  company: {
    id: number;
    ticker: string;
    name: string;
    classifications: string[];
  };
  history: HistoryRow[];
}

interface SubsectorRow {
  month: string;
  aggregateRevenueNt: number;
  simpleYoyPercent: number | null;
  revenueWeightedYoyPercent: number | null;
  reportingCompanies: number;
}

interface SubsectorData {
  latestRevenueMonth: string;
  methodology: {
    simple: string;
    revenueWeighted: string;
  };
  series: Record<string, SubsectorRow[]>;
}

type MomentumPeriodName = "mom" | "3m" | "6m" | "ltm";
type MomentumDirection =
  | "accelerating"
  | "decelerating"
  | "unchanged"
  | "unavailable";

interface MomentumPeriodResult {
  currentPeriodRevenueNt: number | null;
  priorPeriodRevenueNt: number | null;
  currentGrowthPercent: number | null;
  previousGrowthPercent: number | null;
  accelerationPercentPoints: number | null;
  direction: MomentumDirection;
}

interface MomentumPeriodDefinition {
  months: number;
  label: string;
  controlLabel: string;
  currentPeriodStartMonth: string;
  currentPeriodEndMonth: string;
  priorPeriodStartMonth: string;
  priorPeriodEndMonth: string;
  baselinePeriodStartMonth: string;
  baselinePeriodEndMonth: string;
}

interface MomentumRow {
  companyId: number;
  ticker: string;
  name: string;
  classification: string;
  periods: Record<MomentumPeriodName, MomentumPeriodResult>;
}

interface MomentumData {
  latestRevenueMonth: string;
  previousRevenueMonth: string;
  periods: Record<MomentumPeriodName, MomentumPeriodDefinition>;
  companies: MomentumRow[];
}

type MomentumDisplayRow = Omit<MomentumRow, "periods"> & MomentumPeriodResult;

interface FreshnessRow {
  companyId: number;
  ticker: string;
  name: string;
  classification: string;
  reported: boolean;
  expectedDate: string | null;
  expectedTime: string | null;
  regulatoryDeadline: string | null;
  scheduleSource: string | null;
  forecastConfidence: number | null;
  releaseStatus: string;
  overdue: boolean;
  unusualReportDate: boolean;
  unusualReason: string | null;
  deviationFromHistoryDays: number | null;
  publicationTimestamp: string | null;
  latestRevenueMonth: string | null;
}

interface FreshnessData {
  asOfDateTaipei: string;
  targetReportingMonth: string;
  summary: {
    reported: number;
    pending: number;
    overdue: number;
    unusual: number;
  };
  companies: FreshnessRow[];
}

interface DashboardData {
  manifest: Manifest;
  subsectors: SubsectorData;
  momentum: MomentumData;
  freshness: FreshnessData;
  companies: Record<string, CompanyData>;
}

const NAV_ITEMS: Array<{
  id: ViewName;
  label: string;
  icon: typeof Building2;
}> = [
  { id: "company", label: "Company", icon: Building2 },
  { id: "subsectors", label: "Subsectors", icon: BarChart3 },
  { id: "momentum", label: "Acceleration", icon: Gauge },
  { id: "freshness", label: "Freshness", icon: CalendarClock },
];

const COMPANY_METRICS = {
  revenueNt: { label: "Revenue", shortLabel: "Revenue", kind: "currency" },
  momPercent: { label: "Month over month", shortLabel: "MoM", kind: "percent" },
  yoyPercent: { label: "Year over year", shortLabel: "YoY", kind: "percent" },
  cumulativeYtdRevenueNt: {
    label: "Cumulative YTD",
    shortLabel: "YTD revenue",
    kind: "currency",
  },
  ytdYoyPercent: {
    label: "YTD year over year",
    shortLabel: "YTD YoY",
    kind: "percent",
  },
} as const;

type CompanyMetric = keyof typeof COMPANY_METRICS;

function formatMonth(value: string | null | undefined) {
  if (!value) return "Not available";
  const [year, month] = value.slice(0, 7).split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function formatMonthRange(start: string, end: string) {
  return start === end
    ? formatMonth(end)
    : `${formatMonth(start)} to ${formatMonth(end)}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not scheduled";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Taipei",
    timeZoneName: "short",
  }).format(new Date(value));
}

function compactCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) return "N/A";
  return `NT$${new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)}`;
}

function fullCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) return "";
  return `NT$${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value)}`;
}

function formatPercent(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined) return "N/A";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function valueClass(value: number | null | undefined) {
  if (value === null || value === undefined || value === 0) return "neutral";
  return value > 0 ? "positive" : "negative";
}

function rangeRows<T>(rows: T[], range: RangeName) {
  return range === "all" ? rows : rows.slice(-range);
}

function csvValue(value: ExportRow[string]) {
  if (value === null) return "";
  const stringValue = String(value);
  return /[",\n]/.test(stringValue)
    ? `"${stringValue.replaceAll('"', '""')}"`
    : stringValue;
}

function downloadBlob(content: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function exportCsv(rows: ExportRow[], filename: string) {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  const csv = [
    columns.map(csvValue).join(","),
    ...rows.map((row) => columns.map((column) => csvValue(row[column])).join(",")),
  ].join("\n");
  downloadBlob(csv, `${filename}.csv`, "text/csv;charset=utf-8");
}

async function exportExcel(rows: ExportRow[], filename: string) {
  if (rows.length === 0) return;
  const XLSX = await import("xlsx");
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Dashboard data");
  XLSX.writeFile(workbook, `${filename}.xlsx`, { compression: true });
}

function ExportMenu({
  rows,
  filename,
}: {
  rows: ExportRow[];
  filename: string;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div className="export-menu" ref={menuRef}>
      <button
        className="button button-secondary"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Download size={16} />
        Export
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="export-options" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              exportCsv(rows, filename);
              setOpen(false);
            }}
          >
            <Download size={16} />
            CSV
            <span>Current view</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void exportExcel(rows, filename);
              setOpen(false);
            }}
          >
            <FileSpreadsheet size={16} />
            Excel
            <span>.xlsx workbook</span>
          </button>
        </div>
      )}
    </div>
  );
}

function RangeControl({
  value,
  onChange,
}: {
  value: RangeName;
  onChange: (value: RangeName) => void;
}) {
  const choices: Array<{ value: RangeName; label: string }> = [
    { value: 12, label: "1Y" },
    { value: 24, label: "2Y" },
    { value: 60, label: "5Y" },
    { value: "all", label: "All" },
  ];
  return (
    <div className="segmented" aria-label="Chart time range">
      {choices.map((choice) => (
        <button
          type="button"
          key={String(choice.value)}
          className={value === choice.value ? "active" : ""}
          onClick={() => onChange(choice.value)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: Array<{
    value?: number;
    name?: string;
    color?: string;
    dataKey?: string;
  }>;
  label?: string;
  formatter: (value: number, dataKey?: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <strong>{label && /^\d{4}-\d{2}$/.test(label) ? formatMonth(label) : label}</strong>
      {payload.map((item) => (
        <div key={item.dataKey ?? item.name} style={{ color: item.color }}>
          <span>{item.name}</span>
          <b>{formatter(Number(item.value), item.dataKey)}</b>
        </div>
      ))}
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "positive" | "negative" | "neutral" | "pending";
}) {
  return (
    <div className="metric-card">
      <span className="metric-label">{label}</span>
      <strong className={`metric-value ${tone}`}>{value}</strong>
      {detail && <span className="metric-detail">{detail}</span>}
    </div>
  );
}

function ScreenHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  className,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  actions: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`screen-header${className ? ` ${className}` : ""}`}>
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="screen-actions">{actions}</div>
    </div>
  );
}

function CompanySelector({
  companies,
  selectedTicker,
  onSelect,
}: {
  companies: CompanySummary[];
  selectedTicker: string;
  onSelect: (ticker: string) => void;
}) {
  const selected = companies.find((company) => company.ticker === selectedTicker);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return companies.slice(0, 12);
    return companies
      .filter(
        (company) =>
          company.ticker.includes(normalized) ||
          company.name.toLowerCase().includes(normalized) ||
          company.classifications.some((classification) =>
            classification.toLowerCase().includes(normalized),
          ),
      )
      .slice(0, 30);
  }, [companies, query]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!selectorRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div className="company-selector" ref={selectorRef}>
      <button
        className="company-selector-trigger"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <div>
          <strong>{selected?.ticker ?? "Select"}</strong>
          <span>{selected?.name ?? "Choose a company"}</span>
        </div>
        <ChevronDown size={18} />
      </button>
      {open && (
        <div className="company-selector-panel">
          <label className="search-field">
            <Search size={16} />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ticker, company, or subsector"
              aria-label="Search companies"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear company search"
                title="Clear search"
              >
                <X size={15} />
              </button>
            )}
          </label>
          <div className="company-options">
            {matches.map((company) => (
              <button
                type="button"
                key={company.ticker}
                className={company.ticker === selectedTicker ? "selected" : ""}
                onClick={() => {
                  onSelect(company.ticker);
                  setQuery("");
                  setOpen(false);
                }}
              >
                <span className="ticker-cell">{company.ticker}</span>
                <span>
                  <strong>{company.name}</strong>
                  <small>{company.classifications.join(" · ")}</small>
                </span>
                {company.ticker === selectedTicker && <Check size={16} />}
              </button>
            ))}
            {matches.length === 0 && (
              <div className="empty-search">No matching companies</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CompanyView({
  manifest,
  companies,
}: {
  manifest: Manifest;
  companies: Record<string, CompanyData>;
}) {
  const [selectedTicker, setSelectedTicker] = useState(
    manifest.companies.find((company) => company.ticker === "2330")?.ticker ??
      manifest.companies[0]?.ticker ??
      "",
  );
  const bundledCompany = companies[selectedTicker] ?? null;
  const [loadedCompany, setLoadedCompany] = useState<CompanyData | null>(null);
  const [metric, setMetric] = useState<CompanyMetric>("revenueNt");
  const [range, setRange] = useState<RangeName>(60);

  useEffect(() => {
    if (bundledCompany) return;
    let active = true;
    fetch(`./data/companies/${selectedTicker}.json`)
      .then((response) => {
        if (!response.ok) throw new Error("Company history could not be loaded.");
        return response.json() as Promise<CompanyData>;
      })
      .then((company) => {
        if (active) setLoadedCompany(company);
      })
      .catch(() => {
        if (active) setLoadedCompany(null);
      });
    return () => {
      active = false;
    };
  }, [bundledCompany, selectedTicker]);

  const companyData =
    bundledCompany ??
    (loadedCompany?.company.ticker === selectedTicker ? loadedCompany : null);

  const visibleHistory = useMemo(
    () => rangeRows(companyData?.history ?? [], range),
    [companyData, range],
  );
  const latest = companyData?.history.at(-1);
  const metricDefinition = COMPANY_METRICS[metric];
  const exportRows: ExportRow[] = visibleHistory.map((row) => ({
    Month: row.month,
    "Revenue (NT$)": row.revenueNt,
    "MoM (%)": row.momPercent,
    "YoY (%)": row.yoyPercent,
    "Cumulative YTD Revenue (NT$)": row.cumulativeYtdRevenueNt,
    "YTD YoY (%)": row.ytdYoyPercent,
    "Publication Timestamp": row.publicationTimestamp,
    Restated: row.restatementFlag,
    Market: row.sourceMarket,
    "Source URL": row.sourceUrl,
  }));

  return (
    <>
      <ScreenHeader
        eyebrow="Company intelligence"
        title="Monthly revenue monitor"
        subtitle={`${manifest.companyCount} Taiwan-listed semiconductor companies · data through ${formatMonth(
          manifest.latestRevenueMonth,
        )}`}
        actions={
          <>
            <CompanySelector
              companies={manifest.companies}
              selectedTicker={selectedTicker}
              onSelect={setSelectedTicker}
            />
            <ExportMenu
              rows={exportRows}
              filename={`${selectedTicker}-monthly-revenue`}
            />
          </>
        }
      />

      {!companyData ? (
        <div className="panel loading-panel" role="status">
          <RefreshCw className="spin" size={20} />
          Loading company history
        </div>
      ) : (
        <>
          <section className="identity-band">
            <div className="company-identity">
              <span className="ticker-badge">{companyData.company.ticker}</span>
              <div>
                <h2>{companyData.company.name}</h2>
                <div className="classification-list">
                  {companyData.company.classifications.map((classification) => (
                    <span key={classification}>{classification}</span>
                  ))}
                </div>
              </div>
            </div>
            <div className="publication-status">
              <span className="status-dot reported" />
              <div>
                <strong>{formatMonth(latest?.month)}</strong>
                <span>Published {formatTimestamp(latest?.publicationTimestamp)}</span>
              </div>
            </div>
          </section>

          <section className="metric-grid">
            <MetricCard
              label="Monthly revenue"
              value={compactCurrency(latest?.revenueNt)}
              detail={formatMonth(latest?.month)}
            />
            <MetricCard
              label="Month over month"
              value={formatPercent(latest?.momPercent)}
              tone={valueClass(latest?.momPercent)}
              detail="Change from prior month"
            />
            <MetricCard
              label="Year over year"
              value={formatPercent(latest?.yoyPercent)}
              tone={valueClass(latest?.yoyPercent)}
              detail="Change from prior year"
            />
            <MetricCard
              label="Cumulative YTD"
              value={compactCurrency(latest?.cumulativeYtdRevenueNt)}
              detail="Reported year to date"
            />
            <MetricCard
              label="YTD year over year"
              value={formatPercent(latest?.ytdYoyPercent)}
              tone={valueClass(latest?.ytdYoyPercent)}
              detail="Cumulative growth"
            />
            <MetricCard
              label="Restatement"
              value={latest?.restatementFlag ? "Restated" : "Original"}
              tone={latest?.restatementFlag ? "pending" : "neutral"}
              detail={latest?.publicationTimestampBasis ?? "Official filing"}
            />
          </section>

          <section className="panel chart-panel">
            <div className="panel-toolbar">
              <div className="metric-tabs" role="tablist" aria-label="Company metric">
                {(Object.keys(COMPANY_METRICS) as CompanyMetric[]).map((key) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={metric === key}
                    className={metric === key ? "active" : ""}
                    key={key}
                    onClick={() => setMetric(key)}
                  >
                    {COMPANY_METRICS[key].shortLabel}
                  </button>
                ))}
              </div>
              <RangeControl value={range} onChange={setRange} />
            </div>
            <div className="chart-title-row">
              <div>
                <span>{metricDefinition.label}</span>
                <strong>
                  {metricDefinition.kind === "currency"
                    ? compactCurrency(latest?.[metric])
                    : formatPercent(latest?.[metric])}
                </strong>
              </div>
              <span>{formatMonth(visibleHistory[0]?.month)} to {formatMonth(visibleHistory.at(-1)?.month)}</span>
            </div>
            <div className="chart company-chart">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={visibleHistory} margin={{ top: 10, right: 10, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="companyArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#1b66d1" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#1b66d1" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tickFormatter={(value) => String(value).slice(2)}
                    minTickGap={28}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tickFormatter={(value) =>
                      metricDefinition.kind === "currency"
                        ? new Intl.NumberFormat("en-US", {
                            notation: "compact",
                            maximumFractionDigits: 0,
                          }).format(Number(value))
                        : `${Number(value).toFixed(0)}%`
                    }
                    width={58}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    content={
                      <ChartTooltip
                        formatter={(value) =>
                          metricDefinition.kind === "currency"
                            ? fullCurrency(value)
                            : formatPercent(value, 2)
                        }
                      />
                    }
                  />
                  <ReferenceLine y={0} stroke="#94a3b8" />
                  {metricDefinition.kind === "currency" ? (
                    <Area
                      type="monotone"
                      dataKey={metric}
                      name={metricDefinition.shortLabel}
                      stroke="#1b66d1"
                      strokeWidth={2}
                      fill="url(#companyArea)"
                      connectNulls
                      isAnimationActive={false}
                    />
                  ) : (
                    <Line
                      type="monotone"
                      dataKey={metric}
                      name={metricDefinition.shortLabel}
                      stroke="#1b66d1"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                      connectNulls
                      isAnimationActive={false}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="panel table-panel">
            <div className="panel-heading">
              <div>
                <h3>Monthly observations</h3>
                <span>{visibleHistory.length} periods in the current view</span>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="numeric">Revenue (NT$)</th>
                    <th className="numeric">MoM</th>
                    <th className="numeric">YoY</th>
                    <th className="numeric">Cumulative YTD</th>
                    <th className="numeric">YTD YoY</th>
                    <th>Publication</th>
                    <th>Revision</th>
                  </tr>
                </thead>
                <tbody>
                  {[...visibleHistory].reverse().map((row) => (
                    <tr key={row.month}>
                      <td className="period-cell">{formatMonth(row.month)}</td>
                      <td className="numeric mono">{fullCurrency(row.revenueNt)}</td>
                      <td className={`numeric mono ${valueClass(row.momPercent)}`}>
                        {formatPercent(row.momPercent)}
                      </td>
                      <td className={`numeric mono ${valueClass(row.yoyPercent)}`}>
                        {formatPercent(row.yoyPercent)}
                      </td>
                      <td className="numeric mono">
                        {fullCurrency(row.cumulativeYtdRevenueNt)}
                      </td>
                      <td className={`numeric mono ${valueClass(row.ytdYoyPercent)}`}>
                        {formatPercent(row.ytdYoyPercent)}
                      </td>
                      <td>{formatTimestamp(row.publicationTimestamp)}</td>
                      <td>
                        <span className={`state-label ${row.restatementFlag ? "unusual" : "original"}`}>
                          {row.restatementFlag ? "Restated" : "Original"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}

function SubsectorView({ data }: { data: SubsectorData }) {
  const classifications = useMemo(() => Object.keys(data.series).sort(), [data]);
  const [selected, setSelected] = useState(
    classifications.find((name) => /foundry/i.test(name)) ?? classifications[0],
  );
  const [method, setMethod] = useState<"simple" | "weighted">("weighted");
  const [range, setRange] = useState<RangeName>(60);
  const series = data.series[selected] ?? [];
  const visibleSeries = rangeRows(series, range);
  const valueKey =
    method === "simple" ? "simpleYoyPercent" : "revenueWeightedYoyPercent";
  const latest = series.at(-1);
  const leaderboard = classifications
    .map((classification) => {
      const row = data.series[classification].at(-1);
      return { classification, ...row };
    })
    .filter((row) => row.month)
    .sort(
      (left, right) =>
        (right[valueKey] ?? Number.NEGATIVE_INFINITY) -
        (left[valueKey] ?? Number.NEGATIVE_INFINITY),
    );
  const exportRows: ExportRow[] = visibleSeries.map((row) => ({
    Month: row.month,
    Subsector: selected,
    "Aggregate Revenue (NT$)": row.aggregateRevenueNt,
    "Simple YoY (%)": row.simpleYoyPercent,
    "Revenue-Weighted YoY (%)": row.revenueWeightedYoyPercent,
    "Reporting Companies": row.reportingCompanies,
  }));

  return (
    <>
      <ScreenHeader
        eyebrow="Subsector aggregates"
        title="Industry growth breadth"
        subtitle={`${classifications.length} classifications · simple and revenue-weighted company YoY`}
        actions={
          <>
            <label className="select-control">
              <span>Subsector</span>
              <select value={selected} onChange={(event) => setSelected(event.target.value)}>
                {classifications.map((classification) => (
                  <option key={classification}>{classification}</option>
                ))}
              </select>
              <ChevronDown size={16} />
            </label>
            <ExportMenu
              rows={exportRows}
              filename={`${selected.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}-subsector`}
            />
          </>
        }
      />

      <section className="metric-grid four-up">
        <MetricCard
          label="Selected subsector"
          value={selected}
          detail={`${latest?.reportingCompanies ?? 0} reporting companies`}
        />
        <MetricCard
          label="Aggregate revenue"
          value={compactCurrency(latest?.aggregateRevenueNt)}
          detail={formatMonth(latest?.month)}
        />
        <MetricCard
          label="Simple YoY"
          value={formatPercent(latest?.simpleYoyPercent)}
          tone={valueClass(latest?.simpleYoyPercent)}
          detail="Equal weight per company"
        />
        <MetricCard
          label="Revenue-weighted YoY"
          value={formatPercent(latest?.revenueWeightedYoyPercent)}
          tone={valueClass(latest?.revenueWeightedYoyPercent)}
          detail="Current revenue weights"
        />
      </section>

      <section className="panel chart-panel">
        <div className="panel-toolbar">
          <div className="segmented method-control" aria-label="Subsector aggregation method">
            <button
              type="button"
              className={method === "simple" ? "active" : ""}
              onClick={() => setMethod("simple")}
            >
              Simple YoY
            </button>
            <button
              type="button"
              className={method === "weighted" ? "active" : ""}
              onClick={() => setMethod("weighted")}
            >
              Revenue-weighted YoY
            </button>
          </div>
          <RangeControl value={range} onChange={setRange} />
        </div>
        <div className="chart-title-row">
          <div>
            <span>{method === "simple" ? "Simple" : "Revenue-weighted"} YoY</span>
            <strong>{formatPercent(latest?.[valueKey])}</strong>
          </div>
          <span>{data.methodology[method === "simple" ? "simple" : "revenueWeighted"]}</span>
        </div>
        <div className="chart subsector-chart">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={visibleSeries} margin={{ top: 12, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="month"
                tickFormatter={(value) => String(value).slice(2)}
                minTickGap={28}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                yAxisId="growth"
                tickFormatter={(value) => `${Number(value).toFixed(0)}%`}
                tickLine={false}
                axisLine={false}
                width={52}
              />
              <YAxis
                yAxisId="revenue"
                orientation="right"
                tickFormatter={(value) =>
                  new Intl.NumberFormat("en-US", {
                    notation: "compact",
                    maximumFractionDigits: 0,
                  }).format(Number(value))
                }
                tickLine={false}
                axisLine={false}
                width={52}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    formatter={(value, key) =>
                      key === "aggregateRevenueNt"
                        ? fullCurrency(value)
                        : formatPercent(value, 2)
                    }
                  />
                }
              />
              <Legend />
              <ReferenceLine yAxisId="growth" y={0} stroke="#94a3b8" />
              <Bar
                yAxisId="revenue"
                dataKey="aggregateRevenueNt"
                name="Aggregate revenue"
                fill="#bdd7f7"
                barSize={12}
                isAnimationActive={false}
              />
              <Line
                yAxisId="growth"
                type="monotone"
                dataKey={valueKey}
                name={method === "simple" ? "Simple YoY" : "Revenue-weighted YoY"}
                stroke="#0f5fbf"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <h3>Latest subsector ranking</h3>
            <span>{formatMonth(data.latestRevenueMonth)} · click a row to chart it</span>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Subsector</th>
                <th className="numeric">Aggregate revenue</th>
                <th className="numeric">Simple YoY</th>
                <th className="numeric">Revenue-weighted YoY</th>
                <th className="numeric">Companies</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((row, index) => (
                <tr
                  key={row.classification}
                  className={row.classification === selected ? "selected-row" : ""}
                  onClick={() => setSelected(row.classification)}
                >
                  <td className="rank-cell">{index + 1}</td>
                  <td className="strong-cell">{row.classification}</td>
                  <td className="numeric mono">{fullCurrency(row.aggregateRevenueNt)}</td>
                  <td className={`numeric mono ${valueClass(row.simpleYoyPercent)}`}>
                    {formatPercent(row.simpleYoyPercent)}
                  </td>
                  <td className={`numeric mono ${valueClass(row.revenueWeightedYoyPercent)}`}>
                    {formatPercent(row.revenueWeightedYoyPercent)}
                  </td>
                  <td className="numeric">{row.reportingCompanies}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

type MomentumFilter = "all" | "accelerating" | "decelerating";
const ALL_MOMENTUM_NAMES = "__all__";
const MOMENTUM_PERIOD_ORDER: MomentumPeriodName[] = ["mom", "3m", "6m", "ltm"];

function MomentumView({ data }: { data: MomentumData }) {
  const [filter, setFilter] = useState<MomentumFilter>("all");
  const [period, setPeriod] = useState<MomentumPeriodName>("mom");
  const [subsector, setSubsector] = useState(ALL_MOMENTUM_NAMES);
  const [query, setQuery] = useState("");
  const periodDefinition = data.periods[period];
  const subsectorOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const company of data.companies) {
      counts.set(
        company.classification,
        (counts.get(company.classification) ?? 0) + 1,
      );
    }
    return [...counts.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    );
  }, [data.companies]);
  const periodRows = useMemo<MomentumDisplayRow[]>(
    () =>
      data.companies.map(({ periods, ...company }) => ({
        ...company,
        ...periods[period],
      })),
    [data, period],
  );
  const universeRows = useMemo(
    () =>
      subsector === ALL_MOMENTUM_NAMES
        ? periodRows
        : periodRows.filter((row) => row.classification === subsector),
    [periodRows, subsector],
  );
  const universeLabel =
    subsector === ALL_MOMENTUM_NAMES ? "All names" : subsector;
  const counts = useMemo(
    () => ({
      accelerating: universeRows.filter((row) => row.direction === "accelerating")
        .length,
      decelerating: universeRows.filter((row) => row.direction === "decelerating")
        .length,
      unchanged: universeRows.filter((row) => row.direction === "unchanged").length,
    }),
    [universeRows],
  );
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return universeRows
      .filter((row) => filter === "all" || row.direction === filter)
      .filter(
        (row) =>
          !normalized ||
          row.ticker.includes(normalized) ||
          row.name.toLowerCase().includes(normalized) ||
          row.classification.toLowerCase().includes(normalized),
      )
      .sort((left, right) => {
        const leftValue = left.accelerationPercentPoints;
        const rightValue = right.accelerationPercentPoints;
        if (leftValue === null) return 1;
        if (rightValue === null) return -1;
        return filter === "decelerating"
          ? leftValue - rightValue
          : rightValue - leftValue;
      });
  }, [filter, query, universeRows]);
  const chartRows =
    filter === "all"
      ? [...filtered]
          .sort(
            (left, right) =>
              Math.abs(right.accelerationPercentPoints ?? 0) -
              Math.abs(left.accelerationPercentPoints ?? 0),
          )
          .slice(0, 18)
          .sort(
            (left, right) =>
              (left.accelerationPercentPoints ?? 0) -
              (right.accelerationPercentPoints ?? 0),
          )
      : filtered.slice(0, 18).reverse();
  const windowLabel = period === "mom" ? "Month" : periodDefinition.label;
  const currentWindow = formatMonthRange(
    periodDefinition.currentPeriodStartMonth,
    periodDefinition.currentPeriodEndMonth,
  );
  const priorWindow = formatMonthRange(
    periodDefinition.priorPeriodStartMonth,
    periodDefinition.priorPeriodEndMonth,
  );
  const exportRows: ExportRow[] = filtered.map((row) => ({
    Universe: universeLabel,
    Ticker: row.ticker,
    Company: row.name,
    Subsector: row.classification,
    Period: periodDefinition.controlLabel,
    "Current Window": currentWindow,
    "Prior Window": priorWindow,
    [`Current ${windowLabel} Revenue (NT$)`]: row.currentPeriodRevenueNt,
    [`Prior ${windowLabel} Revenue (NT$)`]: row.priorPeriodRevenueNt,
    [`Current ${periodDefinition.label} Growth (%)`]: row.currentGrowthPercent,
    [`Prior ${periodDefinition.label} Growth (%)`]: row.previousGrowthPercent,
    [`${periodDefinition.label} Acceleration (pp)`]: row.accelerationPercentPoints,
    Direction: row.direction,
  }));

  return (
    <>
      <ScreenHeader
        className="momentum-screen-header"
        eyebrow="Growth inflections"
        title="Acceleration monitor"
        subtitle={`${universeLabel} | ${periodDefinition.controlLabel} through ${formatMonth(
          data.latestRevenueMonth,
        )}; acceleration vs preceding ${periodDefinition.label} growth rate`}
        actions={
          <>
            <label className="select-control momentum-universe-control">
              <span>Universe</span>
              <select
                aria-label="Acceleration universe"
                value={subsector}
                onChange={(event) => setSubsector(event.target.value)}
              >
                <option value={ALL_MOMENTUM_NAMES}>
                  All names ({data.companies.length})
                </option>
                {subsectorOptions.map(([classification, companyCount]) => (
                  <option key={classification} value={classification}>
                    {classification} ({companyCount})
                  </option>
                ))}
              </select>
              <ChevronDown size={16} />
            </label>
            <label className="select-control momentum-period-control">
              <span>Period</span>
              <select
                aria-label="Acceleration period"
                value={period}
                onChange={(event) =>
                  setPeriod(event.target.value as MomentumPeriodName)
                }
              >
                {MOMENTUM_PERIOD_ORDER.map((value) => (
                  <option key={value} value={value}>
                    {data.periods[value].controlLabel}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} />
            </label>
            <ExportMenu
              rows={exportRows}
              filename={`${data.latestRevenueMonth}-${universeLabel
                .toLowerCase()
                .replaceAll(/[^a-z0-9]+/g, "-")}-${period}-growth-acceleration`}
            />
          </>
        }
      />

      <section className="panel chart-panel">
        <div className="panel-toolbar">
          <div className="segmented" aria-label="Acceleration direction">
            {(["all", "accelerating", "decelerating"] as MomentumFilter[]).map((value) => (
              <button
                type="button"
                key={value}
                className={filter === value ? "active" : ""}
                onClick={() => setFilter(value)}
              >
                {value === "all"
                  ? "Largest moves"
                  : value[0].toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
          <label className="search-field table-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search names"
              aria-label="Search acceleration names"
            />
          </label>
        </div>
        <div className="chart-title-row">
          <div>
            <span>{periodDefinition.label} growth acceleration</span>
            <strong>Percentage-point change</strong>
          </div>
          <span>{filter === "all" ? "Largest absolute changes" : `Top ${filter} names`}</span>
        </div>
        <div className="chart momentum-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartRows}
              layout="vertical"
              margin={{ top: 2, right: 30, left: 4, bottom: 0 }}
            >
              <CartesianGrid stroke="#e2e8f0" horizontal={false} />
              <XAxis
                type="number"
                tickFormatter={(value) => `${Number(value).toFixed(0)}pp`}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={120}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    formatter={(value) => `${value > 0 ? "+" : ""}${value.toFixed(2)}pp`}
                  />
                }
              />
              <ReferenceLine x={0} stroke="#64748b" />
              <Bar
                dataKey="accelerationPercentPoints"
                name={`${periodDefinition.label} acceleration`}
                radius={[2, 2, 2, 2]}
                isAnimationActive={false}
              >
                {chartRows.map((row) => (
                  <Cell
                    key={row.ticker}
                    fill={
                      (row.accelerationPercentPoints ?? 0) >= 0
                        ? "#138a61"
                        : "#c74646"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="metric-grid four-up">
        <MetricCard
          label="Accelerating"
          value={String(counts.accelerating)}
          tone="positive"
          detail={`${periodDefinition.label} growth improved`}
        />
        <MetricCard
          label="Decelerating"
          value={String(counts.decelerating)}
          tone="negative"
          detail={`${periodDefinition.label} growth slowed`}
        />
        <MetricCard
          label={`No ${periodDefinition.label} Rate Change`}
          value={String(counts.unchanged)}
          detail="Companies at 0.00pp vs prior rate"
        />
        <MetricCard
          label="Breadth"
          value={formatPercent(
            (counts.accelerating / Math.max(1, counts.accelerating + counts.decelerating)) *
              100,
            0,
          )}
          detail="Share of directional names accelerating"
        />
      </section>

      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <h3>Company momentum</h3>
            <span>{filtered.length} names in the current view</span>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Company</th>
                <th>Subsector</th>
                <th className="numeric">Current {windowLabel} Rev.</th>
                <th className="numeric">Prior {windowLabel} Rev.</th>
                <th className="numeric">Prior {periodDefinition.label} Growth</th>
                <th className="numeric">Current {periodDefinition.label} Growth</th>
                <th className="numeric">Acceleration</th>
                <th>Direction</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.ticker}>
                  <td className="ticker-cell">{row.ticker}</td>
                  <td className="strong-cell">{row.name}</td>
                  <td>{row.classification}</td>
                  <td className="numeric mono">
                    {compactCurrency(row.currentPeriodRevenueNt)}
                  </td>
                  <td className="numeric mono">
                    {compactCurrency(row.priorPeriodRevenueNt)}
                  </td>
                  <td className={`numeric mono ${valueClass(row.previousGrowthPercent)}`}>
                    {formatPercent(row.previousGrowthPercent)}
                  </td>
                  <td className={`numeric mono ${valueClass(row.currentGrowthPercent)}`}>
                    {formatPercent(row.currentGrowthPercent)}
                  </td>
                  <td
                    className={`numeric mono strong-cell ${valueClass(
                      row.accelerationPercentPoints,
                    )}`}
                  >
                    {row.accelerationPercentPoints === null
                      ? "N/A"
                      : `${row.accelerationPercentPoints > 0 ? "+" : ""}${row.accelerationPercentPoints.toFixed(1)}pp`}
                  </td>
                  <td>
                    <span className={`direction-label ${row.direction}`}>
                      {row.direction === "accelerating" ? (
                        <TrendingUp size={14} />
                      ) : row.direction === "decelerating" ? (
                        <TrendingDown size={14} />
                      ) : (
                        <Activity size={14} />
                      )}
                      {row.direction}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

type FreshnessFilter = "all" | "reported" | "pending" | "overdue" | "unusual";

function FreshnessView({ data }: { data: FreshnessData }) {
  const [filter, setFilter] = useState<FreshnessFilter>("all");
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return data.companies
      .filter((row) => {
        if (filter === "reported") return row.reported;
        if (filter === "pending") return !row.reported;
        if (filter === "overdue") return row.overdue;
        if (filter === "unusual") return row.unusualReportDate;
        return true;
      })
      .filter(
        (row) =>
          !normalized ||
          row.ticker.includes(normalized) ||
          row.name.toLowerCase().includes(normalized) ||
          row.classification.toLowerCase().includes(normalized),
      )
      .sort((left, right) => {
        if (left.reported !== right.reported) return left.reported ? -1 : 1;
        return (left.expectedDate ?? "9999").localeCompare(right.expectedDate ?? "9999");
      });
  }, [data, filter, query]);
  const progress =
    (data.summary.reported /
      Math.max(1, data.summary.reported + data.summary.pending)) *
    100;
  const scheduleChart = useMemo(() => {
    const dates = new Map<string, { date: string; reported: number; pending: number }>();
    for (const row of data.companies) {
      const date = row.expectedDate ?? "Unscheduled";
      const bucket = dates.get(date) ?? { date, reported: 0, pending: 0 };
      if (row.reported) bucket.reported += 1;
      else bucket.pending += 1;
      dates.set(date, bucket);
    }
    return [...dates.values()]
      .sort((left, right) => left.date.localeCompare(right.date))
      .slice(0, 14);
  }, [data]);
  const exportRows: ExportRow[] = filtered.map((row) => ({
    Ticker: row.ticker,
    Company: row.name,
    Subsector: row.classification,
    "Reporting Month": data.targetReportingMonth,
    Status: row.reported ? "Reported" : "Pending",
    "Expected Date": row.expectedDate,
    "Expected Time": row.expectedTime,
    "Publication Timestamp": row.publicationTimestamp,
    Overdue: row.overdue,
    "Unusual Report Date": row.unusualReportDate,
    "Unusual Reason": row.unusualReason,
    "Schedule Source": row.scheduleSource,
    "Regulatory Deadline": row.regulatoryDeadline,
  }));

  return (
    <>
      <ScreenHeader
        eyebrow="Reporting freshness"
        title={`${formatMonth(data.targetReportingMonth)} release tracker`}
        subtitle={`Official publication monitoring as of ${formatDate(
          data.asOfDateTaipei,
        )} in Asia/Taipei`}
        actions={
          <ExportMenu
            rows={exportRows}
            filename={`${data.targetReportingMonth}-reporting-freshness`}
          />
        }
      />

      <section className="freshness-progress-band">
        <div className="progress-summary">
          <div>
            <span>Universe reported</span>
            <strong>{data.summary.reported} / {data.companies.length}</strong>
          </div>
          <b>{progress.toFixed(0)}%</b>
        </div>
        <div className="progress-track" aria-label={`${progress.toFixed(0)} percent reported`}>
          <span style={{ width: `${progress}%` }} />
        </div>
      </section>

      <section className="metric-grid four-up">
        <MetricCard
          label="Reported"
          value={String(data.summary.reported)}
          tone="positive"
          detail="Official figures captured"
        />
        <MetricCard
          label="Pending"
          value={String(data.summary.pending)}
          tone="pending"
          detail="Awaiting publication"
        />
        <MetricCard
          label="Overdue"
          value={String(data.summary.overdue)}
          tone={data.summary.overdue > 0 ? "negative" : "neutral"}
          detail="Past expected release"
        />
        <MetricCard
          label="Unusual timing"
          value={String(data.summary.unusual)}
          tone={data.summary.unusual > 0 ? "pending" : "neutral"}
          detail="Outside normal history"
        />
      </section>

      <section className="panel chart-panel">
        <div className="panel-toolbar">
          <div className="segmented freshness-filters" aria-label="Freshness status">
            {(["all", "reported", "pending", "overdue", "unusual"] as FreshnessFilter[]).map(
              (value) => (
                <button
                  type="button"
                  key={value}
                  className={filter === value ? "active" : ""}
                  onClick={() => setFilter(value)}
                >
                  {value[0].toUpperCase() + value.slice(1)}
                </button>
              ),
            )}
          </div>
          <label className="search-field table-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search names"
              aria-label="Search freshness names"
            />
          </label>
        </div>
        <div className="chart-title-row">
          <div>
            <span>Expected release distribution</span>
            <strong>Companies by expected date</strong>
          </div>
          <span>Announced dates supersede history-based estimates</span>
        </div>
        <div className="chart freshness-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={scheduleChart} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(value) =>
                  value === "Unscheduled" ? "None" : String(value).slice(5)
                }
                minTickGap={18}
                tickLine={false}
                axisLine={false}
              />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={38} />
              <Tooltip
                content={
                  <ChartTooltip formatter={(value) => `${value} companies`} />
                }
              />
              <Legend />
              <Bar
                dataKey="reported"
                name="Reported"
                stackId="status"
                fill="#138a61"
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              />
              <Bar
                dataKey="pending"
                name="Pending"
                stackId="status"
                fill="#e8a634"
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <h3>Company reporting status</h3>
            <span>{filtered.length} companies in the current view</span>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Company</th>
                <th>Subsector</th>
                <th>Status</th>
                <th>Expected release</th>
                <th>Publication</th>
                <th>Schedule basis</th>
                <th>Timing flag</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.ticker}>
                  <td className="ticker-cell">{row.ticker}</td>
                  <td className="strong-cell">{row.name}</td>
                  <td>{row.classification}</td>
                  <td>
                    <span className={`status-label ${row.reported ? "reported" : "pending"}`}>
                      <span className="status-dot" />
                      {row.reported ? "Reported" : "Pending"}
                    </span>
                  </td>
                  <td>
                    <strong>{formatDate(row.expectedDate)}</strong>
                    {row.expectedTime && <small className="block-detail">{row.expectedTime} Taipei</small>}
                  </td>
                  <td>{formatTimestamp(row.publicationTimestamp)}</td>
                  <td>{row.scheduleSource?.replaceAll("_", " ") ?? "Not available"}</td>
                  <td>
                    {row.overdue ? (
                      <span className="state-label overdue">
                        <AlertTriangle size={13} />
                        Overdue
                      </span>
                    ) : row.unusualReportDate ? (
                      <span className="state-label unusual">
                        <Clock3 size={13} />
                        Unusual
                      </span>
                    ) : (
                      <span className="state-label normal">Normal</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function LoadingShell() {
  return (
    <div className="app-loading" role="status">
      <div className="loading-mark">
        <LineChart size={24} />
      </div>
      <div>
        <strong>Loading Taiwan Semiconductor Revenue Monitor</strong>
        <span>Preparing official monthly revenue data</span>
      </div>
      <RefreshCw className="spin" size={18} />
    </div>
  );
}

async function fetchDashboardData() {
  try {
    const response = await fetch("/api/dashboard-bundle");
    if (response.ok) return (await response.json()) as DashboardData;
  } catch {
    // Static hosts use the generated data files below.
  }

  const [manifest, subsectors, momentum, freshness] = await Promise.all([
    fetch("./data/manifest.json").then((response) => response.json() as Promise<Manifest>),
    fetch("./data/subsectors.json").then(
      (response) => response.json() as Promise<SubsectorData>,
    ),
    fetch("./data/momentum.json").then(
      (response) => response.json() as Promise<MomentumData>,
    ),
    fetch("./data/freshness.json").then(
      (response) => response.json() as Promise<FreshnessData>,
    ),
  ]);
  return { manifest, subsectors, momentum, freshness, companies: {} };
}

export function Dashboard() {
  const [view, setView] = useState<ViewName>("company");
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const syncViewFromHash = () => {
      const hash = window.location.hash.slice(1) as ViewName;
      if (NAV_ITEMS.some((item) => item.id === hash)) setView(hash);
    };
    const timer = window.setTimeout(syncViewFromHash, 0);
    window.addEventListener("hashchange", syncViewFromHash);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", syncViewFromHash);
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetchDashboardData()
      .then((dashboardData) => {
        if (active) setData(dashboardData);
      })
      .catch(() => {
        if (active) setError("The dashboard data could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const selectView = (nextView: ViewName) => {
    setView(nextView);
    window.history.replaceState(null, "", `#${nextView}`);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <div className="brand">
            <div className="brand-mark">
              <LineChart size={22} />
            </div>
            <div>
              <strong>Taiwan Semiconductor Revenue Monitor</strong>
              <span>Monthly revenue intelligence</span>
            </div>
          </div>
          <div className="header-status">
            {data ? (
              <>
                <span className="live-indicator">
                  <span />
                  Official data
                </span>
                <div>
                  <strong>Through {formatMonth(data.manifest.latestRevenueMonth)}</strong>
                  <span>
                    {data.freshness.summary.reported}/{data.manifest.companyCount}{" "}
                    {formatMonth(data.freshness.targetReportingMonth)} reported
                  </span>
                </div>
              </>
            ) : (
              <span className="header-loading">Loading dataset</span>
            )}
          </div>
        </div>
        <nav className="app-nav" aria-label="Research views">
          <div className="nav-inner" role="tablist">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === item.id}
                  key={item.id}
                  className={view === item.id ? "active" : ""}
                  onClick={() => selectView(item.id)}
                >
                  <Icon size={16} />
                  {item.label}
                  {item.id === "freshness" && data && data.freshness.summary.overdue > 0 && (
                    <span className="nav-alert">{data.freshness.summary.overdue}</span>
                  )}
                </button>
              );
            })}
          </div>
        </nav>
      </header>

      <main className="main-content">
        {error ? (
          <div className="error-state">
            <AlertTriangle size={22} />
            <div>
              <strong>Dashboard data unavailable</strong>
              <span>{error}</span>
            </div>
            <button
              className="button button-primary"
              type="button"
              onClick={() => {
                setError(null);
                setData(null);
                setReloadKey((value) => value + 1);
              }}
            >
              <RefreshCw size={15} />
              Retry
            </button>
          </div>
        ) : !data ? (
          <LoadingShell />
        ) : view === "company" ? (
          <CompanyView manifest={data.manifest} companies={data.companies} />
        ) : view === "subsectors" ? (
          <SubsectorView data={data.subsectors} />
        ) : view === "momentum" ? (
          <MomentumView data={data.momentum} />
        ) : (
          <FreshnessView data={data.freshness} />
        )}
      </main>

      <footer>
        <div>
          <span>Source hierarchy follows project disclosures</span>
          <span>Asia/Taipei reporting calendar</span>
        </div>
        <span>
          {data
            ? `${data.manifest.revenueObservationCount.toLocaleString()} monthly observations`
            : "Loading observations"}
        </span>
      </footer>
    </div>
  );
}
