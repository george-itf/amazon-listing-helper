/**
 * Listing Repository
 * Handles all database operations for listings
 *
 * NOTE: Column names match the migrated schema (001_slice_a_schema.sql):
 * - seller_sku (was: sku)
 * - price_inc_vat (was: price)
 * - available_quantity (was: quantity)
 */

import { query, transaction } from '../database/connection.js';

/**
 * Get all listings with optional filters
 * @param {Object} filters - Filter options (status, category, search)
 * @returns {Promise<Array>} Array of listings
 */
export async function getAll(filters = {}) {
  let sql = `
    SELECT
      l.*,
      COALESCE(
        json_agg(
          DISTINCT jsonb_build_object(
            'id', li.id,
            'url', li.url,
            'position', li.position,
            'variant', li.variant
          )
        ) FILTER (WHERE li.id IS NOT NULL),
        '[]'
      ) as images
    FROM listings l
    LEFT JOIN listing_images li ON l.id = li."listingId"
    WHERE 1=1
  `;

  const params = [];
  let paramCount = 1;

  if (filters.status) {
    sql += ` AND l.status = $${paramCount++}`;
    params.push(filters.status);
  }

  if (filters.category) {
    sql += ` AND l.category = $${paramCount++}`;
    params.push(filters.category);
  }

  if (filters.search) {
    sql += ` AND (l.title ILIKE $${paramCount} OR l.seller_sku ILIKE $${paramCount} OR l.asin ILIKE $${paramCount++})`;
    params.push(`%${filters.search}%`);
  }

  sql += ` GROUP BY l.id ORDER BY l."updatedAt" DESC`;

  if (filters.limit) {
    sql += ` LIMIT $${paramCount++}`;
    params.push(filters.limit);
  }

  if (filters.offset) {
    sql += ` OFFSET $${paramCount++}`;
    params.push(filters.offset);
  }

  const result = await query(sql, params);
  return result.rows;
}

/**
 * Get a single listing by ID
 * @param {string} id - Listing ID
 * @returns {Promise<Object|null>} Listing object or null
 */
export async function getById(id) {
  const sql = `
    SELECT
      l.*,
      COALESCE(
        json_agg(
          DISTINCT jsonb_build_object(
            'id', li.id,
            'url', li.url,
            'position', li.position,
            'variant', li.variant
          )
        ) FILTER (WHERE li.id IS NOT NULL),
        '[]'
      ) as images
    FROM listings l
    LEFT JOIN listing_images li ON l.id = li."listingId"
    WHERE l.id = $1
    GROUP BY l.id
  `;

  const result = await query(sql, [id]);
  return result.rows[0] || null;
}

/**
 * Get a listing by SKU
 * @param {string} sku - SKU (seller_sku)
 * @returns {Promise<Object|null>} Listing object or null
 */
export async function getBySku(sku) {
  const sql = `
    SELECT
      l.*,
      COALESCE(
        json_agg(
          DISTINCT jsonb_build_object(
            'id', li.id,
            'url', li.url,
            'position', li.position,
            'variant', li.variant
          )
        ) FILTER (WHERE li.id IS NOT NULL),
        '[]'
      ) as images
    FROM listings l
    LEFT JOIN listing_images li ON l.id = li."listingId"
    WHERE l.seller_sku = $1
    GROUP BY l.id
  `;

  const result = await query(sql, [sku]);
  return result.rows[0] || null;
}

/**
 * Get a listing by ASIN
 * @param {string} asin - ASIN
 * @returns {Promise<Object|null>} Listing object or null
 */
export async function getByAsin(asin) {
  const sql = `
    SELECT
      l.*,
      COALESCE(
        json_agg(
          DISTINCT jsonb_build_object(
            'id', li.id,
            'url', li.url,
            'position', li.position,
            'variant', li.variant
          )
        ) FILTER (WHERE li.id IS NOT NULL),
        '[]'
      ) as images
    FROM listings l
    LEFT JOIN listing_images li ON l.id = li."listingId"
    WHERE l.asin = $1
    GROUP BY l.id
  `;

  const result = await query(sql, [asin]);
  return result.rows[0] || null;
}

/**
 * Create a new listing
 * @param {Object} data - Listing data
 * @returns {Promise<Object>} Created listing
 */
export async function create(data) {
  return transaction(async (client) => {
    const listingSql = `
      INSERT INTO listings (
        seller_sku, asin, title, description, "bulletPoints", price_inc_vat, available_quantity,
        status, category, "fulfillmentChannel", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      RETURNING *
    `;

    const listingResult = await client.query(listingSql, [
      data.sku || data.seller_sku,
      data.asin,
      data.title,
      data.description || null,
      JSON.stringify(data.bulletPoints || []),
      data.price || data.price_inc_vat || 0,
      data.quantity || data.available_quantity || 0,
      data.status || 'active',
      data.category || null,
      data.fulfillmentChannel || 'FBM',
    ]);

    const listing = listingResult.rows[0];

    // Insert images if provided
    if (data.images && data.images.length > 0) {
      for (const image of data.images) {
        await client.query(
          `INSERT INTO listing_images ("listingId", url, position, variant)
           VALUES ($1, $2, $3, $4)`,
          [listing.id, image.url, image.position || 0, image.variant || null]
        );
      }
    }

    return getById(listing.id);
  });
}

