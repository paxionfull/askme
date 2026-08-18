import { Navigate } from "react-router-dom";

/** Legacy URL — catalog hub is /dev/ui (Storybook pointer). */
export default function BannerCatalogPage() {
  return <Navigate to="/dev/ui" replace />;
}
