/**
 * Operator Health Panel
 *
 * Displays system status including SP-API, Keepa, job queue, and publish mode.
 */

import { useState, useEffect } from 'react';
import { get } from '../api/client';

interface OperatorStatus {
  timestamp: string;
  database: {
    status: 'connected' | 'error';
  };
  sp_api: {
    status: 'connected' | 'not_configured' | 'error';
    configured: boolean;
    last_successful_call: string | null;
  };
  keepa: {
    status: 'connected' | 'not_configured' | 'unknown';
    configured: boolean;
    credits_remaining: number | null;
    rate_limit_reset: string | null;
    last_request: string | null;
  };
  job_queue: {
    pending: number;
    running: number;
    failed_24h: number;
    succeeded_24h: number;
  };
  sync_status: Record<string, string>;
  publish: {
    mode: 'simulate' | 'live';
    write_enabled: boolean;
    ready_for_live: boolean;
  };
}

// Format relative time
function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return 'Never';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

// Status indicator component
function StatusIndicator({ status }: { status: 'ok' | 'warning' | 'error' | 'unknown' }) {
  const colors = {
    ok: 'bg-green-500',
    warning: 'bg-yellow-500',
    error: 'bg-red-500',
    unknown: 'bg-gray-400',
  };

  return (
    <span className={`inline-block w-2.5 h-2.5 rounded-full ${colors[status]}`} />
  );
}

// Status card component
function StatusCard({
  title,
  status,
  children,
}: {
  title: string;
  status: 'ok' | 'warning' | 'error' | 'unknown';
  children: React.ReactNode;
}) {
  const borderColors = {
    ok: 'border-green-200',
    warning: 'border-yellow-200',
    error: 'border-red-200',
    unknown: 'border-gray-200',
  };

  return (
    <div className={`p-4 bg-white rounded-lg border-2 ${borderColors[status]}`}>
      <div className="flex items-center gap-2 mb-2">
        <StatusIndicator status={status} />
        <h3 className="font-medium text-gray-900">{title}</h3>
      </div>
      <div className="text-sm text-gray-600">{children}</div>
    </div>
  );
}

