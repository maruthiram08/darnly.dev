import { useState } from 'react';
import { postJson } from '../lib/api';
import { useToast } from '../hooks/useToast';
import { Button } from './Button';

export function NewsletterForm() {
  const [email, setEmail] = useState('');
  const toast = useToast();
  return (
    <form
      className="newsletter"
      onSubmit={async (e) => {
        e.preventDefault();
        await postJson('/api/newsletter', { email });
        setEmail('');
        toast('You are on the list.');
      }}
    >
      <label htmlFor="newsletter-email">Get new products first</label>
      <div className="newsletter__row">
        <input id="newsletter-email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Button type="submit" variant="secondary">
          Subscribe
        </Button>
      </div>
    </form>
  );
}
