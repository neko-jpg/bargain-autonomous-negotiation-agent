import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

export default defineConfig([
  ...nextVitals,
  globalIgnores(['.next/**', '.next-*/**', 'node_modules/**', 'public/**', 'cloudflare-env.d.ts']),
  {
    rules: {
      // These effects hydrate API-backed client state and timers. The rule
      // treats their async callbacks as direct synchronous writes and is not
      // actionable at these external-system boundaries.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
