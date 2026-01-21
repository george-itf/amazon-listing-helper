/**
 * Repository Index
 * Central export point for all repositories
 */

import listingRepository from './listing.repository.js';
import scoreRepository from './score.repository.js';
import taskRepository from './task.repository.js';
import alertRepository from './alert.repository.js';
import keepaRepository from './keepa.repository.js';
import settingsRepository from './settings.repository.js';

export {
  listingRepository,
  scoreRepository,
  taskRepository,
  alertRepository,
  keepaRepository,
  settingsRepository,
};

// Re-export individual functions if needed
export * as listing from './listing.repository.js';
export * as score from './score.repository.js';
export * as task from './task.repository.js';
export * as alert from './alert.repository.js';
export * as keepa from './keepa.repository.js';
export * as settings from './settings.repository.js';

export default {
  listing: listingRepository,
  score: scoreRepository,
  task: taskRepository,
  alert: alertRepository,
  keepa: keepaRepository,
  settings: settingsRepository,
};
