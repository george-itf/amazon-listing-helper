import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { ToastProvider } from './components/ui';
import {
  ListingsPage,
  ListingDetailPage,
  RecommendationsPage,
  AttentionQueuePage,
  SettingsPage,
  AsinAnalyzerPage,
  BomLibraryPage,
  NotFoundPage,
} from './pages';

function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AppLayout>
        <Routes>
          {/* Redirect root to listings */}
          <Route path="/" element={<Navigate to="/listings" replace />} />

          {/* Listings */}
          <Route path="/listings" element={<ListingsPage />} />
          <Route path="/listings/:listingId" element={<ListingDetailPage />} />

          {/* Recommendations */}
          <Route path="/recommendations" element={<RecommendationsPage />} />

          {/* Attention Queue */}
          <Route path="/attention" element={<AttentionQueuePage />} />

          {/* ASIN Analyzer */}
          <Route path="/asins" element={<AsinAnalyzerPage />} />

          {/* BOM Library */}
          <Route path="/bom" element={<BomLibraryPage />} />

          {/* Settings */}
          <Route path="/settings" element={<SettingsPage />} />

          {/* 404 */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        </AppLayout>
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
