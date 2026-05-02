import { useMemo, useState, type ReactNode } from "react";
import Papa from "papaparse";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "./lib/cn";

const PRICE_COLUMNS = [
  "Price (TCG Player)",
  "Price (Card Kingdom)",
  "Price (Star City Games)",
  "Price (Card Market)",
  "Price (Card Hoarder)",
  "Price (Mana Pool)",
  "Price (TCG Land)",
] as const;

const RARITY_ORDER = ["common", "uncommon", "rare", "mythic", "special", "bonus"];
const CHART_COLORS = ["#0f766e", "#2563eb", "#7c3aed", "#c2410c", "#ca8a04", "#475569", "#be123c"];
const COLOR_IDENTITIES = ["All", "Colorless", "White", "Blue", "Black", "Red", "Green", "Multicolor"] as const;
const PRIMARY_TYPES = [
  "All",
  "Creature",
  "Instant",
  "Sorcery",
  "Artifact",
  "Enchantment",
  "Land",
  "Planeswalker",
  "Battle",
  "Other",
] as const;

type PriceColumn = (typeof PRICE_COLUMNS)[number];
type ColorIdentity = (typeof COLOR_IDENTITIES)[number];
type PrimaryTypeFilter = (typeof PRIMARY_TYPES)[number];

type RawCardRow = Record<string, string | undefined>;

type CardRecord = {
  quantity: number;
  name: string;
  finish: string;
  condition: string;
  dateAdded: string;
  tags: string[];
  isProxy: boolean;
  editionName: string;
  editionCode: string;
  collectorNumber: string;
  colors: string[];
  identities: string[];
  manaCost: string;
  types: string[];
  subTypes: string[];
  rarity: string;
  manaValue: number;
  prices: Record<PriceColumn, number>;
};

type ChartDatum = {
  name: string;
  value: number;
  copies: number;
};

type TagStat = {
  name: string;
  rows: number;
  copies: number;
};

