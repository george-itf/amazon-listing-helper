import { useState, useEffect } from 'react';
import { PageHeader } from '../layouts/PageHeader';
import { ListingsTable } from '../components/tables/ListingsTable';
import { PriceEditModal } from '../components/modals/PriceEditModal';
import { getListingsWithFeatures } from '../api/listings';
import { syncListingsFromAmazon, testSpApiConnection, getSyncStatus } from '../api/sync';
import type { ListingWithFeatures } from '../types';

export function ListingsPage() {
  const [listings, setListings] = useState<ListingWithFeatures[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [selectedListing, setSelectedListing] = useState<ListingWithFeatures | null>(null);
  const [isPriceModalOpen, setIsPriceModalOpen] = useState(false);
  const [spApiConfigured, setSpApiConfigured] = useState<boolean | null>(null);

  const loadListings = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await getListingsWithFeatures();
      setListings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load listings');
    } finally {
      setIsLoading(false);
    }
  };

  const checkSyncStatus = async () => {
    try {
      const status = await getSyncStatus();
      setSpApiConfigured(status.spApiConfigured);
    } catch {
      // Ignore errors checking status
    }
  };

  const handleSyncFromAmazon = async () => {
    setIsSyncing(true);
    setError(null);
    setSyncMessage('Testing Amazon SP-API connection...');

    try {
      // First test the connection
      const testResult = await testSpApiConnection();

      if (!testResult.configured) {
        throw new Error('SP-API credentials not configured. Please set SP_API_CLIENT_ID, SP_API_CLIENT_SECRET, and SP_API_REFRESH_TOKEN in Railway environment variables.');
      }

      if (!testResult.success) {
        throw new Error(`SP-API connection failed: ${testResult.error}`);
      }

      setSyncMessage('Connection OK. Requesting listings report from Amazon... This may take 2-5 minutes.');

      const result = await syncListingsFromAmazon();

      if (result.listingsProcessed === 0) {
        setSyncMessage('Sync complete but no listings found. Make sure you have active listings in Seller Central.');
      } else {
        setSyncMessage(
          `Sync complete: ${result.listingsCreated} created, ${result.listingsUpdated} updated (${result.listingsProcessed} total)`
        );
      }

      // Reload listings after sync
      await loadListings();
      // Clear success message after 10 seconds
      setTimeout(() => setSyncMessage(null), 10000);
    } catch (err) {
      // Handle both Error instances and ApiError objects from the axios interceptor
      let message: string;
      if (err instanceof Error) {
        message = err.message;
      } else if (err && typeof err === 'object' && 'message' in err) {
        message = (err as { message: string }).message;
      } else {
        message = 'Failed to sync from Amazon';
      }
      setError(message);
      setSyncMessage(null);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    loadListings();
    checkSyncStatus();
  }, []);

  const handleEditPrice = (listing: ListingWithFeatures) => {
    setSelectedListing(listing);
    setIsPriceModalOpen(true);
  };

  const handlePriceChangeSuccess = () => {
    // Reload listings to get updated data
    loadListings();
  };

  // Summary stats
  const stats = {
    total: listings.length,
    active: listings.filter((l) => l.status === 'ACTIVE').length,
    buyBoxWon: listings.filter((l) => l.features?.buy_box_status === 'WON').length,
    atRisk: listings.filter(
      (l) =>
        l.features?.buy_box_risk === 'HIGH' ||
        l.features?.stockout_risk === 'HIGH' ||
        (l.features?.margin != null && l.features.margin < 0.15)
    ).length,
  };

  return (
    <div>
      <PageHeader
        title="Listings Command Centre"
        subtitle={`${stats.total} total listings`}
        actions={
          <div className="flex gap-2">
            <button
              onClick={handleSyncFromAmazon}
              disabled={isSyncing}
              className="btn btn-primary btn-sm"
            >
              {isSyncing ? 'Syncing...' : 'Sync from Amazon'}
            </button>
            <button
              onClick={loadListings}
              disabled={isLoading || isSyncing}
              className="btn btn-secondary btn-sm"
            >
              Refresh
            </button>
          </div>
        }
      />

      {/* SP-API not configured warning */}
      {spApiConfigured === false && !syncMessage && !error && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800">
          <strong>SP-API not configured.</strong> Set these environment variables in Railway to enable Amazon sync:
          <ul className="mt-2 ml-4 list-disc text-sm">
            <li>SP_API_CLIENT_ID</li>
            <li>SP_API_CLIENT_SECRET</li>
            <li>SP_API_REFRESH_TOKEN</li>
          </ul>
        </div>
      )}

      {/* Sync status message */}
      {syncMessage && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700">
          {isSyncing && (
            <span className="inline-block animate-spin mr-2">&#8635;</span>
          )}
          {syncMessage}
        </div>
      )}

      {/* Error message */}
      {error && !syncMessage && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="card">
          <p className="text-sm text-gray-500">Total Listings</p>
          <p className="text-2xl font-semibold">{stats.total}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">Active</p>
          <p className="text-2xl font-semibold text-green-600">{stats.active}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">Buy Box Won</p>
          <p className="text-2xl font-semibold text-blue-600">{stats.buyBoxWon}</p>
        </div>
        <div className="card">
          <p className="text-sm text-gray-500">At Risk</p>
          <p className="text-2xl font-semibold text-red-600">{stats.atRisk}</p>
        </div>
      </div>

      {/* Main content */}
      <div className="card">
        {isLoading && !isSyncing && (
          <div className="text-center py-12 text-gray-500">
            <p>Loading listings...</p>
          </div>
        )}

        {isSyncing && (
          <div className="text-center py-12 text-gray-500">
            <div className="inline-block animate-spin text-3xl mb-4">&#8635;</div>
            <p>Syncing listings from Amazon...</p>
            <p className="text-sm mt-2">This may take a few minutes while Amazon generates the report.</p>
          </div>
        )}

        {!isLoading && !isSyncing && !error && listings.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-4">No listings found. Sync your listings from Amazon to get started.</p>
            <button
              onClick={handleSyncFromAmazon}
              disabled={isSyncing}
              className="btn btn-primary"
            >
              Sync from Amazon
            </button>
          </div>
        )}

        {!isLoading && !isSyncing && listings.length > 0 && (
          <ListingsTable
            listings={listings}
            onEditPrice={handleEditPrice}
          />
        )}
      </div>

      {/* Price edit modal */}
      {selectedListing && (
        <PriceEditModal
          listing={selectedListing}
          isOpen={isPriceModalOpen}
          onClose={() => {
            setIsPriceModalOpen(false);
            setSelectedListing(null);
          }}
          onSuccess={handlePriceChangeSuccess}
        />
      )}
    </div>
  );
}
