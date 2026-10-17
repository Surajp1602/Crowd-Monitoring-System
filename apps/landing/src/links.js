// Where the site's calls to action lead. Set VITE_DASHBOARD_URL at build time for a real deployment
// (for example https://ccd.example.org); the default is the local development dashboard.
const DASHBOARD = (import.meta.env.VITE_DASHBOARD_URL || 'http://localhost:3000').replace(/\/$/, '');

export const links = {
  dashboard: `${DASHBOARD}/login`,
  subscribe: `${DASHBOARD}/subscribe`,
  docs: import.meta.env.VITE_DOCS_URL || `${DASHBOARD}/login`,
};
