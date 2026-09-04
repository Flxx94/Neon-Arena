import { defineConfig } from 'vitest/config'

// @colyseus/schema braucht:
// - Legacy-Decorators (experimentalDecorators)
// - Zuweisungs-Semantik fuer Klassenfelder (useDefineForClassFields: false),
//   damit Feld-Initialisierer den Schema-Setter aufrufen ($childType etc.).
// Vite/esbuild uebernimmt das nicht automatisch aus der tsconfig -> explizit setzen.
export default defineConfig({
  esbuild: {
    tsconfigRaw: JSON.stringify({
      compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false },
    }),
  },
})
