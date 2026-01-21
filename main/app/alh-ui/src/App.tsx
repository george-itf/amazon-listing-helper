import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import {
  ListingsPage,
  ListingDetailPage,
  RecommendationsPage,
  AsinAnalyzerPage,
  BomLibraryPage,
  NotFoundPage,
} from './pages';

function App() {
  return (
    <BrowserRouter>
      <AppLayout>
        <Routes>
          {/* Redirect root to listings */}
          <Route path="/" element={<Navigate to="/listings" replace />} />

          {/* Listings */}
          <Route path="/listings" element={<ListingsPage />} />
          <Route path="/listings/:listingId" element={<ListingDetailPage />} />

          {/* Recommendations */}
          <Route path="/recommendations" element={<RecommendationsPage />} />

          {/* ASIN Analyzer */}
          <Route path="/asins" element={<AsinAnalyzerPage />} />

          {/* BOM Library */}
          <Route path="/bom" element={<BomLibraryPage />} />

          {/* 404 */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AppLayout>
    </BrowserRouter>
  );
}

export default App;
