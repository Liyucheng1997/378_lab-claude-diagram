import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles/tokens.css';
import './styles/app.css';
import { App } from './components/App';
import { startAutosave } from './persist';

startAutosave();

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
