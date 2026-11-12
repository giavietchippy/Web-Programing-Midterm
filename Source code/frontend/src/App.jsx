import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import AuthPage from './pages/AuthPage';
import LobbyPage from './pages/LobbyPage';
import RoomPage from './pages/RoomPage';
import AdminLayout from './pages/admin/AdminLayout';
import Dashboard from './pages/admin/Dashboard';
import Rooms from './pages/admin/Rooms';
import RoomDetail from './pages/admin/RoomDetail';
import Users from './pages/admin/Users';
import Connections from './pages/admin/Connections';
import Config from './pages/admin/Config';
import Audit from './pages/admin/Audit';
import Announcements from './pages/admin/Announcements';
import { isAdminAuth } from './utils/roles';

function Protected({ children }) {
  const { auth } = useAuth();
  return auth ? children : <Navigate to="/login" replace />;
}

// /admin/* is only for tokens whose role is "admin"; everybody else is sent to the home page.
// (Hiding the pages is only convenience: every admin endpoint also checks the role on the server.)
function AdminOnly({ children }) {
  const { auth } = useAuth();
  if (!auth) return <Navigate to="/login" replace />;
  return isAdminAuth(auth) ? children : <Navigate to="/" replace />;
}

export default function App() {
  const { auth } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={auth ? <Navigate to="/" replace /> : <AuthPage mode="login" />} />
      <Route path="/register" element={auth ? <Navigate to="/" replace /> : <AuthPage mode="register" />} />
      <Route path="/" element={<Protected><LobbyPage /></Protected>} />
      <Route path="/room/:roomId" element={<Protected><RoomPage /></Protected>} />
      <Route path="/admin" element={<AdminOnly><AdminLayout /></AdminOnly>}>
        <Route index element={<Dashboard />} />
        <Route path="rooms" element={<Rooms />} />
        <Route path="rooms/:roomId" element={<RoomDetail />} />
        <Route path="users" element={<Users />} />
        <Route path="connections" element={<Connections />} />
        <Route path="config" element={<Config />} />
        <Route path="audit" element={<Audit />} />
        <Route path="announcements" element={<Announcements />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
