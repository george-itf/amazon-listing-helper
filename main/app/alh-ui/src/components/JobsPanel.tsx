/**
 * Jobs Panel Component
 *
 * Displays recent jobs with status, retry capabilities, and filtering.
 * Provides visibility into background job processing.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getJobs, getJobStats, retryJob, cancelJob, type Job, type JobStats } from '../api/jobs';

// Format job type for display
function formatJobType(jobType: string): string {
  return jobType
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Get status badge color
function getStatusColor(status: string): string {
  switch (status) {
    case 'PENDING':
      return 'bg-yellow-100 text-yellow-800';
    case 'RUNNING':
      return 'bg-blue-100 text-blue-800';
    case 'SUCCEEDED':
      return 'bg-green-100 text-green-800';
    case 'FAILED':
      return 'bg-red-100 text-red-800';
    case 'CANCELLED':
      return 'bg-gray-100 text-gray-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

// Relative time formatter
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

interface JobsPanelProps {
  /** Show only specific status */
  filterStatus?: string;
  /** Maximum number of jobs to show */
  limit?: number;
  /** Show compact view */
  compact?: boolean;
  /** Title for the panel */
  title?: string;
  /** Refresh interval in ms (0 to disable) */
  refreshInterval?: number;
}

export function JobsPanel({
  filterStatus,
  limit = 10,
  compact = false,
  title = 'Recent Jobs',
  refreshInterval = 30000,
}: JobsPanelProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stats, setStats] = useState<JobStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string | undefined>(filterStatus);

  const loadJobs = async () => {
    try {
      const [jobsData, statsData] = await Promise.all([
        getJobs({
          statuses: activeFilter,
          limit,
        }),
        getJobStats(),
      ]);
      setJobs(jobsData);
      setStats(statsData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load jobs');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadJobs();

    if (refreshInterval > 0) {
      const interval = setInterval(loadJobs, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [activeFilter, limit, refreshInterval]);

  const handleRetry = async (jobId: number) => {
    try {
      await retryJob(jobId);
      loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry job');
    }
  };

  const handleCancel = async (jobId: number) => {
    try {
      await cancelJob(jobId);
      loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel job');
    }
  };

  if (isLoading) {
    return (
      <div className="card">
        <div className="text-center py-8 text-gray-500">Loading jobs...</div>
      </div>
    );
  }

  return (
    <div className="card">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        <button
          onClick={loadJobs}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          Refresh
        </button>
      </div>

      {/* Stats Summary */}
      {stats && !compact && (
        <div className="flex gap-4 mb-4 text-sm">
          <button
            onClick={() => setActiveFilter(undefined)}
            className={`px-2 py-1 rounded ${!activeFilter ? 'bg-blue-100 text-blue-800' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            All ({Object.values(stats).reduce((a, b) => a + b, 0)})
          </button>
          <button
            onClick={() => setActiveFilter('PENDING')}
            className={`px-2 py-1 rounded ${activeFilter === 'PENDING' ? 'bg-yellow-100 text-yellow-800' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            Pending ({stats.PENDING})
          </button>
          <button
            onClick={() => setActiveFilter('RUNNING')}
            className={`px-2 py-1 rounded ${activeFilter === 'RUNNING' ? 'bg-blue-100 text-blue-800' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            Running ({stats.RUNNING})
          </button>
          <button
            onClick={() => setActiveFilter('FAILED')}
            className={`px-2 py-1 rounded ${activeFilter === 'FAILED' ? 'bg-red-100 text-red-800' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            Failed ({stats.FAILED})
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded text-sm">
          {error}
        </div>
      )}

      {/* Jobs List */}
      {jobs.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          {activeFilter ? `No ${activeFilter.toLowerCase()} jobs` : 'No jobs found'}
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => (
            <div
              key={job.id}
              className={`p-3 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors ${
                compact ? 'flex items-center justify-between' : ''
              }`}
            >
              <div className={compact ? 'flex items-center gap-3' : ''}>
                {/* Job Type & Status */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-2 py-0.5 text-xs font-medium rounded ${getStatusColor(job.status)}`}>
                    {job.status}
                  </span>
                  <span className="font-medium text-sm">
                    {formatJobType(job.job_type)}
                  </span>
                  {job.listing_sku && (
                    <Link
                      to={`/listings/${job.listing_id}`}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      {job.listing_sku}
                    </Link>
                  )}
                </div>

                {/* Error Message (if failed) */}
                {!compact && job.status === 'FAILED' && job.error_message && (
                  <p className="text-xs text-red-600 mt-1 truncate max-w-md">
                    {job.error_message}
                  </p>
                )}

                {/* Timing */}
                {!compact && (
                  <div className="text-xs text-gray-500 mt-1">
                    {job.finished_at
                      ? `Finished ${formatRelativeTime(job.finished_at)}`
                      : job.started_at
                      ? `Started ${formatRelativeTime(job.started_at)}`
                      : `Scheduled ${formatRelativeTime(job.scheduled_for)}`}
                    {job.attempts > 1 && ` (attempt ${job.attempts}/${job.max_attempts})`}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2 mt-2">
                {job.status === 'FAILED' && (
                  <button
                    onClick={() => handleRetry(job.id)}
                    className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
                  >
                    Retry
                  </button>
                )}
                {(job.status === 'PENDING' || job.status === 'RUNNING') && (
                  <button
                    onClick={() => handleCancel(job.id)}
                    className="text-xs px-2 py-1 bg-gray-50 text-gray-700 rounded hover:bg-gray-100"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default JobsPanel;
