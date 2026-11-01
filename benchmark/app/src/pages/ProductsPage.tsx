import { useEffect, useState } from 'react';
import type { Product } from '../data/products';
import { getJson } from '../lib/api';
import { useSearch } from '../hooks/useSearch';
import { SearchBar } from '../components/SearchBar';
import { ProductGrid } from '../components/ProductGrid';

export function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const results = useSearch(products, query, category);

  useEffect(() => {
    getJson<Product[]>('/api/products').then(setProducts);
  }, []);

  return (
    <>
      <h1>Shop</h1>
      <SearchBar query={query} onQuery={setQuery} category={category} onCategory={setCategory} />
      <p className="result-count">{results.length} products</p>
      <ProductGrid products={results} />
    </>
  );
}
