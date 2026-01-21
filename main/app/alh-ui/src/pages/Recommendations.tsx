import { useState, useEffect } from 'react';
import { PageHeader } from '../layouts/PageHeader';
import { RiskBadge } from '../components/badges';
import { getRecommendations, acceptRecommendation, rejectRecommendation, snoozeRecommendation } from '../api/recommendations';
import type { Recommendation } from '../types';

export function RecommendationsPage() {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'PENDING' | 'all'>('PENDING');
  const [snoozeTarget, setSnoozeTarget] = useState<Recommendation | null>(null);

  const loadRecommendations = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = activeTab === 'PENDING' ? { status: 'PENDING' } : undefined;
      const data = await getRecommendations(params);
      setRecommendations(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load recommendations');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRecommendations();
  }, [activeTab]);

  const handleAccept = async (rec: Recommendation) => {
    try {
      await acceptRecommendation(rec.id);
      loadRecommendations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept recommendation');
    }
  };

  const handleReject = async (rec: Recommendation) => {
    try {
      await rejectRecommendation(rec.id);
      loadRecommendations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject recommendation');
    }
  };

  const handleSnooze = async (rec: Recommendation, hours: number) => {
    try {
      await snoozeRecommendation(rec.id, { snooze_until: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString() });
      setSnoozeTarget(null);
      loadRecommendations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to snooze recommendation');
    }
  };

  const pendingCount = recommendations.filter(r => r.status === 'PENDING').length;

  return (
    <div>
      <PageHeader
        title="Recommendations Hub"
        subtitle={`${pendingCount} pending recommendations`}
        actions={
          <button onClick={loadRecommendations} className="btn btn-secondary btn-sm">
            Refresh
          </button>
        }
      />

      {/* Tabs */}
      <div className="flex gap-4 mb-6">
        <button
          onClick={() => setActiveTab('PENDING')}
          className={`px-4 py-2 text-sm font-medium rounded-md ${
            activeTab === 'PENDING'
              ? 'bg-blue-100 text-blue-700'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          Pending
        </button>
        <button
          onClick={() => setActiveTab('all')}
          className={`px-4 py-2 text-sm font-medium rounded-md ${
            activeTab === 'all'
              ? 'bg-blue-100 text-blue-700'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          All
        </button>
      </div>

      {/* Content */}
      <div className="card">
        {isLoading && (
          <div className="text-center py-12 text-gray-500">
            <p>Loading recommendations...</p>
          </div>
        )}

        {error && (
          <div className="text-center py-12">
            <p className="text-red-600 mb-4">{error}</p>
            <button onClick={loadRecommendations} className="btn btn-primary btn-sm">
              Retry
            </button>
          </div>
        )}

        {!isLoading && !error && recommendations.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <p>No recommendations found</p>
          </div>
        )}

        {!isLoading && !error && recommendations.length > 0 && (
          <div className="space-y-4">
            {recommendations.map((rec) => (
              <div key={rec.id} className="p-4 border border-gray-200 rounded-lg">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">{rec.title}</h3>
                      <RiskBadge
                        level={rec.severity === 'CRITICAL' ? 'HIGH' : rec.severity}
                        label={rec.severity}
                      />
                      <span className={`badge ${
                        rec.status === 'PENDING' ? 'badge-warning' :
                        rec.status === 'ACCEPTED' ? 'badge-success' :
                        rec.status === 'REJECTED' ? 'badge-danger' :
                        'badge-neutral'
                      }`}>
                        {rec.status}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">{rec.description}</p>
                  </div>
                </div>

                {/* Evidence */}
                <div className="mt-3 p-3 bg-gray-50 rounded text-sm">
                  <p className="font-medium text-gray-700 mb-1">Evidence</p>
                  <p className="text-gray-600">{rec.action_text}</p>
                  {rec.confidence && (
                    <p className="text-gray-500 mt-1">
                      Confidence: {(rec.confidence * 100).toFixed(0)}%
                    </p>
                  )}
                  <p className="text-xs text-gray-400 mt-2">
                    Computed at: {new Date(rec.evidence_json.computed_at).toLocaleString()}
                  </p>
                </div>

                {/* Actions */}
                {rec.status === 'PENDING' && (
                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={() => handleAccept(rec)}
                      className="btn btn-primary btn-sm"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => handleReject(rec)}
                      className="btn btn-secondary btn-sm"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => setSnoozeTarget(rec)}
                      className="btn btn-secondary btn-sm"
                    >
                      Snooze
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Snooze Modal */}
      {snoozeTarget && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/30" onClick={() => setSnoozeTarget(null)} />
            <div className="relative bg-white rounded-lg shadow-xl max-w-sm w-full p-6">
              <h2 className="text-lg font-semibold mb-4">Snooze Recommendation</h2>
              <p className="text-sm text-gray-600 mb-4">{snoozeTarget.title}</p>
              <div className="space-y-2">
                <button
                  onClick={() => handleSnooze(snoozeTarget, 24)}
                  className="btn btn-secondary w-full"
                >
                  Snooze for 24 hours
                </button>
                <button
                  onClick={() => handleSnooze(snoozeTarget, 72)}
                  className="btn btn-secondary w-full"
                >
                  Snooze for 3 days
                </button>
                <button
                  onClick={() => handleSnooze(snoozeTarget, 168)}
                  className="btn btn-secondary w-full"
                >
                  Snooze for 1 week
                </button>
              </div>
              <button
                onClick={() => setSnoozeTarget(null)}
                className="btn btn-secondary w-full mt-4"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
