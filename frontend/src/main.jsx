import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import FlowDesign from './designs/FlowDesign.jsx';

function readDesign() {
  return window.location.hash === '#flow' ? 'flow' : 'dark';
}

function Root() {
  const [design, setDesign] = useState(readDesign);
  useEffect(() => {
    const onHash = () => setDesign(readDesign());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => { document.body.classList.toggle('dark', design === 'dark'); }, [design]);
  const switchTo = (next) => { window.location.hash = next === 'flow' ? '#flow' : ''; };
  return design === 'flow'
    ? <FlowDesign onSwitch={() => switchTo('dark')} />
    : <App onSwitch={() => switchTo('flow')} />;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
