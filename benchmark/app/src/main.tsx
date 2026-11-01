import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { RouteProvider } from './hooks/useRoute';
import { CartProvider } from './hooks/useCart';
import { ToastProvider } from './hooks/useToast';
import './styles/base.css';
import './styles/components.css';
import './styles/products.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouteProvider>
      <CartProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </CartProvider>
    </RouteProvider>
  </StrictMode>,
);
