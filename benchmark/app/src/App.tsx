import { useRoute } from './hooks/useRoute';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { HomePage } from './pages/HomePage';
import { ProductsPage } from './pages/ProductsPage';
import { ProductPage } from './pages/ProductPage';
import { CartPage } from './pages/CartPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { OrdersPage } from './pages/OrdersPage';
import { SettingsPage } from './pages/SettingsPage';
import { HelpPage } from './pages/HelpPage';
import { EmptyState } from './components/EmptyState';

function Page({ path }: { path: string }) {
  if (path === '/') return <HomePage />;
  if (path === '/products') return <ProductsPage />;
  if (path.startsWith('/products/')) return <ProductPage id={path.split('/')[2]} />;
  if (path === '/cart') return <CartPage />;
  if (path === '/checkout') return <CheckoutPage />;
  if (path === '/orders') return <OrdersPage />;
  if (path === '/settings') return <SettingsPage />;
  if (path === '/help') return <HelpPage />;
  return <EmptyState title="Page not found" />;
}

export function App() {
  const { path } = useRoute();
  return (
    <div className="layout">
      <Header />
      <main>
        <Page path={path} />
      </main>
      <Footer />
    </div>
  );
}
