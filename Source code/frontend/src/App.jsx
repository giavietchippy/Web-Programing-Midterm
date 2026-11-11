import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import AuthPage from './pages/AuthPage';
import LobbyPage from './pages/LobbyPage';
import RoomPage from './pages/RoomPage';

function Protected({ children }) {
  const { auth } = useAuth();
  return auth ? children : <Navigate to="/login" replace />;
}

export default function App() {
  const { auth } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={auth ? <Navigate to="/" replace /> : <AuthPage mode="login" />} />
      <Route path="/register" element={auth ? <Navigate to="/" replace /> : <AuthPage mode="register" />} />
      <Route path="/" element={<Protected><LobbyPage /></Protected>} />
      <Route path="/room/:roomId" element={<Protected><RoomPage /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
