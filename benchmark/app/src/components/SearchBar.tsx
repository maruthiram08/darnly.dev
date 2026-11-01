interface Props {
  query: string;
  onQuery: (q: string) => void;
  category: string;
  onCategory: (c: string) => void;
}

const CATEGORIES = ['all', 'home', 'office', 'outdoor', 'kitchen'];

export function SearchBar({ query, onQuery, category, onCategory }: Props) {
  return (
    <div className="search-bar">
      <input type="search" placeholder="Search products" aria-label="Search products" value={query} onChange={(e) => onQuery(e.target.value)} />
      <select aria-label="Category" value={category} onChange={(e) => onCategory(e.target.value)}>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c === 'all' ? 'All categories' : c[0].toUpperCase() + c.slice(1)}
          </option>
        ))}
      </select>
    </div>
  );
}