/**
 * Update a listing
 * @param {string} id - Listing ID
 * @param {Object} data - Updated data
 * @returns {Promise<Object>} Updated listing
 */
export async function update(id, data) {
  return transaction(async (client) => {
    const fields = [];
    const values = [];
    let paramCount = 1;

    // Map of input field names to database column names
    const fieldMap = {
      'sku': 'seller_sku',
      'seller_sku': 'seller_sku',
      'asin': 'asin',
      'title': 'title',
      'description': 'description',
      'bulletPoints': '"bulletPoints"',
      'price': 'price_inc_vat',
      'price_inc_vat': 'price_inc_vat',
      'quantity': 'available_quantity',
      'available_quantity': 'available_quantity',
      'status': 'status',
      'category': 'category',
      'fulfillmentChannel': '"fulfillmentChannel"',
    };

    for (const [inputField, dbColumn] of Object.entries(fieldMap)) {
      if (data[inputField] !== undefined) {
        fields.push(`${dbColumn} = $${paramCount++}`);
        values.push(inputField === 'bulletPoints' ? JSON.stringify(data[inputField]) : data[inputField]);
      }
    }

    if (fields.length === 0) {
      return getById(id);
    }

    fields.push(`"updatedAt" = NOW()`);
    values.push(id);

    const sql = `
      UPDATE listings
      SET ${fields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    await client.query(sql, values);

    // Update images if provided
    if (data.images !== undefined) {
      // Delete existing images
      await client.query('DELETE FROM listing_images WHERE "listingId" = $1', [id]);

      // Insert new images
      for (const image of data.images || []) {
        await client.query(
          `INSERT INTO listing_images ("listingId", url, position, variant)
           VALUES ($1, $2, $3, $4)`,
          [id, image.url, image.position || 0, image.variant || null]
        );
      }
    }

    return getById(id);
  });
}

/**
 * Delete a listing
 * @param {string} id - Listing ID
 * @returns {Promise<boolean>} True if deleted
 */
export async function remove(id) {
  const result = await query('DELETE FROM listings WHERE id = $1 RETURNING id', [id]);
  return result.rowCount > 0;
}

/**
 * Get listing count by status
 * @returns {Promise<Object>} Count by status
 */
export async function getCountByStatus() {
  const sql = `
    SELECT status, COUNT(*) as count
    FROM listings
    GROUP BY status
  `;

  const result = await query(sql);
  return result.rows.reduce((acc, row) => {
    acc[row.status] = parseInt(row.count);
    return acc;
  }, {});
}

/**
 * Get status counts (alias for getCountByStatus)
 * @returns {Promise<Object>} Count by status
 */
export async function getStatusCounts() {
  return getCountByStatus();
}

/**
 * Upsert a listing (insert or update)
 * @param {Object} data - Listing data
 * @returns {Promise<Object>} Upserted listing
 */
export async function upsert(data) {
  const sql = `
    INSERT INTO listings (
      seller_sku, asin, title, description, "bulletPoints", price_inc_vat, available_quantity,
      status, category, "fulfillmentChannel", "currentScore", "createdAt", "updatedAt"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
    ON CONFLICT (seller_sku) DO UPDATE SET
      asin = COALESCE(EXCLUDED.asin, listings.asin),
      title = COALESCE(EXCLUDED.title, listings.title),
      description = COALESCE(EXCLUDED.description, listings.description),
      "bulletPoints" = COALESCE(EXCLUDED."bulletPoints", listings."bulletPoints"),
      price_inc_vat = COALESCE(EXCLUDED.price_inc_vat, listings.price_inc_vat),
      available_quantity = COALESCE(EXCLUDED.available_quantity, listings.available_quantity),
      status = COALESCE(EXCLUDED.status, listings.status),
      category = COALESCE(EXCLUDED.category, listings.category),
      "fulfillmentChannel" = COALESCE(EXCLUDED."fulfillmentChannel", listings."fulfillmentChannel"),
      "currentScore" = COALESCE(EXCLUDED."currentScore", listings."currentScore"),
      "updatedAt" = NOW()
    RETURNING *
  `;

  const result = await query(sql, [
    data.sku || data.seller_sku,
    data.asin || null,
    data.title || null,
    data.description || null,
    JSON.stringify(data.bulletPoints || data.bullet_points || []),
    data.price || data.price_inc_vat || 0,
    data.quantity || data.available_quantity || 0,
    data.status || 'active',
    data.category || null,
    data.fulfillmentChannel || data.fulfillment_channel || 'FBM',
    data.currentScore || data.current_score || null,
  ]);

  return result.rows[0];
}

/**
 * Get listings with low scores
 * @param {number} threshold - Score threshold
 * @returns {Promise<Array>} Listings below threshold
 */
export async function getLowScoreListings(threshold = 50) {
  const sql = `
    SELECT l.*, ls."totalScore"
    FROM listings l
    INNER JOIN listing_scores ls ON l.id = ls."listingId"
    WHERE ls."totalScore" < $1
    ORDER BY ls."totalScore" ASC
  `;

  const result = await query(sql, [threshold]);
  return result.rows;
}

/**
 * Bulk upsert listings (single query for all listings)
 * Uses UNNEST arrays for efficient bulk insert with conflict handling.
 * Returns counts of created vs updated rows.
 *
 * @param {Array<Object>} listings - Array of listing data
 * @returns {Promise<{created: number, updated: number, rows: Array}>}
 */
export async function bulkUpsert(listings) {
  if (!listings || listings.length === 0) {
    return { created: 0, updated: 0, rows: [] };
  }

  // Prepare arrays for UNNEST - each column is a separate array
  const skus = [];
  const asins = [];
  const titles = [];
  const descriptions = [];
  const bulletPoints = [];
  const prices = [];
  const quantities = [];
  const statuses = [];
  const categories = [];
  const fulfillmentChannels = [];

  for (const listing of listings) {
    skus.push(listing.sku || listing.seller_sku);
    asins.push(listing.asin || null);
    titles.push(listing.title || null);
    descriptions.push(listing.description || null);
    bulletPoints.push(JSON.stringify(listing.bulletPoints || listing.bullet_points || []));
    prices.push(listing.price || listing.price_inc_vat || 0);
    quantities.push(listing.quantity || listing.available_quantity || 0);
    statuses.push(listing.status || 'active');
    categories.push(listing.category || null);
    fulfillmentChannels.push(listing.fulfillmentChannel || listing.fulfillment_channel || 'FBM');
  }

  // Use UNNEST to create rows from parallel arrays
  // xmax = 0 means the row was inserted (not updated)
  const sql = `
    INSERT INTO listings (
      seller_sku, asin, title, description, "bulletPoints",
      price_inc_vat, available_quantity, status, category, "fulfillmentChannel",
      "createdAt", "updatedAt"
    )
    SELECT * FROM UNNEST(
      $1::text[], $2::text[], $3::text[], $4::text[], $5::jsonb[],
      $6::numeric[], $7::integer[], $8::text[], $9::text[], $10::text[]
    ) AS t(seller_sku, asin, title, description, "bulletPoints",
           price_inc_vat, available_quantity, status, category, "fulfillmentChannel")
    CROSS JOIN (SELECT NOW() AS created, NOW() AS updated) AS times
    ON CONFLICT (seller_sku) DO UPDATE SET
      asin = COALESCE(EXCLUDED.asin, listings.asin),
      title = COALESCE(EXCLUDED.title, listings.title),
      description = COALESCE(EXCLUDED.description, listings.description),
      "bulletPoints" = COALESCE(EXCLUDED."bulletPoints", listings."bulletPoints"),
      price_inc_vat = COALESCE(EXCLUDED.price_inc_vat, listings.price_inc_vat),
      available_quantity = COALESCE(EXCLUDED.available_quantity, listings.available_quantity),
      status = COALESCE(EXCLUDED.status, listings.status),
      category = COALESCE(EXCLUDED.category, listings.category),
      "fulfillmentChannel" = COALESCE(EXCLUDED."fulfillmentChannel", listings."fulfillmentChannel"),
      "updatedAt" = NOW()
    RETURNING *, (xmax = 0) AS is_insert
  `;

  const result = await query(sql, [
    skus, asins, titles, descriptions, bulletPoints,
    prices, quantities, statuses, categories, fulfillmentChannels,
  ]);

  // Count inserts vs updates using xmax
  let created = 0;
  let updated = 0;
  for (const row of result.rows) {
    if (row.is_insert) {
      created++;
    } else {
      updated++;
    }
  }

  return {
    created,
    updated,
    rows: result.rows,
  };
}

/**
 * Get existing SKUs from a list (bulk check)
 * @param {string[]} skus - Array of SKUs to check
 * @returns {Promise<Set<string>>} Set of existing SKUs
 */
export async function getExistingSkus(skus) {
  if (!skus || skus.length === 0) {
    return new Set();
  }

  const result = await query(
    'SELECT seller_sku FROM listings WHERE seller_sku = ANY($1)',
    [skus]
  );

  return new Set(result.rows.map(r => r.seller_sku));
}

export default {
  getAll,
  getById,
  getBySku,
  getByAsin,
  create,
  update,
  upsert,
  bulkUpsert,
  getExistingSkus,
  remove,
  getCountByStatus,
  getStatusCounts,
  getLowScoreListings,
};