function parseNumber(value: string | undefined) {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseInteger(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseList(value: string | undefined) {
  return (value ?? "")
    .split(/[,;|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPreciseCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function normalizeChartValue(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return parseNumber(value);
  if (Array.isArray(value)) return normalizeChartValue(value[0]);
  return 0;
}

function toCardRecord(row: RawCardRow): CardRecord {
  const tags = parseList(row.Tags);
  const prices = Object.fromEntries(
    PRICE_COLUMNS.map((column) => [column, parseNumber(row[column])]),
  ) as Record<PriceColumn, number>;

  return {
    quantity: parseInteger(row.Quantity),
    name: row.Name?.trim() ?? "Unknown card",
    finish: row.Finish?.trim() || "Unknown",
    condition: row.Condition?.trim() || "Unknown",
    dateAdded: row["Date Added"]?.trim() ?? "",
    tags,
    isProxy: tags.some((tag) => tag.toLowerCase() === "proxy"),
    editionName: row["Edition Name"]?.trim() || "Unknown set",
    editionCode: row["Edition Code"]?.trim() || "",
    collectorNumber: row["Collector Number"]?.trim() || "",
    colors: parseList(row.Colors),
    identities: parseList(row.Identities),
    manaCost: row["Mana cost"]?.trim() ?? "",
    types: parseList(row.Types),
    subTypes: parseList(row["Sub-types"]),
    rarity: row.Rarity?.trim().toLowerCase() || "unknown",
    manaValue: parseNumber(row["Mana Value"]),
    prices,
  };
}

function getPrimaryType(card: CardRecord): PrimaryTypeFilter {
  for (const type of PRIMARY_TYPES) {
    if (type !== "All" && type !== "Other" && card.types.includes(type)) {
      return type;
    }
  }
  return "Other";
}

function getColorIdentity(card: CardRecord): ColorIdentity {
  if (card.identities.length === 0) return "Colorless";
  if (card.identities.length > 1) return "Multicolor";
  const identity = card.identities[0];
  return COLOR_IDENTITIES.includes(identity as ColorIdentity) ? (identity as ColorIdentity) : "Colorless";
}

function getCardValue(card: CardRecord, priceColumn: PriceColumn) {
  return card.quantity * card.prices[priceColumn];
}

function summarize(records: CardRecord[], priceColumn: PriceColumn) {
  const copies = records.reduce((sum, card) => sum + card.quantity, 0);
  const value = records.reduce((sum, card) => sum + getCardValue(card, priceColumn), 0);
  const uniqueCards = new Set(records.map((card) => card.name)).size;
  const sets = new Set(records.map((card) => card.editionCode || card.editionName)).size;
  const proxyCopies = records.filter((card) => card.isProxy).reduce((sum, card) => sum + card.quantity, 0);
  const foilCopies = records
    .filter((card) => card.finish.toLowerCase().includes("foil"))
    .reduce((sum, card) => sum + card.quantity, 0);

  return { copies, value, uniqueCards, sets, proxyCopies, foilCopies };
}

function getTagStats(records: CardRecord[]) {
  const stats = new Map<string, TagStat>();

  for (const card of records) {
    for (const tag of card.tags) {
      const current = stats.get(tag) ?? { name: tag, rows: 0, copies: 0 };
      current.rows += 1;
      current.copies += card.quantity;
      stats.set(tag, current);
    }
  }

  return Array.from(stats.values()).sort((a, b) => b.copies - a.copies || a.name.localeCompare(b.name));
}

function groupByValue(records: CardRecord[], priceColumn: PriceColumn, getKey: (card: CardRecord) => string) {
  const groups = new Map<string, ChartDatum>();
  for (const card of records) {
    const key = getKey(card);
    const current = groups.get(key) ?? { name: key, value: 0, copies: 0 };
    current.value += getCardValue(card, priceColumn);
    current.copies += card.quantity;
    groups.set(key, current);
  }
  return Array.from(groups.values());
}

function getRarityData(records: CardRecord[], priceColumn: PriceColumn) {
  return groupByValue(records, priceColumn, (card) => card.rarity).sort((a, b) => {
    const aIndex = RARITY_ORDER.indexOf(a.name);
    const bIndex = RARITY_ORDER.indexOf(b.name);
    return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
  });
}

function getManaCurveData(records: CardRecord[]) {
  const groups = new Map<string, ChartDatum>();
  for (const card of records) {
    const roundedManaValue = Math.max(0, Math.floor(card.manaValue));
    const key = roundedManaValue >= 8 ? "8+" : String(roundedManaValue);
    const current = groups.get(key) ?? { name: key, value: 0, copies: 0 };
    current.copies += card.quantity;
    current.value = current.copies;
    groups.set(key, current);
  }
  return Array.from(groups.values()).sort((a, b) => {
    const aValue = a.name === "8+" ? 8 : Number(a.name);
    const bValue = b.name === "8+" ? 8 : Number(b.name);
    return aValue - bValue;
  });
}

function App() {
  const [cards, setCards] = useState<CardRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [priceColumn, setPriceColumn] = useState<PriceColumn>("Price (TCG Player)");
  const [excludedTags, setExcludedTags] = useState<Set<string>>(() => new Set(["Proxy"]));
  const [isTagDialogOpen, setIsTagDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [rarity, setRarity] = useState("All");
  const [colorIdentity, setColorIdentity] = useState<ColorIdentity>("All");
  const [primaryType, setPrimaryType] = useState<PrimaryTypeFilter>("All");
  const hasLoadedCards = cards.length > 0;

  const rarities = useMemo(() => {
    const found = Array.from(new Set(cards.map((card) => card.rarity))).sort((a, b) => {
      const aIndex = RARITY_ORDER.indexOf(a);
      const bIndex = RARITY_ORDER.indexOf(b);
      return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
    });
    return ["All", ...found];
  }, [cards]);

  const tagStats = useMemo(() => getTagStats(cards), [cards]);
  const excludedTagCopyCount = useMemo(
    () =>
      cards
        .filter((card) => card.tags.some((tag) => excludedTags.has(tag)))
        .reduce((sum, card) => sum + card.quantity, 0),
    [cards, excludedTags],
  );

  const filteredCards = useMemo(() => {
    const query = search.trim().toLowerCase();
    return cards.filter((card) => {
      if (card.tags.some((tag) => excludedTags.has(tag))) return false;
      if (rarity !== "All" && card.rarity !== rarity) return false;
      if (colorIdentity !== "All" && getColorIdentity(card) !== colorIdentity) return false;
      if (primaryType !== "All" && getPrimaryType(card) !== primaryType) return false;
      if (!query) return true;
      return [card.name, card.editionName, card.editionCode, card.rarity, ...card.tags]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [cards, colorIdentity, excludedTags, primaryType, rarity, search]);

  const fullSummary = useMemo(() => summarize(cards, priceColumn), [cards, priceColumn]);
  const tagFilteredSummary = useMemo(
    () => summarize(cards.filter((card) => !card.tags.some((tag) => excludedTags.has(tag))), priceColumn),
    [cards, excludedTags, priceColumn],
  );
  const filteredSummary = useMemo(() => summarize(filteredCards, priceColumn), [filteredCards, priceColumn]);

  const rarityData = useMemo(() => getRarityData(filteredCards, priceColumn), [filteredCards, priceColumn]);
  const colorData = useMemo(
    () => groupByValue(filteredCards, priceColumn, (card) => getColorIdentity(card)),
    [filteredCards, priceColumn],
  );
  const typeData = useMemo(
    () => groupByValue(filteredCards, priceColumn, (card) => getPrimaryType(card)),
    [filteredCards, priceColumn],
  );
  const manaCurveData = useMemo(() => getManaCurveData(filteredCards), [filteredCards]);
  const setData = useMemo(
    () =>
      groupByValue(filteredCards, priceColumn, (card) => card.editionName)
        .sort((a, b) => b.value - a.value)
        .slice(0, 10),
    [filteredCards, priceColumn],
  );
  const topCards = useMemo(
    () => [...filteredCards].sort((a, b) => getCardValue(b, priceColumn) - getCardValue(a, priceColumn)).slice(0, 12),
    [filteredCards, priceColumn],
  );

  function handleCsvUpload(file: File | undefined) {
    if (!file) return;
    setIsLoading(true);
    Papa.parse<RawCardRow>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim(),
      complete: (results) => {
        setCards(results.data.map(toCardRecord).filter((card) => card.quantity > 0));
        setExcludedTags(new Set(["Proxy"]));
        setSearch("");
        setRarity("All");
        setColorIdentity("All");
        setPrimaryType("All");
        setError(results.errors[0]?.message ?? null);
        setIsLoading(false);
      },
      error: (parseError) => {
        setError(parseError.message);
        setIsLoading(false);
      },
    });
  }

  function toggleTag(tag: string) {
    setExcludedTags((currentTags) => {
      const nextTags = new Set(currentTags);
      if (nextTags.has(tag)) {
        nextTags.delete(tag);
      } else {
        nextTags.add(tag);
      }
      return nextTags;
    });
  }

  function includeAllTags() {
    setExcludedTags(new Set());
  }

  function resetTagFilters() {
    setExcludedTags(new Set(["Proxy"]));
  }

  return (
    <main className="isolate min-h-dvh bg-white antialiased">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 p-4 sm:p-6 lg:p-8">
        <header className="flex flex-col gap-6 border-b border-slate-950/10 pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex max-w-[72ch] flex-col gap-3">
            <p className="font-mono text-sm/6 text-teal-700">Archidekt Collection Analyzer</p>
            <h1 className="text-balance text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
              See what your real Magic collection is worth.
            </h1>
            <p className="text-pretty text-base/7 text-slate-600">
              Upload an Archidekt collection export, then choose which labels are included in the stats. The dashboard
              defaults to excluding cards tagged <span className="font-medium text-slate-950">Proxy</span>.
            </p>
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-slate-950/10 p-4 lg:w-96">
            <label htmlFor="csv-upload" className="text-sm/6 font-medium text-slate-950">
              Load your Archidekt CSV
            </label>
            <input
              id="csv-upload"
              name="csv-upload"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => handleCsvUpload(event.currentTarget.files?.[0])}
              className="w-full rounded-lg border border-slate-950/10 px-3 py-2 text-sm/6 text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-teal-700 file:px-3 file:py-1.5 file:text-sm/6 file:font-medium file:text-white focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-teal-700 max-sm:text-base/6"
            />
            <p className="text-pretty text-sm/6 text-slate-500">
              Your collection stays in this browser session. No default CSV is bundled with the app.
            </p>
          </div>
        </header>

        {error ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-50 p-4 text-sm/6 text-amber-900">{error}</div>
        ) : null}

        {!hasLoadedCards && !isLoading ? (
          <section className="rounded-2xl border border-dashed border-slate-950/20 p-8 text-center">
            <h2 className="text-balance text-2xl font-semibold tracking-tight text-slate-950">
              Upload a CSV to start exploring your collection.
            </h2>
            <p className="mx-auto mt-2 max-w-[58ch] text-pretty text-base/7 text-slate-600">
              Export your collection from Archidekt, choose the file above, and the app will build value, rarity, set,
              color, mana curve, and top-card views from that file.
            </p>
          </section>
        ) : null}

        {hasLoadedCards ? (
          <section className="grid gap-4 @container lg:grid-cols-[1fr_22rem]">
          <div className="grid gap-4 rounded-2xl border border-slate-950/10 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Filtered value" value={formatCurrency(filteredSummary.value)} />
            <MetricCard label="Filtered copies" value={formatNumber(filteredSummary.copies)} />
            <MetricCard label="Unique cards" value={formatNumber(filteredSummary.uniqueCards)} />
            <MetricCard label="Sets represented" value={formatNumber(filteredSummary.sets)} />
          </div>

          <div className="rounded-2xl border border-slate-950/10 p-4">
            <p className="truncate text-sm/6 font-medium text-slate-600">Label filter impact</p>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div>
                <p className="truncate text-sm/6 text-slate-500">All cards</p>
                <p className="tabular-nums text-2xl font-semibold text-slate-950">{formatCurrency(fullSummary.value)}</p>
              </div>
              <div>
                <p className="truncate text-sm/6 text-slate-500">Included labels</p>
                <p className="tabular-nums text-2xl font-semibold text-teal-700">
                  {formatCurrency(tagFilteredSummary.value)}
                </p>
              </div>
            </div>
            <p className="mt-3 text-pretty text-sm/6 text-slate-500">
              Excluding selected labels removes{" "}
              <span className="tabular-nums font-medium text-slate-950">
                {formatCurrency(fullSummary.value - tagFilteredSummary.value)}
              </span>{" "}
              across <span className="tabular-nums">{formatNumber(excludedTagCopyCount)}</span> copies.
            </p>
          </div>
          </section>
        ) : null}

        {hasLoadedCards ? (
          <section className="grid gap-4 rounded-2xl border border-slate-950/10 p-4 lg:grid-cols-[1.3fr_repeat(4,minmax(0,1fr))]">
          <div className="flex flex-col gap-2">
            <label htmlFor="search" className="text-sm/6 font-medium text-slate-950">
              Search cards, sets, tags
            </label>
            <input
              id="search"
              name="search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder="Sol Ring, duskmourn, signed..."
              className="rounded-lg border border-slate-950/10 px-3 py-2 text-sm/6 text-slate-950 placeholder:text-slate-400 focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-teal-700 max-sm:text-base/6"
            />
          </div>
          <SelectControl label="Price source" value={priceColumn} onChange={(value) => setPriceColumn(value as PriceColumn)}>
            {PRICE_COLUMNS.map((column) => (
              <option key={column} value={column}>
                {column.replace("Price (", "").replace(")", "")}
              </option>
            ))}
          </SelectControl>
          <SelectControl label="Rarity" value={rarity} onChange={setRarity}>
            {rarities.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectControl>
          <SelectControl
            label="Color identity"
            value={colorIdentity}
            onChange={(value) => setColorIdentity(value as ColorIdentity)}
          >
            {COLOR_IDENTITIES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectControl>
          <SelectControl label="Card type" value={primaryType} onChange={(value) => setPrimaryType(value as PrimaryTypeFilter)}>
            {PRIMARY_TYPES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectControl>

          <div className="flex items-center gap-3 lg:col-span-5">
            <button
              type="button"
              onClick={() => setIsTagDialogOpen(true)}
              className="rounded-lg bg-teal-700 px-3 py-2 text-sm/6 font-medium text-white ring-1 ring-teal-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
            >
              Manage labels
            </button>
            <button type="button" onClick={resetTagFilters} className={filterButtonClass(false)}>
              Reset to exclude Proxy
            </button>
            <p className="text-sm/6 text-slate-500">
              Excluding{" "}
              <span className="font-medium text-slate-950">
                {excludedTags.size === 0 ? "no labels" : Array.from(excludedTags).join(", ")}
              </span>
            </p>
          </div>
          </section>
        ) : null}

        {isLoading ? (
          <div className="rounded-2xl border border-slate-950/10 p-8 text-sm/6 text-slate-500">Loading collection...</div>
        ) : hasLoadedCards ? (
          <>
            <section className="grid gap-4 lg:grid-cols-2">
              <ChartPanel title="Value by rarity" description="Market value, with quantity applied.">
                <ValueBarChart data={rarityData} />
              </ChartPanel>
              <ChartPanel title="Color identity value" description="Multicolor cards are grouped together.">
                <ValuePieChart data={colorData} />
              </ChartPanel>
              <ChartPanel title="Mana curve" description="Copy count by mana value.">
                <ValueBarChart data={manaCurveData} valueLabel="copies" />
              </ChartPanel>
              <ChartPanel title="Value by card type" description="Each card uses its primary type bucket.">
                <ValuePieChart data={typeData} />
              </ChartPanel>
            </section>

            <section className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
              <ChartPanel title="Most valuable sets" description="Top sets in the current filtered scope.">
                <ValueBarChart data={setData} />
              </ChartPanel>
              <TopCardsTable cards={topCards} priceColumn={priceColumn} />
            </section>
          </>
        ) : null}

        {isTagDialogOpen ? (
          <TagFilterDialog
            excludedTags={excludedTags}
            tagStats={tagStats}
            onClose={() => setIsTagDialogOpen(false)}
            onIncludeAll={includeAllTags}
            onReset={resetTagFilters}
            onToggleTag={toggleTag}
          />
        ) : null}
      </div>
    </main>
  );
}

function filterButtonClass(isActive: boolean) {
  return cn(
    "rounded-lg px-3 py-2 text-sm/6 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700",
    isActive
      ? "bg-teal-700 text-white ring-1 ring-teal-700"
      : "bg-slate-950/5 text-slate-700 hover:bg-slate-950/10",
  );
}

function TagFilterDialog({
  excludedTags,
  tagStats,
  onClose,
  onIncludeAll,
  onReset,
  onToggleTag,
}: {
  excludedTags: Set<string>;
  tagStats: TagStat[];
  onClose: () => void;
  onIncludeAll: () => void;
  onReset: () => void;
  onToggleTag: (tag: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-950/30 p-4 sm:items-center sm:justify-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tag-filter-title"
        className="max-h-[min(42rem,calc(100dvh-2rem))] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-950/10"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-950/10 p-5">
          <div>
            <h2 id="tag-filter-title" className="text-balance text-xl font-semibold tracking-tight text-slate-950">
              Manage included labels
            </h2>
            <p className="mt-1 text-pretty text-sm/6 text-slate-500">
              Checked labels are included. Uncheck labels to remove matching cards from every stat and chart.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close label manager"
            className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-950/5 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
          >
            <span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden" aria-hidden="true" />
            <svg viewBox="0 0 20 20" fill="none" className="size-5" aria-hidden="true">
              <path d="M5 5l10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="max-h-[26rem] overflow-y-auto p-5">
          {tagStats.length === 0 ? (
            <div className="rounded-xl border border-slate-950/10 p-4">
              <p className="text-pretty text-sm/6 text-slate-600">
                This CSV does not contain any labels in the <span className="font-medium text-slate-950">Tags</span> column.
              </p>
            </div>
          ) : (
            <ul role="list" className="divide-y divide-slate-950/10">
              {tagStats.map((tag) => {
                const isIncluded = !excludedTags.has(tag.name);
                const inputId = `tag-filter-${tag.name.toLowerCase().replaceAll(/\W+/g, "-")}`;

                return (
                  <li key={tag.name} className="flex items-center justify-between gap-4 py-3">
                    <label htmlFor={inputId} className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="group inline-grid size-5 grid-cols-1 sm:size-4">
                        <input
                          id={inputId}
                          name={inputId}
                          type="checkbox"
                          checked={isIncluded}
                          onChange={() => onToggleTag(tag.name)}
                          className="col-start-1 row-start-1 appearance-none rounded-sm border border-slate-300 bg-white checked:border-teal-700 checked:bg-teal-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 forced-colors:appearance-auto"
                        />
                        <svg
                          viewBox="0 0 14 14"
                          fill="none"
                          className="pointer-events-none col-start-1 row-start-1 size-7/8 self-center justify-self-center stroke-white group-not-has-checked:opacity-0"
                        >
                          <path d="M3 8L6 11L11 3.5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                      <span className="min-w-0">
                        <span className="truncate text-sm/6 font-medium text-slate-950">{tag.name}</span>
                        <span className="text-sm/6 text-slate-500">
                          <span className="tabular-nums">{formatNumber(tag.copies)}</span> copies across{" "}
                          <span className="tabular-nums">{formatNumber(tag.rows)}</span> rows
                        </span>
                      </span>
                    </label>
                    <span
                      className={cn(
                        "rounded-full px-2 py-1 text-sm/6 font-medium",
                        isIncluded ? "bg-teal-50 text-teal-700" : "bg-slate-100 text-slate-600",
                      )}
                    >
                      {isIncluded ? "Included" : "Excluded"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-950/10 p-5 sm:flex-row sm:justify-between">
          <div className="flex gap-3">
            <button type="button" onClick={onIncludeAll} className={filterButtonClass(false)}>
              Include all
            </button>
            <button type="button" onClick={onReset} className={filterButtonClass(false)}>
              Exclude Proxy
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-teal-700 px-3 py-2 text-sm/6 font-medium text-white ring-1 ring-teal-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-slate-950/10 pt-4 first:border-t-0 first:pt-0 sm:[&:nth-child(-n+2)]:border-t-0 sm:[&:nth-child(-n+2)]:pt-0 lg:border-t-0 lg:border-l lg:border-slate-950/10 lg:pl-4 lg:first:border-l-0 lg:first:pl-0">
      <p className="truncate text-sm/6 font-medium text-slate-500">{label}</p>
      <p className="tabular-nums text-3xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function SelectControl({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  const id = label.toLowerCase().replaceAll(" ", "-");
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm/6 font-medium text-slate-950">
        {label}
      </label>
      <span className="inline-grid grid-cols-[1fr_--spacing(8)]">
        <select
          id={id}
          name={id}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          className="col-span-full row-start-1 appearance-none rounded-lg border border-slate-950/10 px-3 py-2 pr-8 text-sm/6 text-slate-950 focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-teal-700 max-sm:text-base/6"
        >
          {children}
        </select>
        <svg
          viewBox="0 0 8 5"
          width="8"
          height="5"
          fill="none"
          className="pointer-events-none col-start-2 row-start-1 place-self-center text-slate-500"
        >
          <path d="M.5.5 4 4 7.5.5" stroke="currentcolor" />
        </svg>
      </span>
    </div>
  );
}

function ChartPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-950/10 p-4">
      <div className="mb-4">
        <h2 className="text-balance text-xl font-semibold tracking-tight text-slate-950">{title}</h2>
        <p className="text-pretty text-sm/6 text-slate-500">{description}</p>
      </div>
      <div className="h-80">{children}</div>
    </div>
  );
}

function ValueBarChart({ data, valueLabel = "value" }: { data: ChartDatum[]; valueLabel?: "value" | "copies" }) {
  const dataKey = valueLabel === "copies" ? "copies" : "value";
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 56, left: 8 }}>
        <CartesianGrid stroke="#0f172a" strokeOpacity={0.08} vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} interval={0} angle={-35} textAnchor="end" height={70} />
        <YAxis
          tick={{ fontSize: 12 }}
          tickFormatter={(value: number) => (valueLabel === "copies" ? formatNumber(value) : formatCurrency(value))}
          width={80}
        />
        <Tooltip
          formatter={(value: unknown) =>
            valueLabel === "copies" ? formatNumber(normalizeChartValue(value)) : formatPreciseCurrency(normalizeChartValue(value))
          }
          labelClassName="font-medium"
        />
        <Bar dataKey={dataKey} fill="#0f766e" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function ValuePieChart({ data }: { data: ChartDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={58} outerRadius={108} paddingAngle={2}>
          {data.map((entry, index) => (
            <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value: unknown) => formatPreciseCurrency(normalizeChartValue(value))} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function TopCardsTable({ cards, priceColumn }: { cards: CardRecord[]; priceColumn: PriceColumn }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-950/10">
      <div className="border-b border-slate-950/10 p-4">
        <h2 className="text-balance text-xl font-semibold tracking-tight text-slate-950">Most valuable cards</h2>
        <p className="text-pretty text-sm/6 text-slate-500">Quantity and selected market source are applied.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-950/10 text-left text-sm/6">
          <thead className="bg-slate-50">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium text-slate-600">
                Card
              </th>
              <th scope="col" className="px-4 py-3 font-medium text-slate-600">
                Set
              </th>
              <th scope="col" className="px-4 py-3 font-medium text-slate-600">
                Rarity
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-slate-600">
                Qty
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium text-slate-600">
                Value
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-950/5">
            {cards.map((card) => (
              <tr key={`${card.name}-${card.editionCode}-${card.collectorNumber}-${card.finish}`}>
                <td className="max-w-72 px-4 py-3 font-medium text-slate-950">
                  <span className="truncate">{card.name}</span>
                  <span className="mt-1 flex gap-2 text-sm/6 font-normal text-slate-500">
                    <span>{card.finish}</span>
                    <span>{card.condition}</span>
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">{card.editionName}</td>
                <td className="px-4 py-3 capitalize text-slate-600">{card.rarity}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatNumber(card.quantity)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-950">
                  {formatPreciseCurrency(getCardValue(card, priceColumn))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default App;
