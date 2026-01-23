/**
 * Attention Queue Page
 *
 * Displays prioritized list of items requiring attention:
 * - Failed jobs
 * - Buy Box Lost
 * - Margin at risk
 * - Stockout risk
 * - Stale data
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../layouts/PageHeader';
import { getAttentionQueue, type AttentionItem } from '../api/attention-queue';
import { retryJob } from '../api/jobs';
import { JobsPanel } from '../components/JobsPanel';

// Icon components for different item types
function FailedJobIcon() {
  return (
    <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function BuyBoxIcon() {
  return (
    <svg className="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  );
}

function MarginIcon() {
  return (
    <svg className="w-5 h-5 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function StockoutIcon() {
  return (
    <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
    </svg>
  );
}

function StaleDataIcon() {
  return (
    <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function getItemIcon(type: AttentionItem['type']) {
  switch (type) {
    case 'FAILED_JOB':
      return <FailedJobIcon />;
    case 'BUY_BOX_LOST':
      return <BuyBoxIcon />;
    case 'MARGIN_AT_RISK':
      return <MarginIcon />;
    case 'STOCKOUT_RISK':
      return <StockoutIcon />;
    case 'STALE_DATA':
      return <StaleDataIcon />;
    default:
      return null;
  }
}

function getPriorityLabel(priority: number): string {
  switch (priority) {
    case 1:
      return 'Critical';
    case 2:
      return 'High';
    case 3:
      return 'Medium';
    case 4:
      return 'Low';
    default:
      return 'Info';
  }
}

function getPriorityColor(priority: number): string {
  switch (priority) {
    case 1:
      return 'bg-red-100 text-red-800';
    case 2:
      return 'bg-orange-100 text-orange-800';
    case 3:
      return 'bg-yellow-100 text-yellow-800';
    case 4:
      return 'bg-blue-100 text-blue-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

function getTypeLabel(type: AttentionItem['type']): string {
  switch (type) {
    case 'FAILED_JOB':
      return 'Failed Job';
    case 'BUY_BOX_LOST':
      return 'Buy Box Lost';
    case 'MARGIN_AT_RISK':
      return 'Margin Risk';
    case 'STOCKOUT_RISK':
      return 'Stock Risk';
    case 'STALE_DATA':
      return 'Stale Data';
    default:
      return type;
  }
}

export function AttentionQueuePage() {
  const [items, setItems] = useState<AttentionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<AttentionItem['type'] | 'all'>('all');
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const loadItems = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await getAttentionQueue({ limit: 100 });
      setItems(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load attention queue');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadItems();

    // Auto-refresh every 60 seconds
    const interval = setInterval(loadItems, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleDismiss = (id: string) => {
    setDismissedIds((prev) => new Set([...prev, id]));
  };

  const handleRetryJob = async (jobId: number, itemId: string) => {
    try {
      await retryJob(jobId);
      handleDismiss(itemId);
      loadItems();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry job');
    }
  };

  // Filter items
  const filteredItems = items.filter((item) => {
    if (dismissedIds.has(item.id)) return false;
    if (activeFilter === 'all') return true;
    return item.type === activeFilter;
  });

  // Group by type for summary
  const countByType = items.reduce((acc, item) => {
    if (!dismissedIds.has(item.id)) {
      acc[item.type] = (acc[item.type] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  const totalItems = Object.values(countByType).reduce((a, b) => a + b, 0);

  return (
    <div>
      <PageHeader
        title="Attention Queue"
        subtitle={`${totalItems} items requiring attention`}
        actions={
          <button
            onClick={loadItems}
            disabled={isLoading}
            className="btn btn-secondary btn-sm inline-flex items-center gap-2"
          >
            {isLoading ? (
              <span className="animate-spin h-4 w-4 border-2 border-gray-300 border-t-gray-600 rounded-full" />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            Refresh
          </button>
        }
      />

      {/* Type Filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setActiveFilter('all')}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            activeFilter === 'all'
              ? 'bg-blue-100 text-blue-700'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          All ({totalItems})
        </button>
        {Object.entries(countByType).map(([type, count]) => (
          <button
            key={type}
            onClick={() => setActiveFilter(type as AttentionItem['type'])}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors inline-flex items-center gap-1 ${
              activeFilter === type
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {getItemIcon(type as AttentionItem['type'])}
            {getTypeLabel(type as AttentionItem['type'])} ({count})
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Queue */}
        <div className="lg:col-span-2">
          <div className="card">
            {isLoading && (
              <div className="text-center py-12 text-gray-500">
                Loading attention queue...
              </div>
            )}

            {error && (
              <div className="text-center py-12">
                <p className="text-red-600 mb-4">{error}</p>
                <button onClick={loadItems} className="btn btn-primary btn-sm">
                  Retry
                </button>
              </div>
            )}

            {!isLoading && !error && filteredItems.length === 0 && (
              <div className="text-center py-12">
                <div className="flex justify-center mb-4">
                  <svg className="w-12 h-12 text-green-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">All Clear!</h3>
                <p className="text-gray-500">
                  {activeFilter === 'all'
                    ? 'No items requiring attention right now.'
                    : `No ${getTypeLabel(activeFilter).toLowerCase()} items.`}
                </p>
              </div>
            )}

            {!isLoading && !error && filteredItems.length > 0 && (
              <div className="space-y-3">
                {filteredItems.map((item) => (
                  <div
                    key={item.id}
                    className="p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        {/* Icon */}
                        <div className="flex-shrink-0 mt-0.5">
                          {getItemIcon(item.type)}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-medium text-gray-900">
                              {item.title}
                            </h4>
                            <span className={`px-2 py-0.5 text-xs font-medium rounded ${getPriorityColor(item.priority)}`}>
                              {getPriorityLabel(item.priority)}
                            </span>
                          </div>

                          <p className="text-sm text-gray-600 mt-1">
                            {item.description}
                          </p>

                          {/* Listing Link */}
                          {item.listing_id && (
                            <div className="mt-2">
                              <Link
                                to={`/listings/${item.listing_id}`}
                                className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1"
                              >
                                <span className="font-mono">{item.listing_sku}</span>
                                {item.listing_title && (
                                  <span className="text-gray-500 truncate max-w-xs">
                                    - {item.listing_title}
                                  </span>
                                )}
                              </Link>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 flex-shrink-0">
                        {item.type === 'FAILED_JOB' && item.job_id && (
                          <button
                            onClick={() => handleRetryJob(item.job_id!, item.id)}
                            className="btn btn-primary btn-sm"
                          >
                            Retry
                          </button>
                        )}
                        {item.type === 'BUY_BOX_LOST' && item.listing_id && (
                          <Link
                            to={`/listings/${item.listing_id}`}
                            className="btn btn-primary btn-sm"
                          >
                            Review
                          </Link>
                        )}
                        {item.type === 'MARGIN_AT_RISK' && item.listing_id && (
                          <Link
                            to={`/listings/${item.listing_id}`}
                            className="btn btn-primary btn-sm"
                          >
                            Review Costs
                          </Link>
                        )}
                        {item.type === 'STOCKOUT_RISK' && item.listing_id && (
                          <Link
                            to={`/listings/${item.listing_id}`}
                            className="btn btn-primary btn-sm"
                          >
                            Order Stock
                          </Link>
                        )}
                        {item.type === 'STALE_DATA' && item.listing_id && (
                          <Link
                            to={`/listings/${item.listing_id}`}
                            className="btn btn-primary btn-sm"
                          >
                            Refresh
                          </Link>
                        )}
                        <button
                          onClick={() => handleDismiss(item.id)}
                          className="btn btn-secondary btn-sm"
                          title="Dismiss for now"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar - Jobs Panel */}
        <div className="lg:col-span-1">
          <JobsPanel
            title="Recent Jobs"
            limit={5}
            compact
            refreshInterval={30000}
          />
        </div>
      </div>
    </div>
  );
}

export default AttentionQueuePage;
