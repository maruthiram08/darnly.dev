import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const RouteContext = createContext<{ path: string; go: (to: string) => void }>({ path: '/', go: () => {} });

export function RouteProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = (to: string) => {
    window.history.pushState(null, '', to);
    setPath(to);
    window.scrollTo(0, 0);
  };
  return <RouteContext.Provider value={{ path, go }}>{children}</RouteContext.Provider>;
}

export function useRoute() {
  return useContext(RouteContext);
}
