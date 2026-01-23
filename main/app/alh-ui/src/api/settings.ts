/**
 * Settings API
 *
 * API client for managing application settings and business rules.
 */

import { get, put } from './client';

// Setting value with description
export interface SettingValue {
  value: unknown;
  description: string | null;
}

// All settings as a record
export type Settings = Record<string, SettingValue>;

// Flat settings for updates
export type SettingsUpdate = Record<string, unknown>;

// Get all settings
export async function getSettings(): Promise<Settings> {
  return get<Settings>('/api/v2/settings');
}

// Update settings
export async function updateSettings(updates: SettingsUpdate): Promise<{ updated: string[] }> {
  return put<{ updated: string[] }>('/api/v2/settings', updates);
}

// Setting definitions for the UI
export interface SettingDefinition {
  key: string;
  label: string;
  description: string;
  type: 'number' | 'boolean' | 'string' | 'percentage';
  min?: number;
  max?: number;
  step?: number;
  enum?: string[];
  category: 'margins' | 'guardrails' | 'sync' | 'publish';
}

// All configurable settings with their definitions
export const SETTING_DEFINITIONS: SettingDefinition[] = [
  // Margins & Business Rules
  {
    key: 'min_margin',
    label: 'Minimum Margin',
    description: 'Minimum profit margin required for any listing. Price changes that would result in a margin below this threshold will be blocked.',
    type: 'percentage',
    min: 0,
    max: 100,
    step: 1,
    category: 'margins',
  },
  {
    key: 'target_margin',
    label: 'Target Margin',
    description: 'Target profit margin for pricing recommendations. The system will suggest prices that aim to achieve this margin when possible.',
    type: 'percentage',
    min: 0,
    max: 100,
    step: 1,
    category: 'margins',
  },
  {
    key: 'default_vat_rate',
    label: 'Default VAT Rate',
    description: 'Default VAT rate applied to prices. UK standard is 20%.',
    type: 'percentage',
    min: 0,
    max: 100,
    step: 0.5,
    category: 'margins',
  },

  // Price Change Guardrails
  {
    key: 'max_price_change_pct_per_day',
    label: 'Max Daily Price Change',
    description: 'Maximum percentage a price can change in a single day. Prevents sudden price shocks.',
    type: 'percentage',
    min: 0,
    max: 100,
    step: 1,
    category: 'guardrails',
  },
  {
    key: 'min_days_of_cover_before_price_change',
    label: 'Min Days of Cover for Price Cuts',
    description: 'Minimum days of stock cover required before allowing a price decrease. Prevents selling too cheaply when stock is low.',
    type: 'number',
    min: 0,
    max: 365,
    step: 1,
    category: 'guardrails',
  },
  {
    key: 'min_stock_threshold',
    label: 'Low Stock Warning Threshold',
    description: 'Stock level that triggers low stock warnings. Below this level, price increases may be recommended.',
    type: 'number',
    min: 0,
    max: 10000,
    step: 1,
    category: 'guardrails',
  },
  {
    key: 'allow_price_below_break_even',
    label: 'Allow Prices Below Break-Even',
    description: 'Whether to allow setting prices below the break-even cost. Enable only if you understand the risk of selling at a loss.',
    type: 'boolean',
    category: 'guardrails',
  },

  // Sync Settings
  {
    key: 'sync_interval_minutes',
    label: 'Sync Interval (minutes)',
    description: 'How often to sync data from Amazon and other sources. Lower values mean fresher data but more API usage.',
    type: 'number',
    min: 5,
    max: 1440,
    step: 5,
    category: 'sync',
  },
  {
    key: 'keepa_sync_enabled',
    label: 'Enable Keepa Sync',
    description: 'Enable syncing of historical price data from Keepa. Requires a valid Keepa API key.',
    type: 'boolean',
    category: 'sync',
  },
  {
    key: 'sp_api_sync_enabled',
    label: 'Enable Amazon SP-API Sync',
    description: 'Enable syncing of data from Amazon Selling Partner API. Required for core functionality.',
    type: 'boolean',
    category: 'sync',
  },

  // Publish Settings
  {
    key: 'publish_mode',
    label: 'Publish Mode',
    description: 'Controls whether price/stock changes are actually sent to Amazon. Use "simulate" for testing.',
    type: 'string',
    enum: ['simulate', 'live'],
    category: 'publish',
  },
  {
    key: 'auto_publish_enabled',
    label: 'Auto-Publish Recommendations',
    description: 'Automatically publish accepted recommendations without manual confirmation. Use with caution.',
    type: 'boolean',
    category: 'publish',
  },
];

// Get settings grouped by category
export function getSettingsByCategory(): Record<string, SettingDefinition[]> {
  const grouped: Record<string, SettingDefinition[]> = {
    margins: [],
    guardrails: [],
    sync: [],
    publish: [],
  };

  for (const def of SETTING_DEFINITIONS) {
    grouped[def.category].push(def);
  }

  return grouped;
}

// Category labels for display
export const CATEGORY_LABELS: Record<string, { label: string; description: string }> = {
  margins: {
    label: 'Margins & Pricing',
    description: 'Configure profit margin thresholds and pricing rules',
  },
  guardrails: {
    label: 'Guardrails',
    description: 'Safety limits that prevent risky pricing decisions',
  },
  sync: {
    label: 'Data Sync',
    description: 'Control how and when data is synced from external sources',
  },
  publish: {
    label: 'Publishing',
    description: 'Configure how changes are published to Amazon',
  },
};
