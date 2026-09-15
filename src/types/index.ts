/** Contribution / on-chain record types */

export interface OnChainContribution {
  dataId: string;
  taskId: string;
  user: `0x${string}`;
  score: number;
  simulationTime: number;
  blockNumber: number;
  transactionHash: `0x${string}`;
  logIndex: number;
  timestamp: number | null;
}

/** Hub attempt row normalized for matching + explorer (primary profile source). */
export interface HubAttemptContribution {
  attemptId: number;
  dataId: string;
  taskId: string;
  user: `0x${string}`;
  /** Null when Hub returns a null score — never coerced to 0. */
  score: number | null;
  simulationTime: number;
  /** Always null for Hub-primary rows (no block from Hub API). */
  blockNumber: number | null;
  /** Null when Hub row has no txhash. */
  transactionHash: `0x${string}` | null;
  logIndex: number;
  timestamp: number | null;
  taskNameHint: string | null;
  themeHint: string | null;
  source: "hub";
}

export type MatchPhase = "pre" | "post";

export type MetadataStatus = "mapped" | "unmapped";

export interface AxisTaskFamily {
  id: string | number;
  name: string;
  description?: string | null;
  lifecycle?: string | null;
  pre_task_id?: number | string | null;
  latest_post_task_id?: number | string | null;
  post_count?: number | null;
  difficulty_stars?: number | null;
  expected_duration?: number | null;
  success_rate?: number | null;
  thumbnail?: string | null;
  skills?: string[] | null;
  theme?: string | null;
  embodiment?: string | null;
  channel?: string | null;
  status?: string | null;
}

export interface MappedContribution {
  dataId: string;
  taskId: string;
  user: `0x${string}`;
  /** Null when Hub returns a null score — never coerced to 0. */
  score: number | null;
  simulationTime: number;
  blockNumber: number | null;
  transactionHash: `0x${string}` | null;
  logIndex: number;
  timestamp: number | null;
  /** Hub attempt_id when source is Hub; null for legacy on-chain-only rows. */
  attemptId: number | null;
  source: "hub" | "onchain";
  metadataStatus: MetadataStatus;
  phase: MatchPhase | null;
  taskName: string | null;
  description: string | null;
  skills: string[];
  theme: string | null;
  embodiment: string | null;
  difficulty: number | null;
  successRate: number | null;
  familyId: string | null;
}

export interface SkillNode {
  skill: string;
  contributionCount: number;
  uniqueTasks: number;
  topEnvironments: { theme: string; count: number }[];
  recentTasks: {
    taskId: string;
    taskName: string | null;
    score: number | null;
    timestamp: number | null;
  }[];
}

export interface ThemeStat {
  theme: string;
  count: number;
  percentage: number;
}

export interface DailyBucket {
  date: string;
  count: number;
  averageScore: number;
}

export interface MetadataCoverage {
  mappedUniqueTasks: number;
  totalUniqueTasks: number;
  coveragePercent: number;
  mappedContributions: number;
  totalContributions: number;
}

export interface ProfileSummary {
  /**
   * Primary TRAJECTORIES count — public Hub search-attempts.total
   * (all Hub activity for the wallet). Field name retained for compatibility.
   */
  onChainContributions: number;
  uniqueTasks: number;
  averageScore: number;
  bestScore: number;
}

export interface HubCacheStatus {
  status: "complete" | "incomplete";
  totalAttempts: number;
  fetchedAttempts: number;
  lastCompletedPage: number;
  totalPages: number;
  updatedAt: string | null;
  stale?: boolean;
}

export interface HubTxhashStats {
  /** All cached Hub search-attempts rows. */
  hubAttemptCount: number;
  /** Signed attempts — valid non-null/non-empty Hub txhash. */
  trajectoryCount: number;
  /** Unsigned attempts — no usable txhash. */
  unsignedAttemptCount: number;
  /** @deprecated Prefer trajectoryCount (signed) */
  withTxhash: number;
  /** @deprecated Prefer unsignedAttemptCount */
  withoutTxhash: number;
}

export interface BaseVerificationStatus {
  status: "complete" | "incomplete" | "none";
  recordSubmittedCount: number | null;
  lastVerifiedAt: string | null;
}

export interface ProfileAnalytics {
  summary: ProfileSummary;
  coverage: MetadataCoverage;
  skills: SkillNode[];
  themes: ThemeStat[];
  timeline: DailyBucket[];
  metadataAvailable: boolean;
}

export interface ScanProgress {
  fromBlock: number;
  lastScannedBlock: number;
  targetBlock: number;
  /** Technical block-scan progress only — not contribution completion. */
  percent: number;
}

export interface IndexStatus {
  dataSource:
    | "development-fixture"
    | "verified-fixture"
    | "hub-cache"
    | "hub-incomplete"
    | "wallet-cache"
    | "live-wallet-scan"
    | "scan-incomplete"
    | "ingestion-disabled"
    | "index-cache"
    | "index"
    | "stale-fallback";
  freshness: "cached" | "fresh" | "stale";
  lastSyncAt: string | null;
  lastIndexedBlock: number;
  chainHead: number | null;
  blocksBehind: number | null;
  maxAgeMs: number;
  /** Primary: Hub history completeness (drives profile UI). */
  scanStatus?: "complete" | "incomplete";
  scanProgress?: ScanProgress | null;
  canResume?: boolean;
}

export interface ProfileTimings {
  totalMs: number;
  sqliteMs: number;
  metadataMs: number;
  analyticsMs: number;
  syncMs: number;
  ethGetLogs: number;
}

export interface ProfileResponse {
  address: `0x${string}`;
  generatedAt: string;
  contributions: MappedContribution[];
  analytics: ProfileAnalytics;
  warnings: string[];
  indexStatus: IndexStatus;
  /**
   * Hub recorded attempts total (API `total` or cache).
   * Not on-chain RecordSubmitted. Null when Hub lookup is unavailable.
   */
  hubTrajectories: number | null;
  hubStatus: HubCacheStatus | null;
  hubTxhash: HubTxhashStats | null;
  baseVerification: BaseVerificationStatus;
  timings?: ProfileTimings;
  empty?: boolean;
}

export interface ProfileErrorResponse {
  error: string;
  code:
    | "INVALID_ADDRESS"
    | "NO_CONTRIBUTIONS"
    | "RPC_UNAVAILABLE"
    | "METADATA_UNAVAILABLE"
    | "RATE_LIMITED"
    | "INDEX_NOT_READY"
    | "SYNC_FAILED"
    | "INTERNAL";
  details?: string;
  indexStatus?: IndexStatus;
  /** When sync fails, client may retry with ?allowStale=1 */
  canShowStale?: boolean;
}
