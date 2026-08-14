import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/layout/AppShell";
import ChatPage from "./routes/ChatPage";
import ReadPage from "./routes/ReadPage";
import SettingsPage from "./routes/SettingsPage";

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<ChatPage />} />
        <Route path="sources" element={<ReadPage />} />
        <Route path="read" element={<Navigate to="/sources" replace />} />
        <Route path="chat" element={<Navigate to="/" replace />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
