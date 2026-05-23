'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function AskAnythingSearchBar() {
  const router = useRouter();
  const [query, setQuery] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    router.push(`/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl">
      <div className="relative">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask anything — search calls, emails, files, contacts…"
          aria-label="Ask anything"
          className="w-full rounded-lg border bg-white px-4 py-2 pr-10 text-sm shadow-sm focus:border-blue-400 focus:outline-none"
        />
        <button
          type="submit"
          aria-label="Search"
          className="absolute right-1 top-1 rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
        >
          🔍
        </button>
      </div>
    </form>
  );
}