export function OperatorHealthPanel() {
  const [status, setStatus] = useState<OperatorStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = async () => {
    try {
      const data = await get<OperatorStatus>('/api/v2/operator-status');
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load status');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
    // Refresh every 30 seconds
    const interval = setInterval(loadStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  if (isLoading) {
    return (
      <div className="card mb-6">
        <div className="text-center py-8 text-gray-500">Loading system status...</div>
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">System Status</h2>
          <button onClick={loadStatus} className="text-sm text-blue-600 hover:text-blue-800">
            Retry
          </button>
        </div>
        <div className="p-4 bg-red-50 text-red-700 rounded">
          {error || 'Failed to load status'}
        </div>
      </div>
    );
  }

  // Determine statuses for status cards
  const spApiStatus: 'ok' | 'warning' | 'error' = status.sp_api.configured
    ? status.sp_api.last_successful_call ? 'ok' : 'warning'
    : 'error';
  const keepaStatus: 'ok' | 'warning' | 'unknown' = status.keepa.configured
    ? (status.keepa.credits_remaining !== null && status.keepa.credits_remaining > 10) ? 'ok' : 'warning'
    : 'unknown';

  // Format sync types
  const formatSyncType = (type: string): string => {
    return type.replace('SYNC_', '').replace(/_/g, ' ');
  };

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">System Status</h2>
          <p className="text-sm text-gray-500">Real-time monitoring of services and integrations</p>
        </div>
        <button onClick={loadStatus} className="text-sm text-blue-600 hover:text-blue-800">
          Refresh
        </button>
      </div>

      {/* Status Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {/* SP-API Status */}
        <StatusCard title="Amazon SP-API" status={spApiStatus}>
          <div className="space-y-1">
            <div className="flex justify-between">
              <span>Status:</span>
              <span className={`font-medium ${status.sp_api.configured ? 'text-green-600' : 'text-red-600'}`}>
                {status.sp_api.configured ? 'Connected' : 'Not Configured'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Last Call:</span>
              <span>{formatRelativeTime(status.sp_api.last_successful_call)}</span>
            </div>
          </div>
        </StatusCard>

        {/* Keepa Status */}
        <StatusCard title="Keepa API" status={keepaStatus}>
          <div className="space-y-1">
            <div className="flex justify-between">
              <span>Status:</span>
              <span className={`font-medium ${status.keepa.configured ? 'text-green-600' : 'text-gray-500'}`}>
                {status.keepa.configured ? 'Connected' : 'Not Configured'}
              </span>
            </div>
            {status.keepa.credits_remaining !== null && (
              <div className="flex justify-between">
                <span>Credits:</span>
                <span className={status.keepa.credits_remaining < 100 ? 'text-yellow-600 font-medium' : ''}>
                  {status.keepa.credits_remaining.toLocaleString()}
                </span>
              </div>
            )}
            {status.keepa.last_request && (
              <div className="flex justify-between">
                <span>Last Request:</span>
                <span>{formatRelativeTime(status.keepa.last_request)}</span>
              </div>
            )}
          </div>
        </StatusCard>

        {/* Publish Mode */}
        <StatusCard
          title="Publish Mode"
          status={status.publish.mode === 'live' ? 'warning' : 'ok'}
        >
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <span>Mode:</span>
              <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${
                status.publish.mode === 'live'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-blue-100 text-blue-700'
              }`}>
                {status.publish.mode}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Write Enabled:</span>
              <span className={status.publish.write_enabled ? 'text-red-600 font-medium' : 'text-gray-600'}>
                {status.publish.write_enabled ? 'Yes' : 'No'}
              </span>
            </div>
            {status.publish.mode === 'simulate' && (
              <p className="text-xs text-gray-500 mt-1">
                Changes are simulated only. No writes to Amazon.
              </p>
            )}
            {status.publish.mode === 'live' && (
              <p className="text-xs text-orange-600 mt-1">
                Changes WILL be published to Amazon!
              </p>
            )}
          </div>
        </StatusCard>
      </div>

      {/* Job Queue */}
      <div className="border-t border-gray-200 pt-4">
        <h3 className="font-medium text-gray-900 mb-3">Job Queue</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-3 bg-gray-50 rounded">
            <div className="text-2xl font-bold text-gray-900">{status.job_queue.pending}</div>
            <div className="text-xs text-gray-500">Pending</div>
          </div>
          <div className="text-center p-3 bg-blue-50 rounded">
            <div className="text-2xl font-bold text-blue-600">{status.job_queue.running}</div>
            <div className="text-xs text-gray-500">Running</div>
          </div>
          <div className="text-center p-3 bg-green-50 rounded">
            <div className="text-2xl font-bold text-green-600">{status.job_queue.succeeded_24h}</div>
            <div className="text-xs text-gray-500">Succeeded (24h)</div>
          </div>
          <div className={`text-center p-3 rounded ${status.job_queue.failed_24h > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
            <div className={`text-2xl font-bold ${status.job_queue.failed_24h > 0 ? 'text-red-600' : 'text-gray-400'}`}>
              {status.job_queue.failed_24h}
            </div>
            <div className="text-xs text-gray-500">Failed (24h)</div>
          </div>
        </div>
      </div>

      {/* Sync Status */}
      {Object.keys(status.sync_status).length > 0 && (
        <div className="border-t border-gray-200 pt-4 mt-4">
          <h3 className="font-medium text-gray-900 mb-3">Last Sync Times</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
            {Object.entries(status.sync_status).map(([type, time]) => (
              <div key={type} className="flex justify-between p-2 bg-gray-50 rounded">
                <span className="text-gray-600">{formatSyncType(type)}:</span>
                <span className="text-gray-900">{formatRelativeTime(time)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Last Updated */}
      <div className="text-xs text-gray-400 mt-4 text-right">
        Last updated: {new Date(status.timestamp).toLocaleTimeString()}
      </div>
    </div>
  );
}

export default OperatorHealthPanel;
