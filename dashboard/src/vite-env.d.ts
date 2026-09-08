/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ORIGIN_URL?: string;
  readonly VITE_ROUTING_URL?: string;
  readonly VITE_EDGE_US_URL?: string;
  readonly VITE_EDGE_EU_URL?: string;
  readonly VITE_EDGE_ASIA_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
