import { useTheme } from '../hooks/useTheme';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <label className="theme-toggle">
      <input type="checkbox" role="switch" checked={theme === 'dark'} onChange={toggle} aria-label="Dark mode" />
      <span className="theme-toggle__track" aria-hidden="true" />
      <span className="theme-toggle__label">Dark mode</span>
    </label>
  );
}
