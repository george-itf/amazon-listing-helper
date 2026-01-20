/**
 * Listing Service
 *
 * Business logic for listing operations.
 * Provides helpers for sales velocity, inventory, and publish operations.
 *
 * @module ListingService
 */

import { query, transaction } from '../database/connection.js';

/**
 * Get listing by ID with core fields
 * @param {number} listingId
 * @returns {Promise<Object|null>}
 */
export async function getListingById(listingId) {
  const result = await query(
    'SELECT id, seller_sku, asin, price_inc_vat, available_quantity, status FROM listings WHERE id = $1',
    [listingId]
  );
  return result.rows[0] || null;
}

/**
 * Get sales velocity for a listing
 * @param {number} listingId
 * @param {number} [days=30] - Number of days to calculate velocity over
 * @returns {Promise<Object>} Sales data including velocity
 */
export async function getSalesVelocity(listingId, days = 30) {
  const result = await query(`
    SELECT COALESCE(SUM(units), 0) as total_units
    FROM listing_sales_daily
    WHERE listing_id = $1
      AND date >= CURRENT_DATE - ($2 || ' days')::interval
  `, [listingId, days]);

  const totalUnits = parseInt(result.rows[0]?.total_units || 0, 10);
  const velocity = totalUnits / days;

  return {
    listing_id: listingId,
    days,
    total_units: totalUnits,
    velocity: Math.round(velocity * 100) / 100,
  };
}

/**
 * Calculate days of cover for a listing
 * @param {number} listingId
 * @returns {Promise<Object>} Days of cover data
 */
export async function getDaysOfCover(listingId) {
  const listing = await getListingById(listingId);
  if (!listing) {
    throw new Error(`Listing not found: ${listingId}`);
  }

  const salesData = await getSalesVelocity(listingId, 30);
  const availableQuantity = listing.available_quantity || 0;

  let daysOfCover = null;
  if (salesData.velocity > 0) {
    daysOfCover = Math.round((availableQuantity / salesData.velocity) * 10) / 10;
  }

  return {
    listing_id: listingId,
    available_quantity: availableQuantity,
    sales_velocity_30d: salesData.velocity,
    days_of_cover: daysOfCover,
  };
}

/**
 * Create a publish job with listing event atomically
 * Implements pending job deduplication per IDEMPOTENCY.md §4.2
 *
 * @param {Object} params
 * @param {number} params.listingId
 * @param {string} params.jobType - 'PUBLISH_PRICE_CHANGE' or 'PUBLISH_STOCK_CHANGE'
 * @param {Object} params.inputJson - Job input data
 * @param {string} params.eventType - Event type (e.g., 'PRICE_CHANGE_DRAFTED')
 * @param {Object} params.beforeJson - Before state
 * @param {Object} params.afterJson - After state
 * @param {string} params.reason
 * @param {string} [params.correlationId]
 * @returns {Promise<Object>} Created job and event
 * @throws {Error} If duplicate pending job exists
 */
export async function createPublishJob({
  listingId,
  jobType,
  inputJson,
  eventType,
  beforeJson,
  afterJson,
  reason,
  correlationId = null,
}) {
  return await transaction(async (client) => {
    // Check for existing pending job with same params (deduplication)
    const existingResult = await client.query(`
      SELECT id, status FROM jobs
      WHERE listing_id = $1
        AND job_type = $2
        AND status = 'PENDING'
      LIMIT 1
    `, [listingId, jobType]);

    if (existingResult.rows.length > 0) {
      const existing = existingResult.rows[0];
      throw new Error(`Duplicate job: pending ${jobType} already exists (job_id: ${existing.id})`);
    }

    // Create listing event
    const eventResult = await client.query(`
      INSERT INTO listing_events (
        listing_id, event_type, before_json, after_json, reason, correlation_id, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, 'user')
      RETURNING *
    `, [
      listingId,
      eventType,
      JSON.stringify(beforeJson),
      JSON.stringify(afterJson),
      reason,
      correlationId,
    ]);

    const listingEvent = eventResult.rows[0];

    // Create job
    const jobResult = await client.query(`
      INSERT INTO jobs (
        job_type, scope_type, listing_id, status, input_json, created_by
      ) VALUES ($1, 'LISTING', $2, 'PENDING', $3, 'user')
      RETURNING *
    `, [
      jobType,
      listingId,
      JSON.stringify({
        ...inputJson,
        listing_event_id: listingEvent.id,
      }),
    ]);

    const job = jobResult.rows[0];

    // Link event to job
    await client.query(
      'UPDATE listing_events SET job_id = $1 WHERE id = $2',
      [job.id, listingEvent.id]
    );

    return {
      job_id: job.id,
      status: job.status,
      listing_id: listingId,
      listing_event_id: listingEvent.id,
    };
  });
}

/**
 * Update listing price
 * @param {number} listingId
 * @param {number} newPriceIncVat
 * @returns {Promise<Object>} Updated listing
 */
export async function updateListingPrice(listingId, newPriceIncVat) {
  const result = await query(`
    UPDATE listings
    SET price_inc_vat = $2, updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *
  `, [listingId, newPriceIncVat]);

  return result.rows[0] || null;
}

/**
 * Update listing stock
 * @param {number} listingId
 * @param {number} newQuantity
 * @returns {Promise<Object>} Updated listing
 */
export async function updateListingStock(listingId, newQuantity) {
  const result = await query(`
    UPDATE listings
    SET available_quantity = $2, updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *
  `, [listingId, newQuantity]);

  return result.rows[0] || null;
}

export default {
  getListingById,
  getSalesVelocity,
  getDaysOfCover,
  createPublishJob,
  updateListingPrice,
  updateListingStock,
};
