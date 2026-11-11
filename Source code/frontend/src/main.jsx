import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { AuthProvider } from './context/AuthContext';
import './index.css';

// NOTE: <React.StrictMode> is intentionally NOT used. In development it mounts effects twice,
// which would open two WebSocket connections / two getUserMedia sessions for one room
// and can trigger TOO_MANY_CONNECTIONS or duplicate peers.
createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </ErrorBoundary>
);
