/**
 * Repository Index
 * Central export point for all active repositories
 *
 * Note: Unused repositories have been removed:
 * - score.repository.js (legacy scoring system)
 * - alert.repository.js (alerts not implemented)
 * - keepa.repository.js (logic moved to keepa.service.js)
 * - settings.repository.js (settings loaded via direct SQL)
 * - order.repository.js (orders sync not implemented)
 * - task.repository.js (replaced by job.repository.js)
 */

import listingRepository from './listing.repository.js';

export {
  listingRepository,
};

// Re-export individual functions if needed
export * as listing from './listing.repository.js';

export default {
  listing: listingRepository,
};
