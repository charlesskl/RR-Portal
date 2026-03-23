import { useState, useEffect } from 'react';

export default function App() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    fetch('/api/items').then(r => r.json()).then(setItems);
  }, []);

  const addItem = async () => {
    const res = await fetch('/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'new item' }),
    });
    const data = await res.json();
    setItems([...items, data]);
  };

  return (
    <div>
      <h1>Test App (fetch)</h1>
      <button onClick={addItem}>Add Item</button>
      <ul>{items.map(i => <li key={i.id}>{i.name}</li>)}</ul>
    </div>
  );
}
