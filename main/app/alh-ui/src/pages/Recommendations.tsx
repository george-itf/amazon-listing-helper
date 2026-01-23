import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../layouts/PageHeader';
import { RiskBadge } from '../components/badges';
import { getRecommendations, acceptRecommendation, rejectRecommendation, snoozeRecommendation } from '../api/recommendations';
import type { Recommendation } from '../types';
import {
  getRecommendationTitle,
  getRecommendationDescription,
  getRecommendationActionText,
  getRecommendationEntityName,
} from '../types/recommendations';

// Spinner component for loading states
function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`animate-spin h-4 w-4 ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

// Lightbulb icon for empty state
function LightbulbIcon() {
  return (
    <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  );
}

// Map confidence to severity for display
function confidenceToSeverity(confidence: string): 'LOW' | 'MEDIUM' | 'HIGH' {
  return confidence as 'LOW' | 'MEDIUM' | 'HIGH';
}

// Get icon for recommendation type
function getRecommendationIcon(type: string): string {
  if (type.includes('PRICE_DECREASE')) return '↓';
  if (type.includes('PRICE_INCREASE')) return '↑';
  if (type.includes('STOCK')) return '📦';
  if (type.includes('MARGIN')) return '⚠️';
  if (type.includes('ANOMALY')) return '🔍';
  if (type.includes('OPPORTUNITY')) return '💡';
  return '📋';
}

// Get type category for grouping
function getTypeCategory(type: string): string {
  if (type.includes('PRICE')) return 'Price';
  if (type.includes('STOCK')) return 'Inventory';
  if (type.includes('MARGIN')) return 'Margin';
  if (type.includes('ANOMALY')) return 'Anomaly';
  if (type.includes('OPPORTUNITY')) return 'Opportunity';
  return 'Other';
}

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

  const [acceptingId, setAcceptingId] = useState<number | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleAccept = async (rec: Recommendation) => {
    setAcceptingId(rec.id);
    setSuccessMessage(null);
    try {
      const result = await acceptRecommendation(rec.id);
      // Show success with job info if a job was created
      if (result.job_created) {
        setSuccessMessage(`Accepted! Job #${result.job_id} created to apply the change.`);
        setTimeout(() => setSuccessMessage(null), 5000);
      }
      loadRecommendations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept recommendation');
    } finally {
      setAcceptingId(null);
    }
  };

  // Check if recommendation will create a job when accepted
  const willCreateJob = (rec: Recommendation): boolean => {
    const action = rec.action_payload_json?.action;
    return action === 'CHANGE_PRICE' || action === 'CHANGE_STOCK';
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
          <button
            onClick={loadRecommendations}
            disabled={isLoading}
            className="btn btn-secondary btn-sm inline-flex items-center gap-2"
          >
            {isLoading ? (
              <>
                <Spinner />
                Refreshing...
              </>
            ) : (
              'Refresh'
            )}
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

        {successMessage && (
          <div className="mb-4 p-3 bg-green-50 text-green-700 rounded-md text-sm flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {successMessage}
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
          <div className="text-center py-12">
            <div className="flex justify-center mb-4">
              <LightbulbIcon />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {activeTab === 'PENDING' ? 'No pending recommendations' : 'No recommendations found'}
            </h3>
            <p className="text-gray-500 max-w-md mx-auto mb-6">
              {activeTab === 'PENDING'
                ? "You're all caught up! Recommendations appear when we detect pricing opportunities, margin issues, or inventory risks."
                : "Recommendations are generated automatically when we analyze your listings data and find actionable insights."}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                to="/listings"
                className="btn btn-primary btn-sm inline-flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                View Listings
              </Link>
              <button
                onClick={loadRecommendations}
                disabled={isLoading}
                className="btn btn-secondary btn-sm inline-flex items-center gap-2"
              >
                {isLoading ? <Spinner /> : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                Check for Updates
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-6">
              Tip: Make sure your listings are synced from Amazon to get the most relevant recommendations.
            </p>
          </div>
        )}

        {!isLoading && !error && recommendations.length > 0 && (
          <div className="space-y-4">
            {recommendations.map((rec) => (
              <div key={rec.id} className="p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xl" title={getTypeCategory(rec.recommendation_type)}>
                        {getRecommendationIcon(rec.recommendation_type)}
                      </span>
                      <h3 className="font-medium">{getRecommendationTitle(rec)}</h3>
                      <RiskBadge
                        level={confidenceToSeverity(rec.confidence)}
                        label={rec.confidence}
                      />
                      <span className={`badge ${
                        rec.status === 'PENDING' ? 'badge-warning' :
                        rec.status === 'ACCEPTED' ? 'badge-success' :
                        rec.status === 'REJECTED' ? 'badge-danger' :
                        rec.status === 'SUPERSEDED' ? 'badge-neutral' :
                        'badge-neutral'
                      }`}>
                        {rec.status}
                      </span>
                    </div>

                    {/* Entity Link */}
                    <div className="text-sm text-gray-500 mt-1">
                      {rec.entity_type === 'LISTING' ? (
                        <Link
                          to={`/listings/${rec.entity_id}`}
                          className="text-blue-600 hover:underline"
                        >
                          {getRecommendationEntityName(rec)}
                        </Link>
                      ) : (
                        <span>{getRecommendationEntityName(rec)}</span>
                      )}
                    </div>

                    <p className="text-sm text-gray-600 mt-2">{getRecommendationDescription(rec)}</p>
                  </div>
                </div>

                {/* Action & Evidence */}
                <div className="mt-3 p-3 bg-gray-50 rounded text-sm">
                  <p className="font-medium text-gray-700 mb-1">Suggested Action</p>
                  <p className="text-gray-600">{getRecommendationActionText(rec)}</p>

                  {/* Impact Summary */}
                  {rec.impact_json && (
                    <div className="mt-2 pt-2 border-t border-gray-200">
                      <p className="font-medium text-gray-700 mb-1">Expected Impact</p>
                      <div className="flex flex-wrap gap-3 text-xs text-gray-600">
                        {rec.impact_json.estimated_margin_change !== undefined && (
                          <span>
                            Margin: {rec.impact_json.estimated_margin_change > 0 ? '+' : ''}
                            {(rec.impact_json.estimated_margin_change * 100).toFixed(1)}%
                          </span>
                        )}
                        {rec.impact_json.estimated_profit_change !== undefined && (
                          <span>
                            Profit: {rec.impact_json.estimated_profit_change > 0 ? '+' : ''}
                            £{rec.impact_json.estimated_profit_change.toFixed(2)}
                          </span>
                        )}
                        {rec.impact_json.buy_box_recovery_likelihood && (
                          <span>Buy Box Recovery: {rec.impact_json.buy_box_recovery_likelihood}</span>
                        )}
                        {rec.impact_json.urgency && (
                          <span className="text-orange-600">Urgency: {rec.impact_json.urgency}</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Confidence Score */}
                  <p className="text-gray-500 mt-2">
                    Confidence: {(rec.confidence_score * 100).toFixed(0)}%
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Generated: {new Date(rec.generated_at || rec.created_at).toLocaleString()}
                  </p>
                </div>

                {/* Actions */}
                {rec.status === 'PENDING' && (
                  <div className="flex gap-2 mt-4 flex-wrap items-center">
                    <button
                      onClick={() => handleAccept(rec)}
                      disabled={acceptingId === rec.id}
                      className="btn btn-primary btn-sm inline-flex items-center gap-1"
                      title={willCreateJob(rec) ? 'Accept and create publish job' : 'Accept recommendation'}
                    >
                      {acceptingId === rec.id ? (
                        <>
                          <Spinner />
                          Accepting...
                        </>
                      ) : (
                        <>
                          Accept
                          {willCreateJob(rec) && (
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                          )}
                        </>
                      )}
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
                    {rec.entity_type === 'LISTING' && (
                      <Link
                        to={`/listings/${rec.entity_id}`}
                        className="btn btn-secondary btn-sm"
                      >
                        View Listing
                      </Link>
                    )}
                    {willCreateJob(rec) && (
                      <span className="text-xs text-gray-500">
                        Creates publish job
                      </span>
                    )}
                  </div>
                )}
                {rec.status === 'ACCEPTED' && rec.accepted_job_id && (
                  <div className="mt-3 text-sm text-blue-600">
                    Publish job #{rec.accepted_job_id} created
                  </div>
                )}
                {rec.status === 'APPLIED' && (
                  <div className="mt-3 text-sm text-green-600">
                    Successfully applied
                  </div>
                )}
                {rec.status === 'FAILED' && (
                  <div className="mt-3 text-sm text-red-600">
                    Failed to apply - check job status
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
              <p className="text-sm text-gray-600 mb-4">{getRecommendationTitle(snoozeTarget)}</p>
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
