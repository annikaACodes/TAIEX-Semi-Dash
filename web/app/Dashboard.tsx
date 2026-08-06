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

import {
  translateRevenueHistory,
  type MonthlyExchangeRate,
  type TranslatedRevenueRow,
} from "./fx-calculations";

type ViewName = "company" | "subsectors" | "momentum" | "freshness";
type RangeName = 12 | 24 | 60 | "all";
type DisplayCurrency = "TWD" | "USD";
type ExportRow = Record<string, string | number | boolean | null>;

interface ExchangeRateHistory {
  baseCurrency: "USD";
  quoteCurrency: "TWD";
  averageMethod: "arithmetic_mean_daily_1600_interbank_spot";
  sourceName: string;
  sourceUrl: string;
  coverageStartMonth: string;
  coverageEndMonth: string;
  monthlyRateCount: number;
  latestAverageTwdPerUsd: number;
  latestObservationDate: string;
  sourceLastUpdatedDate: string | null;
}

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
  exchangeRateHistory: ExchangeRateHistory;
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

interface SubsectorCompanyRow {
  ticker: string;
  name: string;
  reportingMonth: string | null;
  revenueNt: number | null;
  yoyPercent: number | null;
  revenueWeightPercent: number | null;
  simpleYoyContributionPercentPoints: number | null;
  revenueWeightedYoyContributionPercentPoints: number | null;
}

interface SubsectorConstituentSnapshot {
  month: string;
  aggregateRevenueNt: number;
  simpleYoyPercent: number | null;
  revenueWeightedYoyPercent: number | null;
  reportingCompanies: number;
  companies: SubsectorCompanyRow[];
}

interface SubsectorData {
  latestRevenueMonth: string;
  monthOptions: string[];
  methodology: {
    simple: string;
    revenueWeighted: string;
  };
  series: Record<string, SubsectorRow[]>;
  snapshots: Record<
    string,
    Record<string, SubsectorConstituentSnapshot>
  >;
}

type MomentumPeriodName = "mom" | "yoy" | "3m" | "6m" | "ltm";
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
}

interface MomentumRow {
  companyId: number;
  ticker: string;
  name: string;
  classification: string;
  analysisMonth: string;
  periods: Record<MomentumPeriodName, MomentumPeriodResult>;
}

interface MomentumData {
  latestRevenueMonth: string;
  monthOptions: string[];
  periods: Record<MomentumPeriodName, MomentumPeriodDefinition>;
  snapshots: Record<string, MomentumRow[]>;
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
  forecastConfidence: string | null;
  historySampleCount: number;
  releaseStatus: string;
  overdue: boolean;
  unusualReportDate: boolean;
  unusualReason: string | null;
  deviationFromHistoryDays: number | null;
  publicationTimestamp: string | null;
  publicationTimestampBasis: string | null;
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
  exchangeRates: MonthlyExchangeRate[];
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

const ANALYSIS_MIX_KEY = "mix";

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

function shiftReportingMonth(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(
    shifted.getUTCMonth() + 1,
  ).padStart(2, "0")}`;
}

function formatAnalysisMonth(value: string) {
  return value === ANALYSIS_MIX_KEY ? "Mix" : formatMonth(value);
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

function formatScheduleBasis(
  value: string | null | undefined,
  historySampleCount = 0,
) {
  if (!value) return "Not available";
  if (value === "ir_calendar") return "IR calendar";
  if (value === "actual_first_seen") return "Actual";
  if (value === "company_history") {
    if (historySampleCount >= 3) return "Historical estimate";
    if (historySampleCount > 0) return "Blended estimate";
    return "Market fallback";
  }
  if (value === "regulatory_prior" || value === "late_roll_forward") {
    return "Regulatory deadline";
  }
  return value.replaceAll("_", " ");
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

function formatPublicationBasis(value: string | null | undefined) {
  if (value === "MOPS_CURRENT_REPORT_FEED_EXACT") return "Exact MOPS time";
  if (value === "MOPS_MATERIAL_ANNOUNCEMENT_EXACT") {
    return "Exact MOPS announcement";
  }
  if (value === "COMPANY_IR_MONTHLY_REVENUE_EXACT") {
    return "Exact company IR time";
  }
  if (value === "MOPS_ARCHIVE_FIRST_OBSERVED") return "First observed";
  if (value === "CNYES_PUBLICATION_CORROBORATED_PROXY") {
    return "Cnyes public-web proxy";
  }
  if (value === "MONEYDJ_PUBLICATION_CORROBORATED_PROXY") {
    return "MoneyDJ public-web proxy";
  }
  if (value === "MOPS_ARCHIVE_HTTP_LAST_MODIFIED_CURRENT_VERSION") {
    return "Original time unavailable";
  }
  return value ?? "Not available";
}

function formatRevenuePublication(
  timestamp: string | null | undefined,
  basis: string | null | undefined,
) {
  if (basis === "MOPS_ARCHIVE_HTTP_LAST_MODIFIED_CURRENT_VERSION") {
    return "Original time unavailable";
  }
  if (!timestamp) return "Not available";
  const formatted = formatTimestamp(timestamp);
  if (basis === "MOPS_ARCHIVE_FIRST_OBSERVED") {
    return `${formatted} (first observed)`;
  }
  if (basis === "CNYES_PUBLICATION_CORROBORATED_PROXY") {
    return `${formatted} (public proxy)`;
  }
  if (basis === "MONEYDJ_PUBLICATION_CORROBORATED_PROXY") {
    return `${formatted} (public proxy)`;
  }
  return formatted;
}

function exportPublicationTimestamp(
  timestamp: string | null | undefined,
  basis: string | null | undefined,
) {
  return basis === "MOPS_ARCHIVE_HTTP_LAST_MODIFIED_CURRENT_VERSION"
    ? null
    : (timestamp ?? null);
}

function compactCurrency(
  value: number | null | undefined,
  currency: DisplayCurrency = "TWD",
) {
  if (value === null || value === undefined) return "N/A";
  const prefix = currency === "USD" ? "$" : "NT$";
  return `${prefix}${new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)}`;
}

function fullCurrency(
  value: number | null | undefined,
  currency: DisplayCurrency = "TWD",
) {
  if (value === null || value === undefined) return "";
  const prefix = currency === "USD" ? "$" : "NT$";
  return `${prefix}${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value)}`;
}

function revenueInCurrency(
  row: TranslatedRevenueRow<HistoryRow> | null | undefined,
  metric: "revenueNt" | "cumulativeYtdRevenueNt",
  currency: DisplayCurrency,
) {
  if (!row) return null;
  if (currency === "TWD") return row[metric];
  return metric === "revenueNt"
    ? row.revenueUsd
    : row.cumulativeYtdRevenueUsd;
}

function formatPercent(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined) return "N/A";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function formatPercentagePoints(
  value: number | null | undefined,
  digits = 2,
) {
  if (value === null || value === undefined) return "N/A";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}pp`;
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

