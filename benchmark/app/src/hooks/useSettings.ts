import { useEffect, useState } from 'react';
import { getJson, postJson } from '../lib/api';

export interface Settings {
  displayName: string;
  email: string;
  newsletter: boolean;
  orderUpdates: boolean;
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    getJson<Settings>('/api/settings').then(setSettings).catch(() => setSettings(null));
  }, []);

  const save = async (patch: Partial<Settings>) => {
    const next = await postJson<Settings>('/api/settings', patch);
    setSettings(next);
    return next;
  };

  return { settings, save };
}
