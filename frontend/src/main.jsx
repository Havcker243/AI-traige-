import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import MapDesign from './designs/MapDesign.jsx';

function readDesign() {
  return window.location.hash === '#map' ? 'map' : 'dark';
}

function Root() {
  const [design, setDesign] = useState(readDesign);
  useEffect(() => {
    const onHash = () => setDesign(readDesign());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => { document.body.classList.toggle('dark', design === 'dark'); }, [design]);
  const switchTo = (next) => { window.location.hash = next === 'map' ? '#map' : ''; };
  return design === 'map'
    ? <MapDesign onSwitch={() => switchTo('dark')} />
    : <App onSwitch={() => switchTo('map')} />;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
