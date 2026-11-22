import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/ui';
import { Dashboard } from './pages/Dashboard';
import { Collection } from './pages/Collection';
import { CardDetail } from './pages/CardDetail';
import { Decks } from './pages/Decks';
import { DeckEditor } from './pages/DeckEditor';
import { Misc } from './pages/Misc';
import { Wishlist } from './pages/Wishlist';
import { Sets } from './pages/Sets';
import { SetDetail } from './pages/SetDetail';
import { ImportExport } from './pages/ImportExport';
import { Settings } from './pages/Settings';

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 5_000 } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="collection" element={<Collection />} />
              <Route path="card/:id" element={<CardDetail />} />
              <Route path="decks" element={<Decks />} />
              <Route path="decks/:id" element={<DeckEditor />} />
              <Route path="misc" element={<Misc />} />
              <Route path="wishlist" element={<Wishlist />} />
              <Route path="sets" element={<Sets />} />
              <Route path="sets/:code" element={<SetDetail />} />
              <Route path="import" element={<ImportExport />} />
              <Route path="settings" element={<Settings />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
