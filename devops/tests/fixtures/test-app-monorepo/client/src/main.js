const root = document.getElementById('root');

async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    root.innerHTML = `<h1>Monorepo App</h1><pre>${JSON.stringify(data, null, 2)}</pre>`;
  } catch (err) {
    root.innerHTML = `<h1>Monorepo App</h1><p>Error: ${err.message}</p>`;
  }
}

loadStatus();
