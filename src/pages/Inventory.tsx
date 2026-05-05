import { Navigate } from "react-router-dom";

// The standalone Inventory page was a non-functional mock. The real,
// database-backed inventory lives on the Stock page (with Tools on /tools),
// so we redirect here to keep any old links working.
export default function Inventory() {
  return <Navigate to="/stock" replace />;
}
