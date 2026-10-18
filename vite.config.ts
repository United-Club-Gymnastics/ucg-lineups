import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // relative, so HashRouter works at /ucg-lineups/ (Pages project URL) and at the custom domain,
})