function AnalysisMonthControl({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <label className="select-control analysis-month-control">
      <span>Month</span>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value={ANALYSIS_MIX_KEY}>Mix (latest reports)</option>
        {options.map((month) => (
          <option key={month} value={month}>
            {formatMonth(month)}
          </option>
        ))}
      </select>
      <ChevronDown size={16} />
    </label>
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
      <strong>
        {label === ANALYSIS_MIX_KEY
          ? "Mix (latest reports)"
          : label && /^\d{4}-\d{2}$/.test(label)
            ? formatMonth(label)
            : label}
      </strong>
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

function CompanyLink({
  ticker,
  name,
  onOpenCompany,
}: {
  ticker: string;
  name: string;
  onOpenCompany: (ticker: string) => void;
}) {
  return (
    <a
      className="table-link"
      href={`#company/${encodeURIComponent(ticker)}`}
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        onOpenCompany(ticker);
      }}
    >
      {name}
    </a>
  );
}

function CurrencyControl({
  value,
  onChange,
  exchangeRateHistory,
}: {
  value: DisplayCurrency;
  onChange: (value: DisplayCurrency) => void;
  exchangeRateHistory: ExchangeRateHistory;
}) {
  return (
    <div className="currency-control">
      <div className="segmented currency-toggle" aria-label="Revenue currency">
        {(["TWD", "USD"] as DisplayCurrency[]).map((currency) => (
          <button
            type="button"
            key={currency}
            className={value === currency ? "active" : ""}
            aria-pressed={value === currency}
            onClick={() => onChange(currency)}
          >
            {currency === "TWD" ? "NT$" : "USD"}
          </button>
        ))}
      </div>
      <span
        className="fx-rate-note"
        title={
          `${exchangeRateHistory.sourceName}; arithmetic mean of published ` +
          `daily 16:00 NTD/USD interbank spot rates; latest monthly average ` +
          `${exchangeRateHistory.latestAverageTwdPerUsd.toFixed(3)}`
        }
      >
        USD uses each month&apos;s CBC average
      </span>
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
  exchangeRates,
  companies,
  selectedTicker,
  onSelectTicker,
}: {
  manifest: Manifest;
  exchangeRates: MonthlyExchangeRate[];
  companies: Record<string, CompanyData>;
  selectedTicker: string;
  onSelectTicker: (ticker: string) => void;
}) {
  const defaultTicker =
    manifest.companies.find((company) => company.ticker === "2330")?.ticker ??
    manifest.companies[0]?.ticker ??
    "";
  const activeTicker = manifest.companies.some(
    (company) => company.ticker === selectedTicker,
  )
    ? selectedTicker
    : defaultTicker;
  const bundledCompany = companies[activeTicker] ?? null;
  const [loadedCompany, setLoadedCompany] = useState<CompanyData | null>(null);
  const [metric, setMetric] = useState<CompanyMetric>("revenueNt");
  const [range, setRange] = useState<RangeName>(60);
  const [currency, setCurrency] = useState<DisplayCurrency>("TWD");

  useEffect(() => {
    if (bundledCompany) return;
    let active = true;
    fetch(`./data/companies/${activeTicker}.json`, { cache: "no-store" })
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
  }, [activeTicker, bundledCompany]);

  const companyData =
    bundledCompany ??
    (loadedCompany?.company.ticker === activeTicker ? loadedCompany : null);

  const translatedHistory = useMemo(
    () => translateRevenueHistory(companyData?.history ?? [], exchangeRates),
    [companyData, exchangeRates],
  );
  const visibleHistory = useMemo(
    () => rangeRows(translatedHistory, range),
    [range, translatedHistory],
  );
  const displayHistory = useMemo(
    () =>
      visibleHistory.map((row) => ({
        ...row,
        revenueNt: revenueInCurrency(row, "revenueNt", currency),
        cumulativeYtdRevenueNt: revenueInCurrency(
          row,
          "cumulativeYtdRevenueNt",
          currency,
        ),
      })),
    [currency, visibleHistory],
  );
  const latest = translatedHistory.at(-1);
  const latestDisplay = displayHistory.at(-1);
  const metricDefinition = COMPANY_METRICS[metric];
  const currencyLabel = currency === "USD" ? "USD" : "NT$";
  const exportRows: ExportRow[] = visibleHistory.map((row) => ({
    Month: row.month,
    [`Revenue (${currencyLabel})`]: revenueInCurrency(
      row,
      "revenueNt",
      currency,
    ),
    "MoM (%)": row.momPercent,
    "YoY (%)": row.yoyPercent,
    [`Cumulative YTD Revenue (${currencyLabel})`]: revenueInCurrency(
      row,
      "cumulativeYtdRevenueNt",
      currency,
    ),
    "YTD YoY (%)": row.ytdYoyPercent,
    "Monthly Average USD/NTD Rate":
      currency === "USD" ? row.averageTwdPerUsd : null,
    "FX Daily Observations":
      currency === "USD" ? row.exchangeRateObservationCount : null,
    "FX Latest Observation":
      currency === "USD" ? row.exchangeRateLastObservationDate : null,
    "Publication Timestamp": exportPublicationTimestamp(
      row.publicationTimestamp,
      row.publicationTimestampBasis,
    ),
    "Publication Basis": formatPublicationBasis(
      row.publicationTimestampBasis,
    ),
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
        className="company-screen-header"
        actions={
          <>
            <CurrencyControl
              value={currency}
              onChange={setCurrency}
              exchangeRateHistory={manifest.exchangeRateHistory}
            />
            <CompanySelector
              companies={manifest.companies}
              selectedTicker={activeTicker}
              onSelect={onSelectTicker}
            />
            <ExportMenu
              rows={exportRows}
              filename={`${activeTicker}-monthly-revenue-${currency.toLowerCase()}`}
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
                <span>
                  {formatRevenuePublication(
                    latest?.publicationTimestamp,
                    latest?.publicationTimestampBasis,
                  )}
                </span>
              </div>
            </div>
          </section>

          <section className="metric-grid">
            <MetricCard
              label="Monthly revenue"
              value={compactCurrency(
                latestDisplay?.revenueNt,
                currency,
              )}
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
              value={compactCurrency(
                latestDisplay?.cumulativeYtdRevenueNt,
                currency,
              )}
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
              detail={formatPublicationBasis(
                latest?.publicationTimestampBasis,
              )}
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
                <span>
                  {metricDefinition.label}
                  {metricDefinition.kind === "currency"
                    ? ` (${currencyLabel})`
                    : ""}
                </span>
                <strong>
                  {metricDefinition.kind === "currency"
                    ? compactCurrency(
                        latestDisplay?.[metric],
                        currency,
                      )
                    : formatPercent(latest?.[metric])}
                </strong>
              </div>
              <span>{formatMonth(visibleHistory[0]?.month)} to {formatMonth(visibleHistory.at(-1)?.month)}</span>
            </div>
            <div className="chart company-chart">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={displayHistory} margin={{ top: 10, right: 10, left: 4, bottom: 0 }}>
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
                            ? fullCurrency(value, currency)
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
                      name={`${metricDefinition.shortLabel} (${currencyLabel})`}
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
                    <th>Company</th>
                    <th className="numeric">Revenue ({currencyLabel})</th>
                    <th className="numeric">MoM</th>
                    <th className="numeric">YoY</th>
                    <th className="numeric">Cumulative YTD ({currencyLabel})</th>
                    <th className="numeric">YTD YoY</th>
                    <th>Publication</th>
                    <th>Revision</th>
                  </tr>
                </thead>
                <tbody>
                  {[...displayHistory].reverse().map((row) => (
                    <tr key={row.month}>
                      <td className="period-cell">{formatMonth(row.month)}</td>
                      <td className="strong-cell">
                        <CompanyLink
                          ticker={activeTicker}
                          name={companyData.company.name}
                          onOpenCompany={onSelectTicker}
                        />
                      </td>
                      <td className="numeric mono">
                        {fullCurrency(row.revenueNt, currency)}
                      </td>
                      <td className={`numeric mono ${valueClass(row.momPercent)}`}>
                        {formatPercent(row.momPercent)}
                      </td>
                      <td className={`numeric mono ${valueClass(row.yoyPercent)}`}>
                        {formatPercent(row.yoyPercent)}
                      </td>
                      <td className="numeric mono">
                        {fullCurrency(row.cumulativeYtdRevenueNt, currency)}
                      </td>
                      <td className={`numeric mono ${valueClass(row.ytdYoyPercent)}`}>
                        {formatPercent(row.ytdYoyPercent)}
                      </td>
                      <td>
                        {formatRevenuePublication(
                          row.publicationTimestamp,
                          row.publicationTimestampBasis,
                        )}
                      </td>
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

const ALL_SUBSECTORS = "__all__";

function SubsectorView({
  data,
  onOpenCompany,
}: {
  data: SubsectorData;
  onOpenCompany: (ticker: string) => void;
}) {
  const classifications = useMemo(() => Object.keys(data.series).sort(), [data]);
  const [selected, setSelected] = useState(ALL_SUBSECTORS);
  const [analysisMonth, setAnalysisMonth] = useState(ANALYSIS_MIX_KEY);
  const [method, setMethod] = useState<"simple" | "weighted">("weighted");
  const [range, setRange] = useState<RangeName>(60);
  const isAll = selected === ALL_SUBSECTORS;
  const isMix = analysisMonth === ANALYSIS_MIX_KEY;
  const snapshots =
    data.snapshots[analysisMonth] ?? data.snapshots[ANALYSIS_MIX_KEY];
  const series = isAll ? [] : (data.series[selected] ?? []);
  const valueKey =
    method === "simple" ? "simpleYoyPercent" : "revenueWeightedYoyPercent";
  const constituentSnapshot = isAll ? null : snapshots[selected];
  const selectedChartRow = constituentSnapshot
    ? {
        month: analysisMonth,
        aggregateRevenueNt: constituentSnapshot.aggregateRevenueNt,
        simpleYoyPercent: constituentSnapshot.simpleYoyPercent,
        revenueWeightedYoyPercent:
          constituentSnapshot.revenueWeightedYoyPercent,
        reportingCompanies: constituentSnapshot.reportingCompanies,
      }
    : null;
  const seriesThroughSelection = isMix
    ? series
    : series.filter((row) => row.month <= analysisMonth);
  const chartSeries = selectedChartRow
    ? [
        ...seriesThroughSelection.filter((row) => row.month !== analysisMonth),
        selectedChartRow,
      ]
    : seriesThroughSelection;
  const visibleSeries = rangeRows(chartSeries, range);
  const latest = constituentSnapshot;
  const leaderboard = classifications
    .map((classification) => {
      const row = snapshots[classification];
      return { classification, ...row };
    })
    .filter((row) => row.month)
    .sort(
      (left, right) =>
        (right[valueKey] ?? Number.NEGATIVE_INFINITY) -
        (left[valueKey] ?? Number.NEGATIVE_INFINITY),
    );
  const simpleLeader = [...leaderboard].sort(
    (left, right) =>
      (right.simpleYoyPercent ?? Number.NEGATIVE_INFINITY) -
      (left.simpleYoyPercent ?? Number.NEGATIVE_INFINITY),
  )[0];
  const weightedLeader = [...leaderboard].sort(
    (left, right) =>
      (right.revenueWeightedYoyPercent ?? Number.NEGATIVE_INFINITY) -
      (left.revenueWeightedYoyPercent ?? Number.NEGATIVE_INFINITY),
  )[0];
  const rankingChartRows = leaderboard;
  const exportRows: ExportRow[] = isAll
    ? leaderboard.map((row, index) => ({
        Rank: index + 1,
        Subsector: row.classification,
        "Data Selection": formatAnalysisMonth(analysisMonth),
        "Aggregate Revenue (NT$)": row.aggregateRevenueNt,
        "Simple YoY (%)": row.simpleYoyPercent,
        "Revenue-Weighted YoY (%)": row.revenueWeightedYoyPercent,
        "Reporting Companies": row.reportingCompanies,
      }))
    : (constituentSnapshot?.companies ?? []).map((company) => ({
        "Data Selection": formatAnalysisMonth(analysisMonth),
        "Company Reporting Month": company.reportingMonth,
        Subsector: selected,
        Ticker: company.ticker,
        Company: company.name,
        "Revenue (NT$)": company.revenueNt,
        "Company YoY (%)": company.yoyPercent,
        "Revenue Share (%)": company.revenueWeightPercent,
        "Simple YoY Contribution (pp)":
          company.simpleYoyContributionPercentPoints,
        "Revenue-Weighted YoY Contribution (pp)":
          company.revenueWeightedYoyContributionPercentPoints,
      }));

  return (
    <>
      <ScreenHeader
        className="subsector-screen-header"
        eyebrow="Subsector aggregates"
        title="Industry growth breadth"
        subtitle={`${classifications.length} classifications | ${
          isMix ? "latest report per company" : formatMonth(analysisMonth)
        } | simple and revenue-weighted company YoY`}
        actions={
          <>
            <AnalysisMonthControl
              value={analysisMonth}
              options={data.monthOptions}
              onChange={setAnalysisMonth}
              ariaLabel="Subsector data month"
            />
            <label className="select-control">
              <span>Subsector</span>
              <select value={selected} onChange={(event) => setSelected(event.target.value)}>
                <option value={ALL_SUBSECTORS}>All</option>
                {classifications.map((classification) => (
                  <option key={classification} value={classification}>
                    {classification}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} />
            </label>
            <ExportMenu
              rows={exportRows}
              filename={`${analysisMonth}-${isAll ? "all" : selected.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}-subsector`}
            />
          </>
        }
      />

      <section className="metric-grid four-up">
        {isAll ? (
          <>
            <MetricCard
              label="Subsectors"
              value={String(classifications.length)}
              detail="Current classification universe"
            />
            <MetricCard
              label="Data selection"
              value={formatAnalysisMonth(analysisMonth)}
              detail={isMix ? "Latest report per company" : "Fixed reporting month"}
            />
            <MetricCard
              label="Top simple YoY"
              value={formatPercent(simpleLeader?.simpleYoyPercent)}
              tone={valueClass(simpleLeader?.simpleYoyPercent)}
              detail={simpleLeader?.classification}
            />
            <MetricCard
              label="Top weighted YoY"
              value={formatPercent(weightedLeader?.revenueWeightedYoyPercent)}
              tone={valueClass(weightedLeader?.revenueWeightedYoyPercent)}
              detail={weightedLeader?.classification}
            />
          </>
        ) : (
          <>
            <MetricCard
              label="Selected subsector"
              value={selected}
              detail={`${latest?.reportingCompanies ?? 0} of ${latest?.companies.length ?? 0} companies`}
            />
            <MetricCard
              label="Aggregate revenue"
              value={compactCurrency(latest?.aggregateRevenueNt)}
              detail={formatAnalysisMonth(analysisMonth)}
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
              detail="Selected revenue weights"
            />
          </>
        )}
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
          {!isAll && <RangeControl value={range} onChange={setRange} />}
        </div>
        <div className="chart-title-row">
          {isAll ? (
            <>
              <div>
                <span>Subsector ranking</span>
                <strong>
                  {method === "simple" ? "Simple YoY" : "Revenue-weighted YoY"}
                </strong>
              </div>
              <span>{formatAnalysisMonth(analysisMonth)}</span>
            </>
          ) : (
            <>
              <div>
                <span>{method === "simple" ? "Simple" : "Revenue-weighted"} YoY</span>
                <strong>{formatPercent(latest?.[valueKey])}</strong>
              </div>
              <span>{data.methodology[method === "simple" ? "simple" : "revenueWeighted"]}</span>
            </>
          )}
        </div>
        {isAll ? (
          <div
            className="chart subsector-ranking-chart"
            style={{ height: Math.max(440, leaderboard.length * 29) }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={rankingChartRows}
                layout="vertical"
                margin={{ top: 4, right: 30, left: 4, bottom: 0 }}
              >
                <CartesianGrid stroke="#e2e8f0" horizontal={false} />
                <XAxis
                  type="number"
                  tickFormatter={(value) => `${Number(value).toFixed(0)}%`}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="classification"
                  width={180}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  content={
                    <ChartTooltip
                      formatter={(value) => formatPercent(value, 2)}
                    />
                  }
                />
                <ReferenceLine x={0} stroke="#64748b" />
                <Bar
                  dataKey={valueKey}
                  name={
                    method === "simple" ? "Simple YoY" : "Revenue-weighted YoY"
                  }
                  radius={[2, 2, 2, 2]}
                  isAnimationActive={false}
                >
                  {rankingChartRows.map((row) => (
                    <Cell
                      key={row.classification}
                      fill={(row[valueKey] ?? 0) >= 0 ? "#138a61" : "#c74646"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="chart subsector-chart">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={visibleSeries} margin={{ top: 12, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="month"
                tickFormatter={(value) =>
                  value === ANALYSIS_MIX_KEY ? "Mix" : String(value).slice(2)
                }
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
        )}
      </section>

      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <h3>{isAll ? "Subsector ranking" : "Subsector companies"}</h3>
            <span>
              {isAll
                ? `${formatAnalysisMonth(analysisMonth)} | ${method === "simple" ? "simple" : "revenue-weighted"} YoY ranking`
                : `${formatAnalysisMonth(analysisMonth)} | ${constituentSnapshot?.reportingCompanies ?? 0} of ${constituentSnapshot?.companies.length ?? 0} companies represented`}
            </span>
          </div>
        </div>
        <div className="table-scroll">
          {isAll ? (
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
                <tr key={row.classification}>
                  <td className="rank-cell">{index + 1}</td>
                  <td className="strong-cell">
                    <button
                      type="button"
                      className="table-link"
                      onClick={() => setSelected(row.classification)}
                    >
                      {row.classification}
                    </button>
                  </td>
                  <td className="numeric mono">{fullCurrency(row.aggregateRevenueNt)}</td>
                  <td className={`numeric mono ${valueClass(row.simpleYoyPercent)}`}>
                    {formatPercent(row.simpleYoyPercent)}
                  </td>
                  <td className={`numeric mono ${valueClass(row.revenueWeightedYoyPercent)}`}>
                    {formatPercent(row.revenueWeightedYoyPercent)}
                  </td>
                  <td className="numeric">
                    {row.reportingCompanies} / {row.companies.length}
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Company</th>
                  <th>Data month</th>
                  <th className="numeric">Revenue (NT$)</th>
                  <th className="numeric">Company YoY</th>
                  <th className="numeric">Revenue share</th>
                  <th className="numeric">Simple YoY contribution (pp)</th>
                  <th className="numeric">Weighted YoY contribution (pp)</th>
                </tr>
              </thead>
              <tbody>
                {(constituentSnapshot?.companies ?? []).map((company) => (
                  <tr key={company.ticker}>
                    <td className="ticker-cell">{company.ticker}</td>
                    <td className="strong-cell">
                      <CompanyLink
                        ticker={company.ticker}
                        name={company.name}
                        onOpenCompany={onOpenCompany}
                      />
                    </td>
                    <td>
                      {company.reportingMonth
                        ? formatMonth(company.reportingMonth)
                        : "N/A"}
                    </td>
                    <td className="numeric mono">
                      {company.revenueNt === null
                        ? "N/A"
                        : fullCurrency(company.revenueNt)}
                    </td>
                    <td className={`numeric mono ${valueClass(company.yoyPercent)}`}>
                      {formatPercent(company.yoyPercent)}
                    </td>
                    <td className="numeric mono">
                      {formatPercent(company.revenueWeightPercent, 2)}
                    </td>
                    <td
                      className={`numeric mono ${valueClass(
                        company.simpleYoyContributionPercentPoints,
                      )}`}
                    >
                      {formatPercentagePoints(
                        company.simpleYoyContributionPercentPoints,
                        2,
                      )}
                    </td>
                    <td
                      className={`numeric mono ${valueClass(
                        company.revenueWeightedYoyContributionPercentPoints,
                      )}`}
                    >
                      {formatPercentagePoints(
                        company.revenueWeightedYoyContributionPercentPoints,
                        2,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="aggregate-row">
                  <td />
                  <td>Subsector aggregate</td>
                  <td>{formatAnalysisMonth(analysisMonth)}</td>
                  <td className="numeric mono">
                    {fullCurrency(constituentSnapshot?.aggregateRevenueNt)}
                  </td>
                  <td className="numeric">N/A</td>
                  <td className="numeric mono">
                    {constituentSnapshot?.aggregateRevenueNt ? "100.00%" : "N/A"}
                  </td>
                  <td
                    className={`numeric mono ${valueClass(
                      constituentSnapshot?.simpleYoyPercent,
                    )}`}
                  >
                    {formatPercent(constituentSnapshot?.simpleYoyPercent, 2)}
                  </td>
                  <td
                    className={`numeric mono ${valueClass(
                      constituentSnapshot?.revenueWeightedYoyPercent,
                    )}`}
                  >
                    {formatPercent(
                      constituentSnapshot?.revenueWeightedYoyPercent,
                      2,
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </section>
    </>
  );
}

type MomentumFilter = "all" | "accelerating" | "decelerating";
const ALL_MOMENTUM_NAMES = "__all__";
const MOMENTUM_PERIOD_ORDER: MomentumPeriodName[] = [
  "mom",
  "yoy",
  "3m",
  "6m",
  "ltm",
];

function momentumWindowLabels(
  endMonth: string,
  period: MomentumPeriodName,
  definition: MomentumPeriodDefinition,
) {
  if (period === "yoy") {
    return {
      current: formatMonth(endMonth),
      prior: formatMonth(shiftReportingMonth(endMonth, -12)),
    };
  }
  const priorEndMonth = shiftReportingMonth(endMonth, -definition.months);
  return {
    current: formatMonthRange(
      shiftReportingMonth(endMonth, -(definition.months - 1)),
      endMonth,
    ),
    prior: formatMonthRange(
      shiftReportingMonth(priorEndMonth, -(definition.months - 1)),
      priorEndMonth,
    ),
  };
}

function MomentumView({
  data,
  onOpenCompany,
}: {
  data: MomentumData;
  onOpenCompany: (ticker: string) => void;
}) {
  const [filter, setFilter] = useState<MomentumFilter>("all");
  const [period, setPeriod] = useState<MomentumPeriodName>("mom");
  const [subsector, setSubsector] = useState(ALL_MOMENTUM_NAMES);
  const [analysisMonth, setAnalysisMonth] = useState(ANALYSIS_MIX_KEY);
  const [query, setQuery] = useState("");
  const periodDefinition = data.periods[period];
  const selectedCompanies =
    data.snapshots[analysisMonth] ?? data.snapshots[ANALYSIS_MIX_KEY];
  const isMix = analysisMonth === ANALYSIS_MIX_KEY;
  const analysisLabel = isMix
    ? "Mix (latest per company)"
    : formatMonth(analysisMonth);
  const subsectorOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const company of selectedCompanies) {
      counts.set(
        company.classification,
        (counts.get(company.classification) ?? 0) + 1,
      );
    }
    return [...counts.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    );
  }, [selectedCompanies]);
  const periodRows = useMemo<MomentumDisplayRow[]>(
    () =>
      selectedCompanies.map(({ periods, ...company }) => ({
        ...company,
        ...periods[period],
      })),
    [period, selectedCompanies],
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
  const availableCount =
    counts.accelerating + counts.decelerating + counts.unchanged;
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
  const windowLabel =
    period === "mom" || period === "yoy" ? "Month" : periodDefinition.label;
  const priorRevenueHeader =
    period === "yoy"
      ? "Year-ago Month Rev."
      : `Prior ${windowLabel} Rev.`;
  const previousGrowthHeader =
    period === "yoy"
      ? "Prior Month YoY Growth"
      : `Prior ${periodDefinition.label} Growth`;
  const exportRows: ExportRow[] = filtered.map((row) => {
    const windows = momentumWindowLabels(
      row.analysisMonth,
      period,
      periodDefinition,
    );
    return {
      Universe: universeLabel,
      "Data Selection": formatAnalysisMonth(analysisMonth),
      "Company Data Month": row.analysisMonth,
      Ticker: row.ticker,
      Company: row.name,
      Subsector: row.classification,
      Period: periodDefinition.controlLabel,
      "Current Window": windows.current,
      "Prior Window": windows.prior,
      [`Current ${windowLabel} Revenue (NT$)`]: row.currentPeriodRevenueNt,
      [`Prior ${windowLabel} Revenue (NT$)`]: row.priorPeriodRevenueNt,
      [`Current ${periodDefinition.label} Growth (%)`]: row.currentGrowthPercent,
      [`Prior ${periodDefinition.label} Growth (%)`]: row.previousGrowthPercent,
      [`${periodDefinition.label} Acceleration (pp)`]:
        row.accelerationPercentPoints,
      Direction: row.direction,
    };
  });

  return (
    <>
      <ScreenHeader
        className="momentum-screen-header"
        eyebrow="Growth inflections"
        title="Acceleration monitor"
        subtitle={`${universeLabel} | ${analysisLabel} | ${periodDefinition.controlLabel}; acceleration vs preceding ${periodDefinition.label} growth rate`}
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
                  All names ({selectedCompanies.length})
                </option>
                {subsectorOptions.map(([classification, companyCount]) => (
                  <option key={classification} value={classification}>
                    {classification} ({companyCount})
                  </option>
                ))}
              </select>
              <ChevronDown size={16} />
            </label>
            <AnalysisMonthControl
              value={analysisMonth}
              options={data.monthOptions}
              onChange={setAnalysisMonth}
              ariaLabel="Acceleration data month"
            />
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
              filename={`${analysisMonth}-${universeLabel
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
            <span>
              {availableCount} with {periodDefinition.label} data | {filtered.length} names shown
            </span>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Company</th>
                <th>Subsector</th>
                <th>Data month</th>
                <th className="numeric">Current {windowLabel} Rev.</th>
                <th className="numeric">{priorRevenueHeader}</th>
                <th className="numeric">{previousGrowthHeader}</th>
                <th className="numeric">Current {periodDefinition.label} Growth</th>
                <th className="numeric">Acceleration</th>
                <th>Direction</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.ticker}>
                  <td className="ticker-cell">{row.ticker}</td>
                  <td className="strong-cell">
                    <CompanyLink
                      ticker={row.ticker}
                      name={row.name}
                      onOpenCompany={onOpenCompany}
                    />
                  </td>
                  <td>{row.classification}</td>
                  <td>{formatMonth(row.analysisMonth)}</td>
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

function FreshnessView({
  data,
  onOpenCompany,
}: {
  data: FreshnessData;
  onOpenCompany: (ticker: string) => void;
}) {
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
    "Publication Timestamp": exportPublicationTimestamp(
      row.publicationTimestamp,
      row.publicationTimestampBasis,
    ),
    "Publication Basis": formatPublicationBasis(
      row.publicationTimestampBasis,
    ),
    Overdue: row.overdue,
    "Unusual Report Date": row.unusualReportDate,
    "Unusual Reason": row.unusualReason,
    "Schedule Basis": formatScheduleBasis(
      row.scheduleSource,
      row.historySampleCount,
    ),
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
                  <td className="strong-cell">
                    <CompanyLink
                      ticker={row.ticker}
                      name={row.name}
                      onOpenCompany={onOpenCompany}
                    />
                  </td>
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
                  <td>
                    {formatRevenuePublication(
                      row.publicationTimestamp,
                      row.publicationTimestampBasis,
                    )}
                  </td>
                  <td>
                    {formatScheduleBasis(
                      row.scheduleSource,
                      row.historySampleCount,
                    )}
                  </td>
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
    const response = await fetch("/api/dashboard-bundle", { cache: "no-store" });
    if (response.ok) {
      const dashboardData = (await response.json()) as DashboardData;
      if (Array.isArray(dashboardData.exchangeRates)) return dashboardData;
    }
  } catch {
    // Static hosts use the generated data files below.
  }

  const fetchStaticJson = async <T,>(path: string) => {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`Dashboard data request failed: ${path}`);
    return response.json() as Promise<T>;
  };
  const [manifest, exchangeRates, subsectors, momentum, freshness] = await Promise.all([
    fetchStaticJson<Manifest>("./data/manifest.json"),
    fetchStaticJson<MonthlyExchangeRate[]>("./data/exchange-rates.json"),
    fetchStaticJson<SubsectorData>("./data/subsectors.json"),
    fetchStaticJson<MomentumData>("./data/momentum.json"),
    fetchStaticJson<FreshnessData>("./data/freshness.json"),
  ]);
  return { manifest, exchangeRates, subsectors, momentum, freshness, companies: {} };
}

export function Dashboard() {
  const [view, setView] = useState<ViewName>("company");
  const [selectedCompanyTicker, setSelectedCompanyTicker] = useState("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const syncViewFromHash = () => {
      const [hashView, encodedTicker] = window.location.hash.slice(1).split("/");
      if (NAV_ITEMS.some((item) => item.id === hashView)) {
        setView(hashView as ViewName);
        if (hashView === "company" && encodedTicker) {
          setSelectedCompanyTicker(decodeURIComponent(encodedTicker));
        }
      }
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
    const companyPath =
      nextView === "company" && selectedCompanyTicker
        ? `/${encodeURIComponent(selectedCompanyTicker)}`
        : "";
    window.history.replaceState(null, "", `#${nextView}${companyPath}`);
  };

  const openCompany = (ticker: string) => {
    setSelectedCompanyTicker(ticker);
    setView("company");
    window.history.replaceState(
      null,
      "",
      `#company/${encodeURIComponent(ticker)}`,
    );
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
          <CompanyView
            manifest={data.manifest}
            exchangeRates={data.exchangeRates}
            companies={data.companies}
            selectedTicker={selectedCompanyTicker}
            onSelectTicker={openCompany}
          />
        ) : view === "subsectors" ? (
          <SubsectorView data={data.subsectors} onOpenCompany={openCompany} />
        ) : view === "momentum" ? (
          <MomentumView data={data.momentum} onOpenCompany={openCompany} />
        ) : (
          <FreshnessView data={data.freshness} onOpenCompany={openCompany} />
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
