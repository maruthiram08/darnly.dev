import { Link } from './Link';
import { NewsletterForm } from './NewsletterForm';

export function Footer() {
  return (
    <footer className="site-footer">
      <NewsletterForm />
      <div className="site-footer__links">
        <Link href="/help">Shipping and returns</Link>
        <Link href="/help">Contact</Link>
        <span>© 2026 Pebble Store</span>
      </div>
    </footer>
  );
}
