// vite.config.js
import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  base: '/', // keep root-based URLs
  build: {
    rollupOptions: {
      input: {
        index:     resolve(__dirname, 'index.html'),
        login:     resolve(__dirname, 'login.html'),
        home:      resolve(__dirname, 'home.html'),
        systemmap: resolve(__dirname, 'systemmap.html'),
        insights:  resolve(__dirname, 'insights.html'),
        profile:   resolve(__dirname, 'profile.html'),
      }
    }
  }
})
