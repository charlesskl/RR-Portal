import { useState, useEffect } from 'react';
import axios from 'axios';

// Sub-path base URL for reverse proxy routing (added by QC-08)
axios.defaults.baseURL = '/test-app-subpath';

export default function App() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    axios.get('/api/items').then(res => setItems(res.data));
  }, []);

  const addItem = async () => {
    const res = await axios.post('/api/items', { name: 'new item' });
    setItems([...items, res.data]);
  };

  return (
    <div>
      <h1>Test App</h1>
      <button onClick={addItem}>Add Item</button>
      <ul>{items.map(i => <li key={i.id}>{i.name}</li>)}</ul>
    </div>
  );
}
