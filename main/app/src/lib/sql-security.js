/**
 * SQL Security Module
 *
 * Provides safe SQL identifier handling to prevent SQL injection.
 * Per REPO_REVIEW_REPORT A.1.1 - SQL injection prevention.
 *
 * @module SqlSecurity
 */

// Allowlisted tables for backup/restore operations
// Only these tables can be backed up or restored
export const ALLOWED_BACKUP_TABLES = new Set([
  'listings',
  'components',
  'suppliers',
  'boms',
  'bom_lines',
  'asin_entities',
  'listing_features',
  'asin_features',
  'listing_cost_overrides',
  'marketplaces',
]);

// Allowed backup types
export const ALLOWED_BACKUP_TYPES = new Set(['full', 'boms']);

// Allowlisted columns per table for restore operations
// Only these columns can be used in INSERT statements
export const ALLOWED_COLUMNS_BY_TABLE = {
  listings: new Set([
    'id', 'seller_sku', 'asin', 'title', 'status', 'price_inc_vat', 'available_quantity',
    'category', 'fulfillmentChannel', 'marketplace_id', 'image_url', 'brand',
  ]),
  components: new Set([
    'id', 'component_sku', 'name', 'description', 'unit_cost_ex_vat', 'currency',
    'supplier_id', 'lead_time_days', 'notes', 'is_active',
  ]),
  suppliers: new Set([
    'id', 'name', 'code', 'email', 'phone', 'address', 'website', 'notes',
    'default_lead_time_days', 'is_active',
  ]),
  boms: new Set([
    'id', 'scope_type', 'listing_id', 'asin_entity_id', 'version', 'is_active',
    'effective_from', 'name', 'notes',
  ]),
  bom_lines: new Set([
    'id', 'bom_id', 'component_id', 'quantity', 'wastage_rate', 'notes', 'sort_order',
  ]),
  asin_entities: new Set([
    'id', 'asin', 'marketplace_id', 'title', 'brand', 'category', 'status',
  ]),
  listing_features: new Set([
    'id', 'listing_id', 'features_json', 'feature_version', 'computed_at',
  ]),
  asin_features: new Set([
    'id', 'asin_entity_id', 'features_json', 'feature_version', 'computed_at',
  ]),
  listing_cost_overrides: new Set([
    'listing_id', 'shipping_cost_ex_vat', 'packaging_cost_ex_vat',
    'handling_cost_ex_vat', 'other_cost_ex_vat',
  ]),
  marketplaces: new Set([
    'id', 'amazon_marketplace_id', 'name', 'country_code', 'currency_code', 'vat_rate',
  ]),
};

/**
 * Validate that a table name is in the allowlist
 * @param {string} tableName - The table name to validate
 * @returns {boolean} True if valid
 */
export function isAllowedTable(tableName) {
  return typeof tableName === 'string' && ALLOWED_BACKUP_TABLES.has(tableName);
}

/**
 * Validate that a column name is allowed for a specific table
 * @param {string} tableName - The table name
 * @param {string} columnName - The column name to validate
 * @returns {boolean} True if valid
 */
export function isAllowedColumn(tableName, columnName) {
  const allowedColumns = ALLOWED_COLUMNS_BY_TABLE[tableName];
  if (!allowedColumns) return false;
  return typeof columnName === 'string' && allowedColumns.has(columnName);
}

/**
 * Validate backup type
 * @param {string} type - The backup type
 * @returns {boolean} True if valid
 */
export function isAllowedBackupType(type) {
  return typeof type === 'string' && ALLOWED_BACKUP_TYPES.has(type);
}

/**
 * Safely quote a SQL identifier (table or column name)
 * Only use AFTER validation against allowlist
 * @param {string} identifier - The identifier to quote
 * @returns {string} Quoted identifier
 * @throws {Error} If identifier contains invalid characters
 */
export function quoteIdentifier(identifier) {
  if (typeof identifier !== 'string') {
    throw new Error('Identifier must be a string');
  }
  // Validate identifier format: alphanumeric, underscores only
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid identifier format: ${identifier}`);
  }
  return `"${identifier}"`;
}

/**
 * Get tables for a backup type
 * @param {string} type - 'full' or 'boms'
 * @returns {string[]} Array of allowed table names
 */
export function getBackupTables(type) {
  if (type === 'full') {
    return ['listings', 'components', 'suppliers', 'boms', 'bom_lines', 'asin_entities', 'listing_features', 'asin_features'];
  } else if (type === 'boms') {
    return ['components', 'suppliers', 'boms', 'bom_lines'];
  }
  return [];
}

/**
 * Get restore order for tables (respecting foreign key dependencies)
 * @returns {string[]} Tables in correct restore order
 */
export function getRestoreOrder() {
  return ['marketplaces', 'suppliers', 'components', 'listings', 'boms', 'bom_lines', 'asin_entities', 'listing_features', 'asin_features', 'listing_cost_overrides'];
}

/**
 * Filter row data to only include allowed columns
 * @param {string} tableName - The table name
 * @param {Object} row - The row data
 * @returns {Object} Filtered row with only allowed columns
 */
export function filterAllowedColumns(tableName, row) {
  const allowedColumns = ALLOWED_COLUMNS_BY_TABLE[tableName];
  if (!allowedColumns) return {};

  const filtered = {};
  for (const [key, value] of Object.entries(row)) {
    // Skip timestamp columns (will be auto-generated)
    if (key === 'created_at' || key === 'updated_at' || key === 'createdAt' || key === 'updatedAt') {
      continue;
    }
    if (allowedColumns.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

export default {
  ALLOWED_BACKUP_TABLES,
  ALLOWED_BACKUP_TYPES,
  ALLOWED_COLUMNS_BY_TABLE,
  isAllowedTable,
  isAllowedColumn,
  isAllowedBackupType,
  quoteIdentifier,
  getBackupTables,
  getRestoreOrder,
  filterAllowedColumns,
};
