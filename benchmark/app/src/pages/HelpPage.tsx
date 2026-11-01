import { useState } from 'react';
import { Tabs } from '../components/Tabs';
import { Modal } from '../components/Modal';
import { Button } from '../components/Button';

const FAQ = [
  { q: 'How long does shipping take?', a: 'Standard shipping takes 3 to 5 working days. Express arrives the next day.' },
  { q: 'Can I return something?', a: 'Yes, within 30 days, as long as it is unused.' },
  { q: 'Do you ship abroad?', a: 'Not yet. We ship within the country only.' },
];

export function HelpPage() {
  const [tab, setTab] = useState('faq');
  const [contactOpen, setContactOpen] = useState(false);
  return (
    <div className="help">
      <h1>Help</h1>
      <Tabs tabs={[{ id: 'faq', label: 'Questions' }, { id: 'contact', label: 'Contact' }]} active={tab} onChange={setTab} />
      {tab === 'faq' ? (
        <dl className="faq">
          {FAQ.map((f) => (
            <div key={f.q}>
              <dt>{f.q}</dt>
              <dd>{f.a}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div>
          <p>We answer within one working day.</p>
          <Button onClick={() => setContactOpen(true)}>Show our email</Button>
        </div>
      )}
      <Modal title="Contact us" open={contactOpen} onClose={() => setContactOpen(false)}>
        <p>Write to help@pebble.example and we will get back to you.</p>
      </Modal>
    </div>
  );
}
