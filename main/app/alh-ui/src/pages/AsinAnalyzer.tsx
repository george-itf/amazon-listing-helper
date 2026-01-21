import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../layouts/PageHeader';
import { analyzeAsin, trackAsin, getTrackedAsins, convertAsinToListing } from '../api/asins';
import type { AsinAnalysis, AsinEntity } from '../api/asins';

export function AsinAnalyzerPage() {
  const navigate = useNavigate();
  const [asinInput, setAsinInput] = useState('');
  const [analysis, setAnalysis] = useState<AsinAnalysis | null>(null);
  const [trackedAsins, setTrackedAsins] = useState<AsinEntity[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Convert form state
  const [showConvertForm, setShowConvertForm] = useState(false);
  const [convertSku, setConvertSku] = useState('');
  const [convertPrice, setConvertPrice] = useState('');
  const [convertQuantity, setConvertQuantity] = useState('100');

  const handleAnalyze = async () => {
    const asin = asinInput.trim().toUpperCase();
    if (!asin || asin.length !== 10) {
      setError('Please enter a valid 10-character ASIN');
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setAnalysis(null);

    try {
      const result = await analyzeAsin(asin);
      setAnalysis(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleTrack = async () => {
    if (!analysis) return;

    try {
      await trackAsin(analysis.asin);
      const tracked = await getTrackedAsins();
      setTrackedAsins(tracked);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to track ASIN');
    }
  };

  const handleConvert = async () => {
    if (!analysis || !convertSku.trim() || !convertPrice) {
      setError('Please fill in all required fields');
      return;
    }

    setIsConverting(true);
    setError(null);

    try {
      const result = await convertAsinToListing(analysis.asin_entity_id, {
        seller_sku: convertSku.trim(),
        initial_price_inc_vat: parseFloat(convertPrice),
        initial_quantity: parseInt(convertQuantity) || 100,
      });
      navigate(`/listings/${result.listing_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Conversion failed');
    } finally {
      setIsConverting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="ASIN Analyzer"
        subtitle="Research new products and convert to listings"
      />

      {/* Search */}
      <div className="card mb-6">
        <div className="flex gap-4">
          <input
            type="text"
            placeholder="Enter ASIN (e.g., B08N5WRWNW)"
            className="input flex-1"
            value={asinInput}
            onChange={(e) => setAsinInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
            maxLength={10}
          />
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            className="btn btn-primary"
          >
            {isAnalyzing ? 'Analyzing...' : 'Analyze'}
          </button>
        </div>

        {error && (
          <p className="text-red-600 text-sm mt-2">{error}</p>
        )}
      </div>

      {/* Analysis Results */}
      {analysis && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Market Data */}
          <div className="card">
            <h3 className="font-semibold mb-4">Market Reality (Keepa)</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-600">ASIN</span>
                <span className="font-mono">{analysis.asin}</span>
              </div>
              {analysis.market_data?.keepa_price_median_90d != null && (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Price Median (90d)</span>
                    <span>£{analysis.market_data.keepa_price_median_90d.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Price Range</span>
                    <span>
                      £{analysis.market_data?.keepa_price_p25_90d?.toFixed(2) ?? '-'} - £
                      {analysis.market_data?.keepa_price_p75_90d?.toFixed(2) ?? '-'}
                    </span>
                  </div>
                </>
              )}
              {analysis.market_data?.keepa_offers_count_current != null && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Current Offers</span>
                  <span>{analysis.market_data.keepa_offers_count_current}</span>
                </div>
              )}
              {analysis.market_data?.keepa_volatility_90d != null && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Price Volatility</span>
                  <span>{(analysis.market_data.keepa_volatility_90d * 100).toFixed(1)}%</span>
                </div>
              )}
              <p className="text-xs text-gray-400 mt-2">
                Analyzed at: {new Date(analysis.analyzed_at).toLocaleString()}
              </p>
            </div>
          </div>

          {/* Economics Scenario */}
          <div className="card">
            <h3 className="font-semibold mb-4">Your Economics (Scenario)</h3>
            {analysis.economics_scenario ? (
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-600">Suggested Price (inc VAT)</span>
                  <span className="font-semibold">
                    £{analysis.economics_scenario.suggested_price_inc_vat.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">BOM Cost (ex VAT)</span>
                  <span>£{analysis.economics_scenario.bom_cost_ex_vat.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Est. Fees (ex VAT)</span>
                  <span>£{analysis.economics_scenario.estimated_fees_ex_vat.toFixed(2)}</span>
                </div>
                <div className="border-t pt-3">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Est. Profit (ex VAT)</span>
                    <span className={
                      analysis.economics_scenario.estimated_profit_ex_vat < 0
                        ? 'text-red-600 font-semibold'
                        : 'text-green-600 font-semibold'
                    }>
                      £{analysis.economics_scenario.estimated_profit_ex_vat.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Est. Margin</span>
                    <span className="font-semibold">
                      {(analysis.economics_scenario.estimated_margin * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-gray-500">No BOM scenario available. Create a scenario BOM first.</p>
            )}
          </div>

          {/* Recommendation */}
          <div className="card lg:col-span-2">
            <h3 className="font-semibold mb-4">Opportunity Assessment</h3>
            {analysis.opportunity_score != null && (
              <div className="mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-gray-600">Opportunity Score:</span>
                  <span className={`text-xl font-bold ${
                    analysis.opportunity_score >= 0.7 ? 'text-green-600' :
                    analysis.opportunity_score >= 0.4 ? 'text-yellow-600' :
                    'text-red-600'
                  }`}>
                    {(analysis.opportunity_score * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            )}
            {analysis.recommendation && (
              <p className="text-gray-700">{analysis.recommendation}</p>
            )}

            {/* Actions */}
            <div className="flex gap-3 mt-6">
              <button onClick={handleTrack} className="btn btn-secondary">
                Track ASIN
              </button>
              <button
                onClick={() => setShowConvertForm(true)}
                className="btn btn-primary"
              >
                Convert to Listing
              </button>
            </div>
          </div>

          {/* Convert Form */}
          {showConvertForm && (
            <div className="card lg:col-span-2">
              <h3 className="font-semibold mb-4">Convert to Listing</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="label">Seller SKU *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="YOUR-SKU-001"
                    value={convertSku}
                    onChange={(e) => setConvertSku(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Initial Price (inc VAT) *</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">£</span>
                    <input
                      type="number"
                      step="0.01"
                      className="input pl-7"
                      value={convertPrice}
                      onChange={(e) => setConvertPrice(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label className="label">Initial Quantity</label>
                  <input
                    type="number"
                    className="input"
                    value={convertQuantity}
                    onChange={(e) => setConvertQuantity(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-4">
                <button
                  onClick={handleConvert}
                  disabled={isConverting}
                  className="btn btn-primary"
                >
                  {isConverting ? 'Converting...' : 'Create Listing'}
                </button>
                <button
                  onClick={() => setShowConvertForm(false)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tracked ASINs */}
      {trackedAsins.length > 0 && (
        <div className="card mt-6">
          <h3 className="font-semibold mb-4">Tracked ASINs</h3>
          <div className="space-y-2">
            {trackedAsins.map((asin) => (
              <div key={asin.id} className="flex justify-between items-center p-2 bg-gray-50 rounded">
                <span className="font-mono">{asin.asin}</span>
                <span className={`badge ${
                  asin.status === 'READY' ? 'badge-success' :
                  asin.status === 'ANALYZING' ? 'badge-warning' :
                  'badge-neutral'
                }`}>
                  {asin.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
