import { useSettings } from '../hooks/useSettings';
import { useToast } from '../hooks/useToast';
import { Button } from '../components/Button';

export function SettingsPage() {
  const { settings, save } = useSettings();
  const toast = useToast();
  if (!settings) return <p>Loading settings…</p>;

  return (
    <div className="settings">
      <h1>Settings</h1>
      <section className="settings-card">
        <h2>Profile</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const data = Object.fromEntries(new FormData(e.currentTarget));
            const displayName = (data.display_name as string).trim();
            const email = (data.email as string).trim();
            await save({ displayName, email });
            toast('Settings saved');
          }}
        >
          <label>
            Display name
            <input name="displayName" defaultValue={settings.displayName} />
          </label>
          <label>
            Email
            <input name="email" type="email" defaultValue={settings.email} />
          </label>
          <Button type="submit">Save</Button>
        </form>
      </section>
      <section className="settings-card">
        <h2>Notifications</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            await save({ newsletter: data.get('newsletter') === 'on', orderUpdates: data.get('orderUpdates') === 'on' });
            toast('Notification settings saved');
          }}
        >
          <label className="check">
            <input type="checkbox" name="newsletter" defaultChecked={settings.newsletter} /> Newsletter
          </label>
          <label className="check">
            <input type="checkbox" name="orderUpdates" defaultChecked={settings.orderUpdates} /> Order updates by email
          </label>
          <Button type="submit" variant="secondary">
            Save
          </Button>
        </form>
      </section>
    </div>
  );
}
