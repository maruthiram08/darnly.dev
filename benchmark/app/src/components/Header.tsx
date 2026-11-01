import { useCart } from '../hooks/useCart';
import { useRoute } from '../hooks/useRoute';
import { Link } from './Link';
import { ThemeToggle } from './ThemeToggle';

const NAV = [
  { href: '/products', label: 'Shop' },
  { href: '/orders', label: 'Orders' },
  { href: '/settings', label: 'Settings' },
  { href: '/help', label: 'Help' },
];

export function Header() {
  const { count } = useCart();
  const { path } = useRoute();
  return (
    <header className="site-header">
      <Link href="/" className="logo">
        Pebble
      </Link>
      <nav className="site-nav">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} className={path.startsWith(item.href) ? 'active' : ''}>
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="site-header__right">
        <ThemeToggle />
        <Link href="/cart" className="cart-link">
          Cart ({count})
        </Link>
      </div>
    </header>
  );
}
