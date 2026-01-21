import { useState, useEffect } from 'react';
import { PageHeader } from '../layouts/PageHeader';
import { ListingsTable } from '../components/tables/ListingsTable';
import { PriceEditModal } from '../components/modals/PriceEditModal';
import { getListingsWithFeatures } from '../api/listings';
import { syncListingsFromAmazon } from '../api/sync';
import type { ListingWithFeatures } from '../types';

export function ListingsPage() {
  const [listings, setListings] = useState<ListingWithFeatures[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [selectedListing, setSelectedListing] = useState<ListingWithFeatures | null>(null);
  const [isPriceModalOpen, setIsPriceModalOpen] = useState(false);

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

  const handleSyncFromAmazon = async () => {
    setIsSyncing(true);
    setError(null);
    setSyncMessage('Syncing listings from Amazon... This may take a few minutes.');

    try {
      const result = await syncListingsFromAmazon();
      setSyncMessage(
        `Sync complete: ${result.listingsCreated} created, ${result.listingsUpdated} updated`
      );
      // Reload listings after sync
      await loadListings();
      // Clear success message after 5 seconds
      setTimeout(() => setSyncMessage(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync from Amazon');
      setSyncMessage(null);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    loadListings();
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

      {/* Sync status message */}
      {syncMessage && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700">
          {syncMessage}
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
        {(isLoading || isSyncing) && (
          <div className="text-center py-12 text-gray-500">
            <p>{isSyncing ? 'Syncing listings from Amazon...' : 'Loading listings...'}</p>
          </div>
        )}

        {error && (
          <div className="text-center py-12">
            <p className="text-red-600 mb-4">{error}</p>
            <button onClick={loadListings} className="btn btn-primary btn-sm">
              Retry
            </button>
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

        {!isLoading && !isSyncing && !error && listings.length > 0 && (
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
